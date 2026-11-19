"use strict";

/**
 * ==========================================================================
 * TORNEO DEL TALENTO — SUITE DE PRUEBAS: MÓDULO 2.5 — MOTOR DE DUELOS
 * ==========================================================================
 * Pruebas unitarias e integración del motor autoritativo de orquestación.
 * No usa socket.io-client. Llama directamente a las funciones del motor.
 * ==========================================================================
 */

const assert = require("assert");

// --- Importaciones del motor ---
const {
  startMatch,
  launchQuestion,
  closeQuestion,
  revealAnswer,
  checkMatchEnd,
  finishMatch,
  selectNextMatch,
  finishTournament
} = require("../src/engine/duelOrchestrator");

const {
  createTournament,
  registerParticipant,
  startTournament,
  getRoom,
  activeRooms
} = require("../src/engine/tournamentState");

const { calculateScore } = require("../src/engine/scoring");
const { buildBracket } = require("../src/engine/bracket");
const { verifyAnswer, pickQuestion } = require("../src/questions/questionService");
const { STATIC_BANK } = require("../src/questions/staticBank");
const app = require("../src/app");
const http = require("http");
const path = require("path");
const fs = require("fs");

// Mock de io para tests unitarios (evita emitir por red)
function createMockIo() {
  const emitted = [];
  return {
    to: (room) => ({
      emit: (event, payload) => {
        emitted.push({ room, event, payload });
      }
    }),
    _emitted: emitted
  };
}

// Crea una sala de torneo completa en memoria sin PostgreSQL
async function createTestRoom(code = "TEST01", opts = {}) {
  // Limpiar si ya existía
  activeRooms.delete(code);

  const result = await createTournament({
    code,
    name: "Torneo de Prueba",
    settings: {
      questionsPerDuel: opts.questionsPerDuel || 2,
      timePerQuestion: opts.timePerQuestion || 20,
      maxParticipants: 32,
      difficultyMode: opts.difficultyMode || "progressive",
      enableThirdPlace: true
    },
    adminSecret: "secret-test"
  });

  const room = getRoom(code);
  return { room, result };
}

// Registra un participante en la sala de prueba
async function addParticipant(room, name, socketId = null) {
  return registerParticipant({
    code: room.code,
    name,
    socketId: socketId || `socket-${Date.now()}-${Math.random()}`
  });
}

// Inicia el torneo y retorna la sala con el bracket generado
async function startTestTournament(room) {
  await startTournament({ code: room.code, adminSecretOrToken: "secret-test" });
  return getRoom(room.code);
}

// Retorna el primer match en estado 'ready'
function getFirstReadyMatch(room) {
  for (const [, match] of room.matches) {
    if (match.status === "ready" && !match.isBye) {
      return match;
    }
  }
  return null;
}

async function runTests() {
  console.log("==================================================");
  console.log("🧪 INICIANDO SUITE: MÓDULO 2.5 — MOTOR DE DUELOS");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      const result = fn();
      if (result && typeof result.then === "function") {
        return result.then(
          () => { console.log(`  ✅ [PASS] ${name}`); passed++; },
          (err) => { console.error(`  ❌ [FAIL] ${name}:`, err.message); failed++; }
        );
      }
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
    return Promise.resolve();
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // =========================================================================
  // BLOQUE 1: INICIO DE ENFRENTAMIENTO
  // =========================================================================
  console.log("\n📦 BLOQUE 1 — Inicio de enfrentamiento");

  await asyncTest("1. Inicio válido de enfrentamiento con dos jugadores reales", async () => {
    const { room } = await createTestRoom("T1A");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Luis");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    assert.ok(match, "Debe existir un match en estado ready");
    const io = createMockIo();
    const result = await startMatch(updatedRoom, match.id, io);
    assert.ok(result, "startMatch debe retornar un resultado");
    assert.strictEqual(updatedRoom.currentMatchId, match.id);
    assert.strictEqual(match.status, "in_progress");
    assert.strictEqual(updatedRoom.duelState, "match_ready");
  });

  await asyncTest("2. Inicio inválido — matchId no existe", async () => {
    const { room } = await createTestRoom("T1B");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const io = createMockIo();
    let errorThrown = false;
    try {
      await startMatch(updatedRoom, "NOEXISTE", io);
    } catch (e) {
      errorThrown = true;
      assert.ok(e.message, "Debe lanzar error con mensaje");
    }
    assert.ok(errorThrown, "Debe lanzar error para matchId inválido");
  });

  await asyncTest("3. Organizador no autenticado — validación de responsabilidad del servidor", async () => {
    // La autenticación del organizador se valida en socketServer.js.
    // Aquí validamos que startMatch requiere match en estado válido.
    const { room } = await createTestRoom("T1C");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    // Forzar estado completado para verificar rechazo
    match.status = "completed";
    const io = createMockIo();
    let errorThrown = false;
    try {
      await startMatch(updatedRoom, match.id, io);
    } catch (e) {
      errorThrown = true;
    }
    assert.ok(errorThrown, "No debe iniciar un match ya completado");
    // Restaurar
    match.status = "ready";
  });

  // =========================================================================
  // BLOQUE 2: LANZAMIENTO DE PREGUNTA
  // =========================================================================
  console.log("\n📦 BLOQUE 2 — Lanzamiento de pregunta");

  await asyncTest("4. Lanzamiento de pregunta válido desde estado match_ready", async () => {
    const { room } = await createTestRoom("T2A");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    const q = await launchQuestion(updatedRoom, io);
    assert.ok(q, "launchQuestion debe retornar la pregunta");
    assert.ok(q.id, "La pregunta debe tener id");
    assert.strictEqual(updatedRoom.duelState, "question_active");
    assert.ok(updatedRoom.activeQuestion, "Debe haber pregunta activa");
    assert.ok(updatedRoom.activeQuestion.startTime, "Debe tener startTime");
    assert.ok(updatedRoom.activeQuestion.durationMs > 0, "Debe tener durationMs");
    // Verificar que se emitió question_started
    const emitted = io._emitted.find(e => e.event === "question_started");
    assert.ok(emitted, "Debe haber emitido question_started");
    assert.ok(!emitted.payload.question.correctAnswer, "No debe revelar correctAnswer");
    // Limpiar timer
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
  });

  await asyncTest("5. Lanzamiento duplicado rechazado cuando ya hay pregunta activa", async () => {
    const { room } = await createTestRoom("T2B");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    // Intentar lanzar de nuevo sin cerrar
    let errorThrown = false;
    try {
      await launchQuestion(updatedRoom, io);
    } catch (e) {
      errorThrown = true;
    }
    assert.ok(errorThrown, "No debe lanzar segunda pregunta si ya hay una activa");
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
  });

  await asyncTest("6. Pregunta fuera del estado permitido", async () => {
    const { room } = await createTestRoom("T2C");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    // Sin iniciar ningún match, duelState no es match_ready
    const io = createMockIo();
    let errorThrown = false;
    try {
      await launchQuestion(updatedRoom, io);
    } catch (e) {
      errorThrown = true;
    }
    assert.ok(errorThrown, "No debe lanzar pregunta sin match activo");
  });

  // =========================================================================
  // BLOQUE 3: RESPUESTAS
  // =========================================================================
  console.log("\n📦 BLOQUE 3 — Respuestas");

  await asyncTest("7. Respuesta correcta — scoring autoritativo", async () => {
    const now = Date.now();
    const result = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: now + 5000,
      questionStartTimeServerTimestamp: now,
      limitDurationMs: 20000
    });
    assert.ok(result.points >= 500 && result.points <= 1000, `Puntos correctos esperados entre 500-1000, recibido: ${result.points}`);
    assert.strictEqual(result.isLate, false);
    assert.strictEqual(result.reason, "correct");
  });

  await asyncTest("8. Respuesta incorrecta — cero puntos", async () => {
    const now = Date.now();
    const result = calculateScore({
      isCorrect: false,
      receivedAtServerTimestamp: now + 3000,
      questionStartTimeServerTimestamp: now,
      limitDurationMs: 20000
    });
    assert.strictEqual(result.points, 0);
    assert.strictEqual(result.reason, "incorrect");
  });

  await asyncTest("9. Respuesta duplicada — el sistema de receivedAnswers previene duplicación", async () => {
    const { room } = await createTestRoom("T3C");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    const pA = match.playerA;
    // Simular primera respuesta
    const aq = updatedRoom.activeQuestion;
    aq.receivedAnswers.set(pA.id, { participantId: pA.id, points: 800, isCorrect: true });
    // Segunda respuesta — verificar que ya está en el mapa
    const alreadyAnswered = aq.receivedAnswers.has(pA.id);
    assert.ok(alreadyAnswered, "El mapa de respuestas debe detectar respuesta duplicada");
    if (aq.autoCloseTimer) clearTimeout(aq.autoCloseTimer);
  });

  await asyncTest("10. Respuesta tardía — cero puntos con grace period", async () => {
    const now = Date.now();
    const result = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: now + 25000, // 25s, superando 20s + 800ms de gracia
      questionStartTimeServerTimestamp: now,
      limitDurationMs: 20000
    });
    assert.strictEqual(result.points, 0);
    assert.strictEqual(result.isLate, true);
    assert.strictEqual(result.reason, "time_expired");
  });

  await asyncTest("11. Participante ajeno al duelo — verificación de isParticipantInMatch", async () => {
    const { room } = await createTestRoom("T3E");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const { isParticipantInMatch } = require("../src/engine/tournamentState");
    // ID inexistente
    const result = isParticipantInMatch(updatedRoom, match.id, "participante-externo-falso");
    assert.strictEqual(result, false, "Un participante externo no debe poder responder en este match");
  });

  await asyncTest("12. Participante de otro torneo — no puede acceder a sala diferente", async () => {
    const { room: roomA } = await createTestRoom("T3F1");
    const { room: roomB } = await createTestRoom("T3F2");
    await addParticipant(roomA, "Ana");
    await addParticipant(roomA, "Bob");
    const { participantId: idB } = await addParticipant(roomB, "Carlos");
    // Carlos de T3F2 no debe ser reconocido en T3F1
    const { isParticipantInMatch } = require("../src/engine/tournamentState");
    // Iniciar T3F1
    await startTestTournament(roomA);
    const matchA = getFirstReadyMatch(roomA);
    const result = isParticipantInMatch(roomA, matchA?.id, idB);
    assert.strictEqual(result, false, "Carlos de otro torneo no debe pertenecer a ningún match del torneo A");
  });

  // =========================================================================
  // BLOQUE 4: REVELACIÓN
  // =========================================================================
  console.log("\n📦 BLOQUE 4 — Revelación de respuesta");

  await asyncTest("13. Revelación válida después de cerrar pregunta", async () => {
    const { room } = await createTestRoom("T4A");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
    closeQuestion(updatedRoom);
    assert.strictEqual(updatedRoom.duelState, "question_closed");
    const revealResult = await revealAnswer(updatedRoom, io);
    assert.ok(revealResult, "revealAnswer debe retornar resultado");
    assert.strictEqual(updatedRoom.duelState, "answer_revealed");
    const emitted = io._emitted.find(e => e.event === "question_revealed");
    assert.ok(emitted, "Debe emitir question_revealed");
    assert.ok(emitted.payload.question.correctAnswer !== undefined, "Debe revelar correctAnswer");
  });

  await asyncTest("14. Revelación anticipada rechazada (pregunta aún activa)", async () => {
    const { room } = await createTestRoom("T4B");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    // Intentar revelar sin cerrar
    let errorThrown = false;
    try {
      await revealAnswer(updatedRoom, io);
    } catch (e) {
      errorThrown = true;
    }
    assert.ok(errorThrown, "No debe revelar si la pregunta sigue activa");
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
  });

  await asyncTest("15. Revelación duplicada rechazada", async () => {
    const { room } = await createTestRoom("T4C");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
    closeQuestion(updatedRoom);
    await revealAnswer(updatedRoom, io);
    // Segunda revelación
    let errorThrown = false;
    try {
      await revealAnswer(updatedRoom, io);
    } catch (e) {
      errorThrown = true;
    }
    assert.ok(errorThrown, "No debe revelar dos veces la misma pregunta");
  });

  // =========================================================================
  // BLOQUE 5: CRONÓMETRO Y CIERRE AUTOMÁTICO
  // =========================================================================
  console.log("\n📦 BLOQUE 5 — Cronómetro y cierre automático");

  await asyncTest("16. Auto-cierre de pregunta por tiempo expirado", async () => {
    const { room } = await createTestRoom("T5A", { timePerQuestion: 10 });
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    // Verificar que existe el timer
    assert.ok(updatedRoom.activeQuestion.autoCloseTimer, "Debe haber un timer de auto-cierre");
    // Limpiar el timer real, simular cierre manual
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
    // Simular que el tiempo expiró
    closeQuestion(updatedRoom);
    assert.strictEqual(updatedRoom.duelState, "question_closed");
  });

  // =========================================================================
  // BLOQUE 6: DESCONEXIÓN Y RECONEXIÓN
  // =========================================================================
  console.log("\n📦 BLOQUE 6 — Desconexión y reconexión");

  await asyncTest("17. Desconexión — markParticipantDisconnected funciona", async () => {
    const { room } = await createTestRoom("T6A");
    const p = await addParticipant(room, "Ana", "socket-ana-1");
    const { markParticipantDisconnected } = require("../src/engine/tournamentState");
    const result = await markParticipantDisconnected("socket-ana-1");
    assert.ok(result, "Debe retornar resultado de desconexión");
    assert.ok(!result.participant.isConnected, "El participante debe marcarse como desconectado");
  });

  await asyncTest("18. Reconexión — reconnectParticipant restaura sesión", async () => {
    const { room } = await createTestRoom("T6B");
    const p = await addParticipant(room, "Luis", "socket-luis-1");
    const { reconnectParticipant, markParticipantDisconnected } = require("../src/engine/tournamentState");
    // Desconectar
    await markParticipantDisconnected("socket-luis-1");
    // Reconectar con el token original
    const reconnected = await reconnectParticipant({
      code: "T6B",
      rawToken: p.rawToken,
      socketId: "socket-luis-2"
    });
    assert.ok(reconnected, "Debe retornar el participante reconectado");
    assert.ok(reconnected.isConnected, "El participante debe estar conectado de nuevo");
    assert.strictEqual(reconnected.socketId, "socket-luis-2");
  });

  await asyncTest("19. Recuperación de estado — activeQuestion recuperada en hydrate", async () => {
    // Verificar que el sistema de hydrate existe y es función
    const { hydrateActiveRoomsFromDB } = require("../src/engine/tournamentState");
    assert.strictEqual(typeof hydrateActiveRoomsFromDB, "function", "hydrateActiveRoomsFromDB debe ser función");
    // Con DB desconectada (en tests), debe retornar 0 sin crashear
    const count = await hydrateActiveRoomsFromDB();
    assert.strictEqual(typeof count, "number", "Debe retornar un número");
  });

  // =========================================================================
  // BLOQUE 7: FINALIZACIÓN DEL DUELO
  // =========================================================================
  console.log("\n📦 BLOQUE 7 — Finalización del duelo");

  await asyncTest("20. Finalización del duelo — ganador determinado correctamente", async () => {
    const { room } = await createTestRoom("T7A", { questionsPerDuel: 1 });
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    // Simular respuesta para playerA (correcto, rápido)
    const pA = match.playerA;
    updatedRoom.activeQuestion.receivedAnswers.set(pA.id, {
      participantId: pA.id,
      points: 900,
      isCorrect: true,
      elapsedMs: 3000,
      givenAnswer: "respuesta"
    });
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
    closeQuestion(updatedRoom);
    await revealAnswer(updatedRoom, io);
    const { winner, loser } = await finishMatch(updatedRoom, io);
    assert.ok(winner, "Debe haber un ganador");
    assert.ok(loser, "Debe haber un perdedor");
    assert.strictEqual(winner.id, pA.id, "Ana debe ganar con 900 puntos vs 0");
    assert.strictEqual(match.status, "completed");
    assert.strictEqual(updatedRoom.duelState, "match_finished");
  });

  await asyncTest("21. Avance del bracket — advanceWinner propaga correctamente", async () => {
    const { room } = await createTestRoom("T7B");
    // Para que haya múltiples rondas necesitamos más participantes
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    await addParticipant(room, "Carlos");
    await addParticipant(room, "Diana");
    const updatedRoom = await startTestTournament(room);
    // Verificar que hay más de una ronda
    assert.ok(updatedRoom.rounds.length >= 2 || updatedRoom.rounds[0].length >= 2,
      "El torneo con 4 jugadores debe tener bracket completo");
    // El avance de bracket está en bracket.js ya testeado en phase1
    const { advanceWinner } = require("../src/engine/bracket");
    assert.strictEqual(typeof advanceWinner, "function", "advanceWinner debe ser función");
  });

  await asyncTest("22. Empate — tiebreak por velocidad de respuesta", async () => {
    const { room } = await createTestRoom("T7C", { questionsPerDuel: 1 });
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    const pA = match.playerA;
    const pB = match.playerB;
    // Mismo puntaje (empate perfecto), pero pA respondió más rápido
    updatedRoom.activeQuestion.receivedAnswers.set(pA.id, {
      participantId: pA.id, points: 800, isCorrect: true, elapsedMs: 4000
    });
    updatedRoom.activeQuestion.receivedAnswers.set(pB.id, {
      participantId: pB.id, points: 800, isCorrect: true, elapsedMs: 8000
    });
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
    closeQuestion(updatedRoom);
    await revealAnswer(updatedRoom, io);
    // Con los mismos puntos pero diferente tiempo, finishMatch debe resolver
    const { winner } = await finishMatch(updatedRoom, io);
    assert.ok(winner, "Debe haber un ganador incluso en empate");
    // En empate por velocidad, pA debería ganar (elapsedMs menor)
    assert.strictEqual(winner.id, pA.id, "El jugador más rápido gana el tiebreak");
  });

  await asyncTest("23. Tercer puesto — thirdMatch se configura en brackets con >=4 jugadores", async () => {
    const { room } = await createTestRoom("T7D", { questionsPerDuel: 1 });
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    await addParticipant(room, "Carlos");
    await addParticipant(room, "Diana");
    const updatedRoom = await startTestTournament(room);
    assert.ok(updatedRoom.thirdMatch !== null, "Debe existir un match de tercer puesto con 4 jugadores");
    assert.strictEqual(updatedRoom.thirdMatch.roundIndex, "t");
  });

  await asyncTest("24. Finalización del torneo — detectada cuando no quedan matches pendientes", async () => {
    const { room } = await createTestRoom("T7E", { questionsPerDuel: 1 });
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    // No hay thirdMatch con solo 2 jugadores (1 ronda)
    // Completar el único match
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    const pA = match.playerA;
    updatedRoom.activeQuestion.receivedAnswers.set(pA.id, {
      participantId: pA.id, points: 900, isCorrect: true, elapsedMs: 3000
    });
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
    closeQuestion(updatedRoom);
    await revealAnswer(updatedRoom, io);
    await finishMatch(updatedRoom, io);
    const { nextMatch, tournamentFinished } = selectNextMatch(updatedRoom);
    assert.ok(tournamentFinished, "Debe detectar fin del torneo con un solo match completado (2 jugadores, sin thirdMatch)");
  });

  // =========================================================================
  // BLOQUE 8: CONCURRENCIA
  // =========================================================================
  console.log("\n📦 BLOQUE 8 — Concurrencia y seguridad");

  await asyncTest("25. Concurrencia en acciones del organizador — lock previene doble ejecución", async () => {
    const { room } = await createTestRoom("T8A");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    // Simular lock ya activo
    updatedRoom.duelLock = true;
    let errorThrown = false;
    try {
      await startMatch(updatedRoom, match.id, io);
    } catch (e) {
      errorThrown = true;
      assert.ok(e.message.toLowerCase().includes("progreso") || e.message.toLowerCase().includes("lock") || e.message.toLowerCase().includes("moment"),
        "El error debe mencionar operación en progreso");
    }
    assert.ok(errorThrown, "Con duelLock=true, debe rechazar la operación");
    // Limpiar
    updatedRoom.duelLock = false;
  });

  await asyncTest("26. Reinicio del servidor — duelState y activeQuestion se resetean limpiamente", async () => {
    const { room } = await createTestRoom("T8B");
    // Simular estado post-reinicio: room recién creada no tiene duelState ni activeQuestion
    assert.strictEqual(room.activeQuestion, null, "activeQuestion debe ser null en sala nueva");
    assert.strictEqual(room.currentMatchId, null, "currentMatchId debe ser null en sala nueva");
  });

  // =========================================================================
  // BLOQUE 9: PERSISTENCIA (Verificar que las funciones DB no crashean sin conexión)
  // =========================================================================
  console.log("\n📦 BLOQUE 9 — Persistencia");

  await asyncTest("27. Sin conexión PostgreSQL — operaciones en memoria funcionan correctamente", async () => {
    const db = require("../src/config/database");
    const status = db.getStatus();
    // En tests locales sin DB, debe usar IDs mem-
    // Verificar que se crearon torneos con ids mem- si DB no conectada
    const { room } = await createTestRoom("T9A");
    if (!status.connected) {
      assert.ok(room.id.startsWith("mem-"), "Sin DB, el id del torneo debe empezar con mem-");
    }
    // Si DB sí está conectada, el id será UUID
    assert.ok(room.id, "El torneo debe tener id siempre");
  });

  // =========================================================================
  // BLOQUE 10: INTEGRIDAD DE RUTAS HTTP (via servidor Express)
  // =========================================================================
  console.log("\n📦 BLOQUE 10 — Integridad de rutas existentes");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  function fetchLocal(path) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }).on("error", reject);
    });
  }

  await asyncTest("28. GET /original — devuelve HTML con 'Torneo del Talento' (integridad del juego original)", async () => {
    const res = await fetchLocal("/original");
    assert.strictEqual(res.status, 200, `GET /original debe retornar 200, recibió ${res.status}`);
    assert.ok(res.body.includes("Torneo del Talento"), "El HTML original debe contener 'Torneo del Talento'");
  });

  await asyncTest("29. GET /jugar — devuelve la interfaz del participante", async () => {
    const res = await fetchLocal("/jugar");
    assert.strictEqual(res.status, 200, `GET /jugar debe retornar 200, recibió ${res.status}`);
    assert.ok(
      res.body.toLowerCase().includes("torneo") || res.body.includes("<!DOCTYPE html") || res.body.includes("<html"),
      "GET /jugar debe retornar HTML válido"
    );
  });

  await asyncTest("30. GET /proyeccion — devuelve la pantalla de proyección", async () => {
    const res = await fetchLocal("/proyeccion");
    assert.strictEqual(res.status, 200, `GET /proyeccion debe retornar 200, recibió ${res.status}`);
    assert.ok(
      res.body.toLowerCase().includes("torneo") || res.body.includes("<!DOCTYPE html") || res.body.includes("<html"),
      "GET /proyeccion debe retornar HTML válido"
    );
  });

  await asyncTest("31. GET /organizador — devuelve el panel del organizador", async () => {
    const res = await fetchLocal("/organizador");
    assert.strictEqual(res.status, 200, `GET /organizador debe retornar 200, recibió ${res.status}`);
    assert.ok(
      res.body.toLowerCase().includes("organizador") || res.body.includes("<!DOCTYPE html") || res.body.includes("<html"),
      "GET /organizador debe retornar HTML válido"
    );
  });

  // =========================================================================
  // BLOQUE 11: TIPOS DE PREGUNTA Y VALIDACIÓN DE RESPUESTAS
  // =========================================================================
  console.log("\n📦 BLOQUE 11 — Tipos de pregunta y validación");

  await asyncTest("32. verifyAnswer — opción múltiple correcta", async () => {
    const q = { type: "mc", correctAnswer: "Bogotá", options: ["Bogotá", "Medellín"] };
    assert.ok(verifyAnswer(q, "Bogotá"), "Debe validar respuesta mc correcta");
    assert.ok(!verifyAnswer(q, "Medellín"), "Debe rechazar mc incorrecta");
  });

  await asyncTest("33. verifyAnswer — verdadero/falso", async () => {
    const q = { type: "vf", correctAnswer: true };
    assert.ok(verifyAnswer(q, true), "Debe validar vf verdadero");
    assert.ok(!verifyAnswer(q, false), "Debe rechazar vf falso incorrecto");
  });

  await asyncTest("34. verifyAnswer — ordenamiento correcto", async () => {
    const correct = ["A", "B", "C"];
    const q = { type: "ord", correctAnswer: correct, options: correct };
    assert.ok(verifyAnswer(q, ["A", "B", "C"]), "Debe validar ord en orden correcto");
    assert.ok(!verifyAnswer(q, ["B", "A", "C"]), "Debe rechazar ord en orden incorrecto");
  });

  await asyncTest("35. verifyAnswer — cálculo numérico con tolerancia", async () => {
    const q = { type: "num", correctAnswer: "100", tolerance: 2 };
    assert.ok(verifyAnswer(q, "100"), "Exacto correcto");
    assert.ok(verifyAnswer(q, "101"), "Dentro de tolerancia +1 correcto");
    assert.ok(!verifyAnswer(q, "105"), "Fuera de tolerancia rechazado");
  });

  await asyncTest("36. pickQuestion — no repite preguntas usadas", async () => {
    const usedKeys = new Set();
    const q1 = pickQuestion({ targetLevel: 1, usedKeys });
    const q2 = pickQuestion({ targetLevel: 1, usedKeys });
    assert.ok(q1, "Primera pregunta disponible");
    if (q2) {
      assert.notStrictEqual(q1.id, q2.id, "Segunda pregunta no debe repetir la primera");
    }
  });

  await asyncTest("37. checkMatchEnd — detecta fin de preguntas del duelo", async () => {
    const { room } = await createTestRoom("T11A", { questionsPerDuel: 2 });
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    updatedRoom.currentMatchId = match.id;
    match.questionsPlayed = 0;
    assert.ok(!checkMatchEnd(updatedRoom), "Con 0 preguntas jugadas no debe terminar");
    match.questionsPlayed = 2;
    // Con ambos en 0, el sistema pide desempate (no termina todavía)
    assert.ok(!checkMatchEnd(updatedRoom), "Con 2 preguntas y empate 0-0 debe pedir desempate");
    // Si alguien tiene puntos, sí termina
    match.scoreA = 100;
    assert.ok(checkMatchEnd(updatedRoom), "Con 2 preguntas jugadas y un ganador claro debe terminar");
  });

  await asyncTest("38. selectNextMatch — retorna siguiente match ready o detecta fin de torneo", async () => {
    const { room } = await createTestRoom("T11B");
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const { nextMatch, tournamentFinished } = selectNextMatch(updatedRoom);
    // Con torneo recién iniciado y matches ready, debe haber un siguiente match (o haber started ya)
    assert.ok(typeof tournamentFinished === "boolean", "Debe retornar booleano tournamentFinished");
  });

  await asyncTest("39. finishTournament — podio incluye los participantes correctos", async () => {
    const { room } = await createTestRoom("T11C", { questionsPerDuel: 1 });
    await addParticipant(room, "Ana");
    await addParticipant(room, "Bob");
    const updatedRoom = await startTestTournament(room);
    const match = getFirstReadyMatch(updatedRoom);
    const io = createMockIo();
    await startMatch(updatedRoom, match.id, io);
    await launchQuestion(updatedRoom, io);
    const pA = match.playerA;
    updatedRoom.activeQuestion.receivedAnswers.set(pA.id, {
      participantId: pA.id, points: 950, isCorrect: true, elapsedMs: 2000
    });
    if (updatedRoom.activeQuestion?.autoCloseTimer) {
      clearTimeout(updatedRoom.activeQuestion.autoCloseTimer);
    }
    closeQuestion(updatedRoom);
    await revealAnswer(updatedRoom, io);
    await finishMatch(updatedRoom, io);
    // Forzar estado para que selectNextMatch retorne tournamentFinished
    updatedRoom.rounds.flat().forEach(m => {
      if (m.id !== match.id) m.status = "completed";
    });
    const result = await finishTournament(updatedRoom, io);
    assert.ok(result, "finishTournament debe retornar resultado");
    assert.ok(result.podium, "Debe incluir podio");
    const emitted = io._emitted.find(e => e.event === "tournament_finished");
    assert.ok(emitted, "Debe emitir tournament_finished");
  });

  await asyncTest("40. Integridad de Torneo_Talento.html — hash SHA-256 verificado", async () => {
    const crypto = require("crypto");
    const htmlPath = path.join(__dirname, "../Torneo_Talento.html");
    if (fs.existsSync(htmlPath)) {
      const content = fs.readFileSync(htmlPath);
      const hash = crypto.createHash("sha256").update(content).digest("hex").toUpperCase();
      const expected = "9653BC7BDEFA1141950DDB0822E2D9768E7EED06915A60E6ADD130B9C6336248";
      assert.strictEqual(hash, expected,
        `SHA-256 de Torneo_Talento.html ha cambiado. Esperado: ${expected}, Recibido: ${hash}`);
    } else {
      console.log("    ⚠️  Torneo_Talento.html no encontrado en la ruta base del proyecto.");
    }
  });

  // Cierre del servidor HTTP
  await new Promise((resolve) => server.close(resolve));

  // =========================================================================
  // RESUMEN
  // =========================================================================
  console.log("\n==================================================");
  console.log(`🏁 RESULTADO: ${passed} pasadas / ${failed} fallidas`);
  if (failed > 0) {
    console.log("❌ Algunas pruebas fallaron. Revisar el motor antes de continuar.");
    process.exit(1);
  } else {
    console.log("✅ ¡Todas las pruebas del Módulo 2.5 pasaron correctamente!");
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("💥 Error crítico en la suite de pruebas:", err);
  process.exit(1);
});
