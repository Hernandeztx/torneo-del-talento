"use strict";

const db = require("../config/database");
const { advanceWinner, getLevelForMatch } = require("./bracket");
const { pickQuestion, sanitizeQuestionForClient, verifyAnswer, getQuestionDuration } = require("../questions/questionService");
const { calculateScore } = require("./scoring");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Genera un UUID simple compatible con Node 14+ y fallback para versiones anteriores.
 */
function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "q-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

/**
 * Lanza un error de concurrencia si el lock está activado.
 * Establece el lock y retorna una función de liberación (para usar en try/finally).
 */
function acquireLock(room) {
  if (room.duelLock) {
    throw new Error("Operación en progreso, intenta de nuevo en un momento");
  }
  room.duelLock = true;
  return () => { room.duelLock = false; };
}

// ---------------------------------------------------------------------------
// startMatch
// ---------------------------------------------------------------------------

/**
 * Inicia un match específico del torneo.
 * @param {object} room - La sala activa.
 * @param {string} matchId - El ID del match a iniciar.
 * @param {object} [io] - Instancia de Socket.IO para emitir match_started.
 * @returns {{ match, playerA, playerB }}
 */
async function startMatch(room, matchId, io) {
  const release = acquireLock(room);
  try {
    // Buscar en rounds y thirdMatch
    const match = room.matches.get(matchId) ||
      (room.thirdMatch && room.thirdMatch.id === matchId ? room.thirdMatch : null);

    if (!match) {
      throw new Error(`El enfrentamiento ${matchId} no existe.`);
    }

    if (match.status !== "ready" && match.status !== "waiting") {
      throw new Error(`El enfrentamiento ${matchId} no está disponible para iniciar (estado: ${match.status}).`);
    }

    // Verificar que playerA y playerB sean reales (no BYE)
    const BYE_ID = "__BYE__";
    if (!match.playerA || match.playerA.id === BYE_ID) {
      throw new Error("El jugador A no es válido (BYE o ausente).");
    }
    if (!match.playerB || match.playerB.id === BYE_ID) {
      throw new Error("El jugador B no es válido (BYE o ausente).");
    }

    // Verificar que no haya otro match in_progress
    for (const [, m] of room.matches) {
      if (m.id !== matchId && m.status === "in_progress") {
        throw new Error(`Ya hay un enfrentamiento en progreso: ${m.id}. Termínalo antes de iniciar otro.`);
      }
    }

    const playerA = match.playerA;
    const playerB = match.playerB;

    // Mutar estado en memoria
    room.currentMatchId = matchId;
    match.status = "in_progress";
    match.questionsPlayed = 0;
    match.scoreA = 0;
    match.scoreB = 0;
    room.duelState = "match_ready";

    // Persistir en BD si está disponible
    if (db.getStatus().connected && room.id && !room.id.startsWith("mem-")) {
      try {
        await db.query(
          `UPDATE tournament_matches SET status = 'in_progress' WHERE tournament_id = $1 AND match_id = $2`,
          [room.id, matchId]
        );
      } catch (dbErr) {
        console.warn("⚠️ No se pudo actualizar estado del match en BD:", dbErr.message);
      }
    }

    // Emitir match_started a toda la sala
    if (io) {
      io.to(room.code).emit("match_started", {
        matchId,
        playerA,
        playerB,
        roundIndex: match.roundIndex,
        duelState: "match_ready"
      });
    }

    return { match, playerA, playerB };
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// launchQuestion
// ---------------------------------------------------------------------------

/**
 * Lanza la siguiente pregunta del duelo activo.
 * @param {object} room - La sala activa.
 * @param {object} io   - Instancia de Socket.IO.
 * @returns {object} La pregunta activa.
 */
async function launchQuestion(room, io) {
  const release = acquireLock(room);
  try {
    if (room.duelState !== "match_ready" && room.duelState !== "answer_revealed") {
      throw new Error(`No se puede lanzar pregunta en estado '${room.duelState}'.`);
    }

    const match = room.matches.get(room.currentMatchId) ||
      (room.thirdMatch && room.thirdMatch.id === room.currentMatchId ? room.thirdMatch : null);

    if (!match) {
      throw new Error("No hay un enfrentamiento activo.");
    }

    // Determinar nivel de dificultad
    let targetLevel;
    if (room.settings.difficultyMode === "progressive") {
      targetLevel = getLevelForMatch(match.roundIndex, room.rounds.length);
    } else {
      targetLevel = Math.ceil(Math.random() * 3);
    }

    // Seleccionar pregunta
    const q = pickQuestion({
      targetLevel,
      lastType: room.activeQuestion ? room.activeQuestion.type : null,
      usedKeys: room.usedQuestionKeys
    });

    if (!q) {
      throw new Error("No hay preguntas disponibles para este nivel.");
    }

    const questionDbId = generateId();
    const durationMs = getQuestionDuration(q, room.settings.timePerQuestion);

    const questionOrder = (match.questionsPlayed || 0) + 1;

    room.activeQuestion = {
      id: questionDbId,
      questionKey: q.id,
      ...q,
      matchId: room.currentMatchId,
      questionOrder,
      startTime: Date.now(),
      durationMs,
      receivedAnswers: new Map(),
      autoCloseTimer: null,
      status: "active",
      revealed: false
    };

    room.duelState = "question_active";

    // Programar auto-cierre con 1s de gracia
    room.activeQuestion.autoCloseTimer = setTimeout(() => {
      if (room.duelState === "question_active") {
        closeQuestion(room);
        // Emitir question_closed automático si el organizador no lo hizo
        if (io) {
          io.to(room.code).emit("question_closed", {
            matchId: room.currentMatchId,
            timeExpired: true
          });
        }
      }
    }, durationMs + 1000);

    // Persistir en BD si conectado
    if (db.getStatus().connected && room.id && !room.id.startsWith("mem-")) {
      try {
        await db.query(
          `INSERT INTO match_questions 
           (id, tournament_id, match_id, question_key, question_order, start_time, duration_ms, status)
           VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7, 'active')
           ON CONFLICT (id) DO NOTHING`,
          [
            questionDbId,
            room.id,
            room.currentMatchId,
            q.id,
            questionOrder,
            room.activeQuestion.startTime,
            durationMs
          ]
        );
      } catch (dbErr) {
        console.warn("⚠️ No se pudo insertar pregunta en BD:", dbErr.message);
      }
    }

    // Emitir a toda la sala (sin correctAnswer — sanitizeQuestionForClient lo elimina)
    io.to(room.code).emit("question_started", {
      matchId: room.currentMatchId,
      question: sanitizeQuestionForClient(room.activeQuestion),
      durationMs: room.activeQuestion.durationMs,
      startTime: room.activeQuestion.startTime,
      questionOrder: room.activeQuestion.questionOrder,
      totalQuestions: room.settings.questionsPerDuel
    });

    return room.activeQuestion;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// closeQuestion
// ---------------------------------------------------------------------------

/**
 * Cierra la pregunta activa (manual o por auto-cierre).
 * @param {object} room - La sala activa.
 * @returns {boolean}
 */
function closeQuestion(room) {
  if (room.duelState !== "question_active") {
    throw new Error(`No se puede cerrar la pregunta en estado '${room.duelState}'.`);
  }

  // Limpiar auto-cierre
  if (room.activeQuestion && room.activeQuestion.autoCloseTimer) {
    clearTimeout(room.activeQuestion.autoCloseTimer);
    room.activeQuestion.autoCloseTimer = null;
  }

  room.duelState = "question_closed";
  if (room.activeQuestion) {
    room.activeQuestion.status = "closed";
  }

  return true;
}

// ---------------------------------------------------------------------------
// revealAnswer
// ---------------------------------------------------------------------------

/**
 * Revela la respuesta y actualiza puntajes del match.
 * @param {object} room - La sala activa.
 * @param {object} io   - Instancia de Socket.IO.
 * @returns {object} Resultado con datos de ambos jugadores.
 */
async function revealAnswer(room, io) {
  const release = acquireLock(room);
  try {
    if (room.duelState !== "question_closed") {
      throw new Error(`No se puede revelar la respuesta en estado '${room.duelState}'.`);
    }

    const q = room.activeQuestion;
    if (!q) throw new Error("No hay pregunta activa.");

    // Evitar doble revelación
    if (q.revealed) {
      throw new Error("La respuesta ya fue revelada.");
    }
    q.revealed = true;

    const match = room.matches.get(room.currentMatchId) ||
      (room.thirdMatch && room.thirdMatch.id === room.currentMatchId ? room.thirdMatch : null);

    if (!match) throw new Error("No hay un enfrentamiento activo.");

    const playerA = match.playerA;
    const playerB = match.playerB;

    // Obtener respuestas (ya calculadas en submit_answer)
    const answerA = q.receivedAnswers.get(playerA.id) || null;
    const answerB = q.receivedAnswers.get(playerB.id) || null;

    const resultA = answerA
      ? { points: answerA.points, isCorrect: answerA.isCorrect, elapsedMs: answerA.elapsedMs, givenAnswer: answerA.givenAnswer }
      : { points: 0, isCorrect: false, elapsedMs: null, givenAnswer: null };

    const resultB = answerB
      ? { points: answerB.points, isCorrect: answerB.isCorrect, elapsedMs: answerB.elapsedMs, givenAnswer: answerB.givenAnswer }
      : { points: 0, isCorrect: false, elapsedMs: null, givenAnswer: null };

    // Actualizar puntuaciones del match
    match.scoreA = (match.scoreA || 0) + resultA.points;
    match.scoreB = (match.scoreB || 0) + resultB.points;

    // Registrar historial de respuestas en el match para tiebreak estricto
    if (!match._answerHistory) match._answerHistory = [];
    if (answerA) match._answerHistory.push({ ...answerA, participantId: playerA.id });
    if (answerB) match._answerHistory.push({ ...answerB, participantId: playerB.id });

    // Actualizar puntuación acumulada del participante
    const participantA = room.participants.get(playerA.id);
    const participantB = room.participants.get(playerB.id);
    if (participantA) participantA.score = (participantA.score || 0) + resultA.points;
    if (participantB) participantB.score = (participantB.score || 0) + resultB.points;

    room.duelState = "answer_revealed";
    match.questionsPlayed = (match.questionsPlayed || 0) + 1;

    // Persistir respuestas en BD
    if (db.getStatus().connected && room.id && !room.id.startsWith("mem-")) {
      try {
        await db.withTransaction(async (client) => {
          // Actualizar status de la pregunta
          await client.query(
            `UPDATE match_questions SET status = 'revealed' WHERE id = $1`,
            [q.id]
          );

          // Insertar respuesta de playerA
          if (answerA) {
            await client.query(
              `INSERT INTO participant_answers
               (tournament_id, match_question_id, participant_id, given_answer, is_correct, points_awarded, response_time_ms, answered_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT DO NOTHING`,
              [
                room.id, q.id, playerA.id,
                JSON.stringify(answerA.givenAnswer),
                answerA.isCorrect, answerA.points, answerA.elapsedMs,
                answerA.answeredAt || new Date().toISOString()
              ]
            );
          }

          // Insertar respuesta de playerB
          if (answerB) {
            await client.query(
              `INSERT INTO participant_answers
               (tournament_id, match_question_id, participant_id, given_answer, is_correct, points_awarded, response_time_ms, answered_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT DO NOTHING`,
              [
                room.id, q.id, playerB.id,
                JSON.stringify(answerB.givenAnswer),
                answerB.isCorrect, answerB.points, answerB.elapsedMs,
                answerB.answeredAt || new Date().toISOString()
              ]
            );
          }

          // Actualizar scores del match
          await client.query(
            `UPDATE tournament_matches SET score_a = $1, score_b = $2 WHERE tournament_id = $3 AND match_id = $4`,
            [match.scoreA, match.scoreB, room.id, match.id]
          );
        });
      } catch (dbErr) {
        console.warn("⚠️ No se pudo persistir respuestas en BD:", dbErr.message);
      }
    }

    // Emitir revelación (incluye correctAnswer y explanation)
    io.to(room.code).emit("question_revealed", {
      matchId: match.id,
      question: {
        id: q.id,
        type: q.type,
        question: q.question,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || null
      },
      results: {
        playerA: {
          participantId: playerA.id,
          name: playerA.name,
          isCorrect: resultA.isCorrect,
          points: resultA.points,
          elapsedMs: resultA.elapsedMs,
          givenAnswer: resultA.givenAnswer
        },
        playerB: {
          participantId: playerB.id,
          name: playerB.name,
          isCorrect: resultB.isCorrect,
          points: resultB.points,
          elapsedMs: resultB.elapsedMs,
          givenAnswer: resultB.givenAnswer
        }
      },
      matchScores: {
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        nameA: playerA.name,
        nameB: playerB.name
      },
      questionsPlayed: match.questionsPlayed,
      totalQuestions: room.settings.questionsPerDuel
    });

    return { resultA, resultB, match };
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// checkMatchEnd
// ---------------------------------------------------------------------------

/**
 * Verifica si el duelo ha terminado (se jugaron todas las preguntas).
 * Si ambos tienen 0 puntos al llegar al límite, el duelo NO termina:
 * debe seguir con preguntas extra hasta que alguno acierte al menos una.
 * @param {object} room - La sala activa.
 * @returns {boolean}
 */
function checkMatchEnd(room) {
  const match = room.matches.get(room.currentMatchId) ||
    (room.thirdMatch && room.thirdMatch.id === room.currentMatchId ? room.thirdMatch : null);

  if (!match) return false;

  const questionsPlayed = match.questionsPlayed || 0;
  if (questionsPlayed < room.settings.questionsPerDuel) return false;

  // Se jugaron todas las preguntas del duelo.
  // Si ambos tienen 0 puntos → empate absoluto → continuar con preguntas extra.
  if (match.scoreA === 0 && match.scoreB === 0) {
    // Marcar que estamos en fase de desempate para que el organizador lo sepa
    match.inZeroTiebreak = true;
    return false; // No terminar todavía
  }

  return true;
}

// ---------------------------------------------------------------------------
// finishMatch
// ---------------------------------------------------------------------------

/**
 * Finaliza el match activo, determina ganador y lo avanza en el bracket.
 * @param {object} room - La sala activa.
 * @param {object} io   - Instancia de Socket.IO.
 * @returns {{ winner, loser, isTiebreak }}
 */
async function finishMatch(room, io) {
  const release = acquireLock(room);
  try {
    if (room.duelState !== "answer_revealed") {
      throw new Error(`No se puede finalizar el match en estado '${room.duelState}'.`);
    }

    const match = room.matches.get(room.currentMatchId) ||
      (room.thirdMatch && room.thirdMatch.id === room.currentMatchId ? room.thirdMatch : null);

    if (!match) throw new Error("No hay un enfrentamiento activo.");

    const playerA = match.playerA;
    const playerB = match.playerB;

    let winner, loser, isTiebreak = false;

    if (match.scoreA > match.scoreB) {
      winner = playerA;
      loser = playerB;
    } else if (match.scoreB > match.scoreA) {
      winner = playerB;
      loser = playerA;
    } else {
      // Empate: desempate por velocidad promedio en respuestas correctas
      isTiebreak = true;

      // Calcular suma de elapsedMs en respuestas correctas para cada jugador
      let sumA = 0, countA = 0;
      let sumB = 0, countB = 0;

      for (const ans of (match._answerHistory || [])) {
        if (ans.participantId === playerA.id && ans.isCorrect && ans.elapsedMs !== null) {
          sumA += ans.elapsedMs;
          countA++;
        } else if (ans.participantId === playerB.id && ans.isCorrect && ans.elapsedMs !== null) {
          sumB += ans.elapsedMs;
          countB++;
        }
      }

      const avgA = countA > 0 ? sumA / countA : Infinity;
      const avgB = countB > 0 ? sumB / countB : Infinity;

      // Menor promedio de tiempo = más rápido = gana
      if (avgA <= avgB) {
        // playerA más rápido o ambos sin correctas → tiebreak arbitrario: playerA gana
        winner = playerA;
        loser = playerB;
      } else {
        winner = playerB;
        loser = playerA;
      }

      console.log(`⚖️ Empate en ${match.id}: tiebreak por velocidad → ganador: ${winner.name}`);
    }

    match.winner = winner;
    match.loser = loser;
    match.status = "completed";

    // Avanzar en el bracket
    advanceWinner(room.rounds, room.thirdMatch, match, room.rounds.length);

    room.duelState = "match_finished";

    // Marcar eliminado
    const loserParticipant = room.participants.get(loser.id);
    if (loserParticipant) loserParticipant.eliminated = true;

    // Persistir en BD
    if (db.getStatus().connected && room.id && !room.id.startsWith("mem-")) {
      try {
        await db.query(
          `UPDATE tournament_matches 
           SET winner_id = $1, loser_id = $2, status = 'completed', 
               completed_at = NOW(), score_a = $3, score_b = $4
           WHERE tournament_id = $5 AND match_id = $6`,
          [winner.id, loser.id, match.scoreA, match.scoreB, room.id, match.id]
        );
        // Actualizar estado del torneo
        await db.query(
          `UPDATE tournaments SET current_match_id = NULL WHERE id = $1`,
          [room.id]
        );
      } catch (dbErr) {
        console.warn("⚠️ No se pudo persistir resultado del match en BD:", dbErr.message);
      }
    }

    // Determinar puntuación del ganador y perdedor según si era playerA o playerB
    const winnerScore = winner.id === playerA.id ? match.scoreA : match.scoreB;
    const loserScore = loser.id === playerA.id ? match.scoreA : match.scoreB;

    io.to(room.code).emit("duel_result", {
      matchId: match.id,
      winner: { id: winner.id, name: winner.name, score: winnerScore },
      loser: { id: loser.id, name: loser.name, score: loserScore },
      isTiebreak,
      rounds: room.rounds,
      thirdMatch: room.thirdMatch
    });

    return { winner, loser, isTiebreak };
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// selectNextMatch
// ---------------------------------------------------------------------------

/**
 * Busca el próximo match disponible en el bracket.
 * @param {object} room - La sala activa.
 * @returns {{ nextMatch: object|null, tournamentFinished: boolean }}
 */
function selectNextMatch(room) {
  // Buscar en todas las rondas
  for (const round of room.rounds) {
    for (const match of round) {
      if (match.status === "ready") {
        return { nextMatch: match, tournamentFinished: false };
      }
    }
  }

  // Verificar thirdMatch
  if (room.thirdMatch && room.thirdMatch.status === "ready") {
    return { nextMatch: room.thirdMatch, tournamentFinished: false };
  }

  // Verificar si todos los matches están completos
  const allMatches = room.rounds.flat().concat(room.thirdMatch ? [room.thirdMatch] : []);
  const pending = allMatches.filter(m => m.status !== "completed" && !m.isBye);

  if (pending.length === 0) {
    return { nextMatch: null, tournamentFinished: true };
  }

  // Hay matches pero ninguno ready aún (esperando jugadores del bracket)
  return { nextMatch: null, tournamentFinished: false };
}

// ---------------------------------------------------------------------------
// finishTournament
// ---------------------------------------------------------------------------

/**
 * Finaliza el torneo, construye el podio y emite el evento final.
 * @param {object} room - La sala activa.
 * @param {object} io   - Instancia de Socket.IO.
 * @returns {{ podium }}
 */
async function finishTournament(room, io) {
  const release = acquireLock(room);
  try {
    room.status = "finished";
    room.duelState = "tournament_finished";

    // Construir podio:
    // 1er lugar: ganador de la final (última ronda, índice 0)
    // 2do lugar: perdedor de la final
    // 3er lugar: ganador de thirdMatch (si existe)
    const podium = [];

    const totalRounds = room.rounds.length;
    if (totalRounds > 0) {
      const finalRound = room.rounds[totalRounds - 1];
      const finalMatch = finalRound && finalRound[0];

      if (finalMatch && finalMatch.winner) {
        podium.push({
          rank: 1,
          id: finalMatch.winner.id,
          name: finalMatch.winner.name,
          score: finalMatch.winner.id === finalMatch.playerA?.id ? finalMatch.scoreA : finalMatch.scoreB
        });
      }
      if (finalMatch && finalMatch.loser) {
        podium.push({
          rank: 2,
          id: finalMatch.loser.id,
          name: finalMatch.loser.name,
          score: finalMatch.loser.id === finalMatch.playerA?.id ? finalMatch.scoreA : finalMatch.scoreB
        });
      }
    }

    if (room.thirdMatch && room.thirdMatch.winner) {
      podium.push({
        rank: 3,
        id: room.thirdMatch.winner.id,
        name: room.thirdMatch.winner.name,
        score: room.thirdMatch.winner.id === room.thirdMatch.playerA?.id
          ? room.thirdMatch.scoreA
          : room.thirdMatch.scoreB
      });
    }

    // 4° lugar: perdedor del partido por el tercer puesto (si existe)
    if (room.thirdMatch && room.thirdMatch.loser) {
      podium.push({
        rank: 4,
        id: room.thirdMatch.loser.id,
        name: room.thirdMatch.loser.name,
        score: room.thirdMatch.loser.id === room.thirdMatch.playerA?.id
          ? room.thirdMatch.scoreA
          : room.thirdMatch.scoreB
      });
    }

    // Actualizar finalRank de los participantes del podio
    for (const entry of podium) {
      const p = room.participants.get(entry.id);
      if (p) p.finalRank = entry.rank;
    }

    // Persistir en BD
    if (db.getStatus().connected && room.id && !room.id.startsWith("mem-")) {
      try {
        await db.withTransaction(async (client) => {
          await client.query(
            `UPDATE tournaments SET status = 'finished', finished_at = NOW() WHERE id = $1`,
            [room.id]
          );

          for (const entry of podium) {
            await client.query(
              `INSERT INTO tournament_results (tournament_id, participant_id, final_rank)
               VALUES ($1, $2, $3)
               ON CONFLICT (tournament_id, participant_id) DO UPDATE SET final_rank = EXCLUDED.final_rank`,
              [room.id, entry.id, entry.rank]
            );
            await client.query(
              `UPDATE participants SET final_rank = $1, eliminated = FALSE WHERE id = $2`,
              [entry.rank, entry.id]
            );
          }

          await client.query(
            `INSERT INTO tournament_events (tournament_id, event_type, payload)
             VALUES ($1, 'TOURNAMENT_FINISHED', $2)`,
            [room.id, JSON.stringify({ podium })]
          );
        });
      } catch (dbErr) {
        console.warn("⚠️ No se pudo persistir fin del torneo en BD:", dbErr.message);
      }
    }

    io.to(room.code).emit("tournament_finished", {
      podium,
      code: room.code
    });

    return { podium };
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  startMatch,
  launchQuestion,
  closeQuestion,
  revealAnswer,
  checkMatchEnd,
  finishMatch,
  selectNextMatch,
  finishTournament
};
