-- ====================================================================
-- ESQUEMA COMPLETO DE BASE DE DATOS: TORNEO DEL TALENTO (POSTGRESQL)
-- REVISIÓN FASE 1.1: INTEGRIDAD REFERENCIAL COMPUESTA Y TRIGGERS
-- ====================================================================

-- Habilitar extensión pgcrypto para UUIDs si no está habilitada
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABLA: TORNEOS
CREATE TABLE IF NOT EXISTS tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(12) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'lobby', -- 'lobby', 'active', 'paused', 'finished'
    admin_token_hash VARCHAR(64) NOT NULL,        -- Hash SHA-256 del token administrativo del organizador
    current_match_id VARCHAR(32),                -- Identificador del duelo activo actual (ej: '0-0')
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_tournaments_code ON tournaments(code);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

-- 2. TABLA: CONFIGURACIÓN DEL TORNEO
CREATE TABLE IF NOT EXISTS tournament_settings (
    tournament_id UUID PRIMARY KEY,
    questions_per_duel INT NOT NULL DEFAULT 2,
    time_per_question INT NOT NULL DEFAULT 20,
    max_participants INT NOT NULL DEFAULT 32,
    difficulty_mode VARCHAR(20) NOT NULL DEFAULT 'progressive',
    enable_third_place BOOLEAN NOT NULL DEFAULT TRUE,
    sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    prize_first VARCHAR(120) DEFAULT '',
    prize_second VARCHAR(120) DEFAULT '',
    prize_third VARCHAR(120) DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_settings_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments(id) ON DELETE CASCADE
);

-- 3. TABLA: PARTICIPANTES
CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL,
    name VARCHAR(60) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,              -- Hash SHA-256 del token del participante (¡NUNCA en texto plano!)
    socket_id VARCHAR(64),                        -- Socket.IO ID actual para reconexiones
    is_connected BOOLEAN DEFAULT TRUE,
    eliminated BOOLEAN DEFAULT FALSE,
    final_rank INT,                               -- 1, 2, 3...
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_participants_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments(id) ON DELETE CASCADE,
    CONSTRAINT uq_participant_name_per_tournament UNIQUE(tournament_id, name),
    CONSTRAINT uq_participant_token_per_tournament UNIQUE(tournament_id, token_hash),
    -- [FASE 1.1]: Restricción única compuesta para habilitar claves foráneas compuestas seguras
    CONSTRAINT uq_participant_tournament_id UNIQUE (tournament_id, id)
);

CREATE INDEX IF NOT EXISTS idx_participants_tournament ON participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_participants_token ON participants(token_hash);

-- 4. TABLA: ENFRENTAMIENTOS DEL CUADRO (MATCHES)
CREATE TABLE IF NOT EXISTS tournament_matches (
    tournament_id UUID NOT NULL,
    match_id VARCHAR(32) NOT NULL,                -- '0-0', '0-1', '1-0', 't-0' (tercer puesto)
    round_index INT NOT NULL,                     -- 0, 1, 2... o -1 para tercer puesto
    match_index INT NOT NULL,
    player_a_id UUID,
    player_b_id UUID,
    score_a INT NOT NULL DEFAULT 0,
    score_b INT NOT NULL DEFAULT 0,
    winner_id UUID,
    loser_id UUID,
    is_bye BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting', -- 'waiting', 'ready', 'in_progress', 'completed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (tournament_id, match_id),
    CONSTRAINT fk_matches_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments(id) ON DELETE CASCADE,
    -- [FASE 1.1]: Claves foráneas compuestas estrictas.
    -- IMPIDE MATEMÁTICAMENTE que un participante del Torneo A sea asignado a un match del Torneo B.
    CONSTRAINT fk_matches_player_a FOREIGN KEY (tournament_id, player_a_id)
        REFERENCES participants(tournament_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_matches_player_b FOREIGN KEY (tournament_id, player_b_id)
        REFERENCES participants(tournament_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_matches_winner FOREIGN KEY (tournament_id, winner_id)
        REFERENCES participants(tournament_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_matches_loser FOREIGN KEY (tournament_id, loser_id)
        REFERENCES participants(tournament_id, id) ON DELETE SET NULL,
    -- [FASE 1.1]: Un competidor no puede enfrentarse contra sí mismo
    CONSTRAINT chk_different_players CHECK (
        player_a_id IS NULL OR player_b_id IS NULL OR player_a_id <> player_b_id
    )
);

CREATE INDEX IF NOT EXISTS idx_matches_tournament ON tournament_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON tournament_matches(tournament_id, status);

-- 5. TABLA: PREGUNTAS DEL ENFRENTAMIENTO
CREATE TABLE IF NOT EXISTS match_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL,
    match_id VARCHAR(32) NOT NULL,
    question_order INT NOT NULL,                  -- 1, 2, 3...
    question_key VARCHAR(64) NOT NULL,           -- Clave única de pregunta (ej: 'rot12-180' o 'q1a2b3')
    question_type VARCHAR(10) NOT NULL,          -- 'mc', 'vf', 'ord', 'num'
    difficulty_level INT NOT NULL,                -- 1, 2, 3
    category VARCHAR(60) NOT NULL,
    question_text TEXT NOT NULL,
    options_payload JSONB NOT NULL,              -- Opciones seguras para los clientes (sin respuestas correctas)
    correct_payload JSONB NOT NULL,              -- Respuesta correcta, tolerancias y explicación (secreta hasta revelación)
    is_sudden_death BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'revealed', 'interrupted'
    start_time TIMESTAMP WITH TIME ZONE,          -- Momento exacto de inicio emitido por el servidor
    end_time TIMESTAMP WITH TIME ZONE,            -- Momento límite del cronómetro
    duration_ms INT NOT NULL DEFAULT 20000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_match_questions_match FOREIGN KEY (tournament_id, match_id)
        REFERENCES tournament_matches(tournament_id, match_id) ON DELETE CASCADE,
    -- [FASE 1.1]: Restricción única compuesta para vincular respuestas al mismo torneo
    CONSTRAINT uq_match_question_tournament_id UNIQUE (tournament_id, id)
);

CREATE INDEX IF NOT EXISTS idx_match_questions_match ON match_questions(tournament_id, match_id);

-- 6. TABLA: RESPUESTAS INDIVIDUALES
CREATE TABLE IF NOT EXISTS participant_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL,
    match_question_id UUID NOT NULL,
    participant_id UUID NOT NULL,
    given_answer JSONB,                          -- Respuesta enviada (índice, booleano, array u objeto numérico)
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    response_time_ms INT NOT NULL,               -- Milisegundos exactos autoritativos medidos por el servidor
    points_awarded INT NOT NULL DEFAULT 0,
    answered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- [FASE 1.1]: Claves foráneas compuestas de triple validación
    CONSTRAINT fk_answers_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments(id) ON DELETE CASCADE,
    CONSTRAINT fk_answers_question FOREIGN KEY (tournament_id, match_question_id)
        REFERENCES match_questions(tournament_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_answers_participant FOREIGN KEY (tournament_id, participant_id)
        REFERENCES participants(tournament_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_answer_per_question_participant UNIQUE(match_question_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_question ON participant_answers(match_question_id);
CREATE INDEX IF NOT EXISTS idx_answers_participant ON participant_answers(participant_id);
CREATE INDEX IF NOT EXISTS idx_answers_tournament ON participant_answers(tournament_id);

-- [FASE 1.1]: TRIGGER DE INTEGRIDAD AVANZADA
-- Garantiza a nivel de motor de base de datos que ÚNICAMENTE los dos participantes asignados al match
-- puedan registrar respuestas a esa pregunta.
CREATE OR REPLACE FUNCTION validate_participant_in_match()
RETURNS TRIGGER AS $$
DECLARE
    v_match_id VARCHAR(32);
    v_player_a UUID;
    v_player_b UUID;
BEGIN
    -- 1. Obtener el match asociado a la pregunta
    SELECT mq.match_id INTO v_match_id
    FROM match_questions mq
    WHERE mq.id = NEW.match_question_id AND mq.tournament_id = NEW.tournament_id;

    IF v_match_id IS NULL THEN
        RAISE EXCEPTION 'Integridad violada: La pregunta indicada no pertenece al torneo especificado.';
    END IF;

    -- 2. Obtener los dos competidores asignados a dicho enfrentamiento
    SELECT tm.player_a_id, tm.player_b_id INTO v_player_a, v_player_b
    FROM tournament_matches tm
    WHERE tm.tournament_id = NEW.tournament_id AND tm.match_id = v_match_id;

    -- 3. Validar coincidencia estricta con player_a o player_b
    IF (v_player_a IS NULL AND v_player_b IS NULL) OR 
       (NEW.participant_id IS DISTINCT FROM v_player_a AND NEW.participant_id IS DISTINCT FROM v_player_b) THEN
        RAISE EXCEPTION 'Integridad violada: El participante % no está asignado como competidor en el enfrentamiento % del torneo %',
            NEW.participant_id, v_match_id, NEW.tournament_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_participant_in_match ON participant_answers;
CREATE TRIGGER trg_validate_participant_in_match
BEFORE INSERT OR UPDATE ON participant_answers
FOR EACH ROW
EXECUTE FUNCTION validate_participant_in_match();

-- 7. TABLA: EVENTOS HISTÓRICOS DEL TORNEO (AUDITORÍA / RECONSTRUCCIÓN)
CREATE TABLE IF NOT EXISTS tournament_events (
    id BIGSERIAL PRIMARY KEY,
    tournament_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,             -- 'PLAYER_JOINED', 'MATCH_STARTED', 'QUESTION_LAUNCHED', etc.
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_events_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_tournament ON tournament_events(tournament_id, id);

-- 8. TABLA: RESULTADOS FINALES Y PODIO
CREATE TABLE IF NOT EXISTS tournament_results (
    tournament_id UUID PRIMARY KEY,
    first_place_id UUID,
    second_place_id UUID,
    third_place_id UUID,
    summary_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_results_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments(id) ON DELETE CASCADE,
    -- [FASE 1.1]: Claves foráneas compuestas para el podio
    CONSTRAINT fk_results_first FOREIGN KEY (tournament_id, first_place_id)
        REFERENCES participants(tournament_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_results_second FOREIGN KEY (tournament_id, second_place_id)
        REFERENCES participants(tournament_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_results_third FOREIGN KEY (tournament_id, third_place_id)
        REFERENCES participants(tournament_id, id) ON DELETE SET NULL
);
