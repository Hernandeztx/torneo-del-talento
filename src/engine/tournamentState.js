"use strict";

const db = require("../config/database");
const { generateSecureToken, hashToken, verifyToken } = require("../security/tokens");
const { buildBracket, advanceWinner, getRoundName } = require("./bracket");
const { pickQuestion } = require("../questions/questionService");

// Caché en memoria de torneos activos para baja latencia en WebSockets
const activeRooms = new Map();

/**
 * Crea un nuevo torneo y persiste su estado inicial en PostgreSQL.
 */
async function createTournament({ code, name, settings, adminSecret }) {
  const adminToken = generateSecureToken();
  const adminTokenHash = hashToken(adminToken);

  const mergedSettings = {
    questionsPerDuel: settings?.questionsPerDuel || 2,
    timePerQuestion: settings?.timePerQuestion || 20,
    maxParticipants: settings?.maxParticipants || 32,
    difficultyMode: settings?.difficultyMode || "progressive",
    enableThirdPlace: settings?.enableThirdPlace !== false,
    soundEnabled: settings?.soundEnabled !== false,
    prizeFirst: settings?.prizeFirst || "",
    prizeSecond: settings?.prizeSecond || "",
    prizeThird: settings?.prizeThird || ""
  };

  let tournamentId = null;

  // Persistir en PostgreSQL si está disponible
  if (db.getStatus().connected) {
    await db.withTransaction(async (client) => {
      const tRes = await client.query(
        `INSERT INTO tournaments (code, name, status, admin_token_hash)
         VALUES ($1, $2, 'lobby', $3)
         RETURNING id`,
        [code, name, adminTokenHash]
      );
      tournamentId = tRes.rows[0].id;

      await client.query(
        `INSERT INTO tournament_settings 
         (tournament_id, questions_per_duel, time_per_question, max_participants,
          difficulty_mode, enable_third_place, sound_enabled, prize_first, prize_second, prize_third)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          tournamentId,
          mergedSettings.questionsPerDuel,
          mergedSettings.timePerQuestion,
          mergedSettings.maxParticipants,
          mergedSettings.difficultyMode,
          mergedSettings.enableThirdPlace,
          mergedSettings.soundEnabled,
          mergedSettings.prizeFirst,
          mergedSettings.prizeSecond,
          mergedSettings.prizeThird
        ]
      );

      await client.query(
        `INSERT INTO tournament_events (tournament_id, event_type, payload)
         VALUES ($1, 'TOURNAMENT_CREATED', $2)`,
        [tournamentId, JSON.stringify({ code, name, settings: mergedSettings })]
      );
    });
  } else {
    tournamentId = "mem-" + Date.now();
  }

  const room = {
    id: tournamentId,
    code,
    name,
    status: "lobby", // 'lobby', 'active', 'paused', 'finished'
    adminTokenHash,
    settings: mergedSettings,
    participants: new Map(), // key: id, val: participant
    tokenToIdMap: new Map(),  // key: tokenHash, val: id
    nameToIdMap: new Map(),   // key: lowercase name, val: id
    matches: new Map(),      // key: matchId, val: match
    rounds: [],
    thirdMatch: null,
    usedQuestionKeys: new Set(),
    currentMatchId: null,
    activeQuestion: null,
    disconnectionGrace: null, // Gestión de gracia si ambos caen
    createdAt: new Date().toISOString()
  };

  activeRooms.set(code, room);

  return {
    tournamentId,
    code,
    name,
    adminToken, // Solo se devuelve una vez al creador en la respuesta inicial
    settings: mergedSettings
  };
}

/**
 * Registra un participante en la sala.
 * Genera un token secreto para el cliente y almacena solo su hash SHA-256.
 */
async function registerParticipant({ code, name, socketId }) {
  const room = activeRooms.get(code);
  if (!room) {
    throw new Error("El torneo no existe o el código es incorrecto.");
  }

  if (room.status !== "lobby") {
    throw new Error("Las inscripciones para este torneo ya están cerradas.");
  }

  if (room.participants.size >= room.settings.maxParticipants) {
    throw new Error(`Se ha alcanzado el límite máximo de ${room.settings.maxParticipants} participantes.`);
  }

  const cleanName = name.trim();
  const lowerName = cleanName.toLowerCase();

  if (room.nameToIdMap.has(lowerName)) {
    throw new Error("Ya hay un participante con ese nombre. Agrega un apellido o inicial para diferenciarte.");
  }

  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  let participantId = null;

  if (db.getStatus().connected && room.id && !room.id.startsWith("mem-")) {
    const res = await db.query(
      `INSERT INTO participants (tournament_id, name, token_hash, socket_id, is_connected)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id`,
      [room.id, cleanName, tokenHash, socketId]
    );
    participantId = res.rows[0].id;
  } else {
    participantId = "p-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  }

  const participant = {
    id: participantId,
    name: cleanName,
    tokenHash,
    socketId,
    isConnected: true,
    eliminated: false,
    finalRank: null,
    score: 0,
    registeredAt: new Date().toISOString()
  };

  room.participants.set(participantId, participant);
  room.tokenToIdMap.set(tokenHash, participantId);
  room.nameToIdMap.set(lowerName, participantId);

  return {
    participantId,
    name: cleanName,
    rawToken, // Se envía al cliente para guardar en sessionStorage
    tournamentCode: code,
    tournamentName: room.name
  };
}

/**
 * Reconecta a un participante que refrescó su navegador o perdió internet.
 */
async function reconnectParticipant({ code, rawToken, socketId }) {
  const room = activeRooms.get(code);
  if (!room) return null;

  const tokenHash = hashToken(rawToken);
  let participantId = room.tokenToIdMap.get(tokenHash);

  // Si no está en caché pero la BD está conectada, buscar en PostgreSQL
  if (!participantId && db.getStatus().connected && !room.id.startsWith("mem-")) {
    const res = await db.query(
      `SELECT id, name, is_connected FROM participants WHERE tournament_id = $1 AND token_hash = $2`,
      [room.id, tokenHash]
    );
    if (res.rows.length > 0) {
      participantId = res.rows[0].id;
    }
  }

  if (!participantId || !room.participants.has(participantId)) {
    return null;
  }

  const participant = room.participants.get(participantId);
  participant.socketId = socketId;
  participant.isConnected = true;

  if (db.getStatus().connected && !room.id.startsWith("mem-")) {
    await db.query(
      `UPDATE participants SET socket_id = $1, is_connected = TRUE, last_seen_at = NOW() WHERE id = $2`,
      [socketId, participantId]
    );
  }

  // Cancelar periodo de gracia si el participante que volvió estaba en duelo
  if (room.disconnectionGrace) {
    clearTimeout(room.disconnectionGrace.timeout);
    room.disconnectionGrace = null;
  }

  return participant;
}

/**
 * Marca a un participante como desconectado sin eliminar sus datos.
 */
async function markParticipantDisconnected(socketId) {
  for (const [, room] of activeRooms) {
    for (const [, p] of room.participants) {
      if (p.socketId === socketId) {
        p.isConnected = false;
        if (db.getStatus().connected && !room.id.startsWith("mem-")) {
          await db.query(`UPDATE participants SET is_connected = FALSE WHERE id = $1`, [p.id]);
        }
        return { room, participant: p };
      }
    }
  }
  return null;
}

/**
 * Inicia el torneo y genera el bracket de eliminación con claves foráneas compuestas.
 */
async function startTournament({ code, adminSecretOrToken }) {
  const room = activeRooms.get(code);
  if (!room) throw new Error("Torneo no encontrado.");

  const pList = Array.from(room.participants.values());
  if (pList.length < 2) {
    throw new Error("Se necesitan al menos 2 participantes para comenzar el torneo.");
  }

  const bracket = buildBracket(pList, room.settings.enableThirdPlace);
  room.rounds = bracket.rounds;
  room.thirdMatch = bracket.thirdMatch;
  room.status = "active";

  // Poblar room.matches Map para indexación rápida por match_id
  const allGeneratedMatches = bracket.rounds.flat().concat(bracket.thirdMatch ? [bracket.thirdMatch] : []);
  for (const m of allGeneratedMatches) {
    room.matches.set(m.id, m);
  }

  // Persistir el cuadro y cambio de estado en PostgreSQL
  if (db.getStatus().connected && !room.id.startsWith("mem-")) {
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE tournaments SET status = 'active', started_at = NOW() WHERE id = $1`,
        [room.id]
      );

      const allMatches = bracket.rounds.flat().concat(bracket.thirdMatch ? [bracket.thirdMatch] : []);
      for (const m of allMatches) {
        // En PostgreSQL, si playerA o playerB son objetos temporales o BYE, verificar IDs reales
        const aId = m.playerA && !m.playerA.id.startsWith("p-") && m.playerA.id !== "__BYE__" ? m.playerA.id : null;
        const bId = m.playerB && !m.playerB.id.startsWith("p-") && m.playerB.id !== "__BYE__" ? m.playerB.id : null;

        await client.query(
          `INSERT INTO tournament_matches 
           (tournament_id, match_id, round_index, match_index, player_a_id, player_b_id, is_bye, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tournament_id, match_id) DO UPDATE 
           SET player_a_id = EXCLUDED.player_a_id, player_b_id = EXCLUDED.player_b_id, status = EXCLUDED.status`,
          [
            room.id,
            m.id,
            m.roundIndex === "t" ? -1 : m.roundIndex,
            m.matchIndex,
            aId,
            bId,
            m.isBye,
            m.status
          ]
        );
      }
    });
  }

  return {
    code,
    status: "active",
    rounds: room.rounds,
    thirdMatch: room.thirdMatch
  };
}

/**
 * [FASE 1.1]: ESTRATEGIA DE RECONSTRUCCIÓN Y RECUPERACIÓN (HYDRATE)
 * Lee de PostgreSQL todos los torneos activos o en espera tras un reinicio del contenedor,
 * reconstruyendo participantes, estado de enfrentamientos y aplicando la política de temporizador.
 */
async function hydrateActiveRoomsFromDB() {
  if (!db.getStatus().connected) {
    return 0;
  }

  try {
    const tRes = await db.query(
      `SELECT t.*, ts.questions_per_duel, ts.time_per_question, ts.max_participants, 
              ts.difficulty_mode, ts.enable_third_place, ts.sound_enabled, 
              ts.prize_first, ts.prize_second, ts.prize_third
       FROM tournaments t
       JOIN tournament_settings ts ON ts.tournament_id = t.id
       WHERE t.status IN ('lobby', 'active', 'paused')`
    );

    let count = 0;
    for (const row of tRes.rows) {
      const room = {
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        adminTokenHash: row.admin_token_hash,
        currentMatchId: row.current_match_id,
        activeQuestion: null,
        disconnectionGrace: null,
        settings: {
          questionsPerDuel: row.questions_per_duel,
          timePerQuestion: row.time_per_question,
          maxParticipants: row.max_participants,
          difficultyMode: row.difficulty_mode,
          enableThirdPlace: row.enable_third_place,
          soundEnabled: row.sound_enabled,
          prizeFirst: row.prize_first,
          prizeSecond: row.prize_second,
          prizeThird: row.prize_third
        },
        participants: new Map(),
        tokenToIdMap: new Map(),
        nameToIdMap: new Map(),
        matches: new Map(),
        rounds: [],
        thirdMatch: null,
        usedQuestionKeys: new Set(),
        createdAt: row.created_at
      };

      // 1. Cargar Participantes
      const pRes = await db.query(
        `SELECT * FROM participants WHERE tournament_id = $1 ORDER BY registered_at ASC`,
        [row.id]
      );
      for (const p of pRes.rows) {
        const participant = {
          id: p.id,
          name: p.name,
          tokenHash: p.token_hash,
          socketId: null, // Debe reconectarse
          isConnected: false,
          eliminated: p.eliminated,
          finalRank: p.final_rank,
          score: 0,
          registeredAt: p.registered_at
        };
        room.participants.set(p.id, participant);
        room.tokenToIdMap.set(p.token_hash, p.id);
        room.nameToIdMap.set(p.name.toLowerCase(), p.id);
      }

      // 2. Cargar Enfrentamientos
      const mRes = await db.query(
        `SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round_index ASC, match_index ASC`,
        [row.id]
      );
      if (mRes.rows.length > 0) {
        const roundMap = {};
        for (const m of mRes.rows) {
          const matchObj = {
            id: m.match_id,
            roundIndex: m.round_index === -1 ? "t" : m.round_index,
            matchIndex: m.match_index,
            playerA: m.player_a_id ? room.participants.get(m.player_a_id) : null,
            playerB: m.player_b_id ? room.participants.get(m.player_b_id) : null,
            scoreA: m.score_a,
            scoreB: m.score_b,
            winner: m.winner_id ? room.participants.get(m.winner_id) : null,
            loser: m.loser_id ? room.participants.get(m.loser_id) : null,
            isBye: m.is_bye,
            status: m.status
          };
          room.matches.set(m.match_id, matchObj);
          if (m.round_index === -1) {
            room.thirdMatch = matchObj;
          } else {
            if (!roundMap[m.round_index]) roundMap[m.round_index] = [];
            roundMap[m.round_index].push(matchObj);
          }
        }
        room.rounds = Object.keys(roundMap).sort((a, b) => a - b).map((k) => roundMap[k]);
      }

      // 3. Cargar Preguntas, Respuestas y Resolver Política de Temporizador Interrumpido
      const qRes = await db.query(
        `SELECT * FROM match_questions WHERE tournament_id = $1 ORDER BY created_at ASC`,
        [row.id]
      );
      for (const q of qRes.rows) {
        room.usedQuestionKeys.add(q.question_key);

        // [FASE 1.2 / A-01]: Recuperar respuestas asociadas a esta pregunta desde PostgreSQL
        const aRes = await db.query(
          `SELECT * FROM participant_answers 
           WHERE match_question_id = $1 AND tournament_id = $2 
           ORDER BY answered_at ASC`,
          [q.id, row.id]
        );

        const receivedAnswers = new Map();
        for (const a of aRes.rows) {
          receivedAnswers.set(a.participant_id, {
            participantId: a.participant_id,
            givenAnswer: a.given_answer,
            isCorrect: a.is_correct,
            points: a.points_awarded,
            elapsedMs: a.response_time_ms,
            isLate: a.points_awarded === 0 && !a.is_correct,
            answeredAt: a.answered_at
          });
        }
        q.receivedAnswers = receivedAnswers;

        // POLÍTICA DE REINICIO DE PREGUNTAS ACTIVAS:
        if (q.status === "active") {
          const startTime = new Date(q.start_time).getTime();
          const elapsed = Date.now() - startTime;

          if (elapsed >= q.duration_ms) {
            // El tiempo ya venció durante el reinicio -> Pasa a estado de revelación pendiente
            await db.query(`UPDATE match_questions SET status = 'pending_reveal' WHERE id = $1`, [q.id]);
            q.status = "pending_reveal";
          } else {
            // Se interrumpió a mitad del tiempo -> Se marca como interrumpida (pausada)
            // Se preservan respuestas ya enviadas, sin regalar tiempo extra arbitrario
            await db.query(`UPDATE match_questions SET status = 'interrupted' WHERE id = $1`, [q.id]);
            q.status = "interrupted";
          }
        }

        // Si esta pregunta corresponde al enfrentamiento activo actual, rehidratar room.activeQuestion
        if (row.current_match_id && q.match_id === row.current_match_id && q.status !== "revealed") {
          room.activeQuestion = q;
        }
      }

      activeRooms.set(row.code, room);
      count++;
    }

    if (count > 0) {
      console.log(`♻️ Se recuperaron exitosamente ${count} torneos activos desde PostgreSQL.`);
    }
    return count;
  } catch (err) {
    console.error("❌ Error al rehidratar torneos desde PostgreSQL:", err.message);
    return 0;
  }
}

/**
 * Valida estrictamente que un participante esté asignado al enfrentamiento activo.
 */
function isParticipantInMatch(room, matchId, participantId) {
  if (!room || !matchId || !participantId) return false;
  const match = room.matches.get(matchId) || (room.thirdMatch && room.thirdMatch.id === matchId ? room.thirdMatch : null);
  if (!match) return false;

  const aId = match.playerA ? (match.playerA.id || match.playerA) : null;
  const bId = match.playerB ? (match.playerB.id || match.playerB) : null;

  return participantId === aId || participantId === bId;
}

/**
 * Cancela de forma segura cualquier temporizador de gracia activo en la sala.
 */
function cancelDisconnectionGrace(room) {
  if (room && room.disconnectionGrace) {
    if (room.disconnectionGrace.timeout) {
      clearTimeout(room.disconnectionGrace.timeout);
    }
    room.disconnectionGrace = null;
    return true;
  }
  return false;
}

/**
 * Obtiene la sala por código.
 */
function getRoom(code) {
  return activeRooms.get(code) || null;
}

module.exports = {
  activeRooms,
  createTournament,
  registerParticipant,
  reconnectParticipant,
  markParticipantDisconnected,
  startTournament,
  hydrateActiveRoomsFromDB,
  isParticipantInMatch,
  cancelDisconnectionGrace,
  getRoom
};
