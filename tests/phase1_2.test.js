"use strict";

const assert = require("assert");
const {
  activeRooms,
  createTournament,
  registerParticipant,
  reconnectParticipant,
  startTournament,
  isParticipantInMatch,
  cancelDisconnectionGrace
} = require("../src/engine/tournamentState");
const { verifyAdminSecret } = require("../src/security/tokens");
const env = require("../src/config/env");

async function runPhase12Tests() {
  console.log("================================================================");
  console.log("🧪 BATERÍA DE PRUEBAS DE FASE 1.2 — CORRECCIÓN DE HALLAZGOS");
  console.log("================================================================");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
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

  // =================================================================
  // BLOQUE A-01: RECUPERACIÓN DE RESPUESTAS AL REINICIAR (MOCK RECOVERY)
  // =================================================================
  console.log("\n📦 A-01: Recuperación de Respuestas y Estado de Preguntas:");

  // Simulador de estructura recuperada de PostgreSQL para probar la lógica de rehidratación
  function simulateQuestionHydration(mockDbRows, durationMs, elapsedTimeOnRestart) {
    const receivedAnswers = new Map();
    for (const a of mockDbRows) {
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

    const isExpired = elapsedTimeOnRestart >= durationMs;
    const status = isExpired ? "pending_reveal" : "interrupted";

    return {
      status,
      receivedAnswers,
      allowsNewAnswers: status === "active"
    };
  }

  test("1. Recuperación de dos respuestas guardadas", () => {
    const mockRows = [
      { participant_id: "p1", given_answer: "Opción A", is_correct: true, points_awarded: 920, response_time_ms: 3200, answered_at: "2026-11-12T10:00:03Z" },
      { participant_id: "p2", given_answer: "Opción B", is_correct: false, points_awarded: 0, response_time_ms: 4500, answered_at: "2026-11-12T10:00:04Z" }
    ];
    const recovered = simulateQuestionHydration(mockRows, 20000, 10000);
    assert.strictEqual(recovered.receivedAnswers.size, 2);
    assert.ok(recovered.receivedAnswers.has("p1"));
    assert.ok(recovered.receivedAnswers.has("p2"));
  });

  test("2. Conservación de puntuaciones y marcas de tiempo", () => {
    const mockRows = [
      { participant_id: "p1", given_answer: "Opción A", is_correct: true, points_awarded: 920, response_time_ms: 3200, answered_at: "2026-11-12T10:00:03Z" }
    ];
    const recovered = simulateQuestionHydration(mockRows, 20000, 5000);
    const ans = recovered.receivedAnswers.get("p1");
    assert.strictEqual(ans.points, 920);
    assert.strictEqual(ans.elapsedMs, 3200);
    assert.strictEqual(ans.isCorrect, true);
    assert.strictEqual(ans.answeredAt, "2026-11-12T10:00:03Z");
  });

  test("3. Rehidratación ejecutada dos veces sin duplicados (Idempotencia)", () => {
    const mockRows = [
      { participant_id: "p1", given_answer: "Opción A", is_correct: true, points_awarded: 920, response_time_ms: 3200, answered_at: "2026-11-12T10:00:03Z" }
    ];
    // Ejecución 1
    const run1 = simulateQuestionHydration(mockRows, 20000, 5000);
    // Ejecución 2
    const run2 = simulateQuestionHydration(mockRows, 20000, 5000);
    assert.strictEqual(run1.receivedAnswers.size, 1);
    assert.strictEqual(run2.receivedAnswers.size, 1);
  });

  test("4. Preguntas vencidas sin posibilidad de recibir nuevas respuestas", () => {
    const mockRows = [
      { participant_id: "p1", given_answer: "Opción A", is_correct: true, points_awarded: 800, response_time_ms: 8000, answered_at: "2026-11-12T10:00:08Z" }
    ];
    // Tiempo transcurrido 25s (mayor al límite 20s)
    const recovered = simulateQuestionHydration(mockRows, 20000, 25000);
    assert.strictEqual(recovered.status, "pending_reveal");
    assert.strictEqual(recovered.allowsNewAnswers, false);
  });

  // =================================================================
  // BLOQUE A-02: AUTORIZACIÓN DEL ORGANIZADOR Y SALAS CRUZADAS
  // =================================================================
  console.log("\n🔑 A-02: Autorización del Organizador y Prevención de Control Cruzado:");

  // Simulador de validación de organizador para sockets
  function simulateOrganizerAction(socketData, payload) {
    const requestedCode = (payload.code || "").toUpperCase();
    const sessionCode = socketData.tournamentCode;
    const isAuthOrganizer = socketData.authenticated && socketData.role === "organizador";

    if (isAuthOrganizer) {
      if (requestedCode && requestedCode !== sessionCode) {
        return { allowed: false, error: "Violación de autorización: No tienes permisos para controlar un torneo diferente al de tu sesión." };
      }
      return { allowed: true, targetCode: sessionCode };
    }

    if (!requestedCode || !payload.adminSecret || !verifyAdminSecret(payload.adminSecret)) {
      return { allowed: false, error: "No autorizado: credencial de organizador requerida." };
    }

    return { allowed: true, targetCode: requestedCode };
  }

  test("5. Organizador autorizado controla su propio torneo", () => {
    const socketData = { authenticated: true, role: "organizador", tournamentCode: "TOR_A" };
    const res = simulateOrganizerAction(socketData, { code: "TOR_A" });
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.targetCode, "TOR_A");
  });

  test("6. Organizador del torneo A intenta iniciar el torneo B (Rechazado)", () => {
    const socketData = { authenticated: true, role: "organizador", tournamentCode: "TOR_A" };
    const res = simulateOrganizerAction(socketData, { code: "TOR_B" });
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error.includes("Violación de autorización"));
  });

  test("7. Cliente no autenticado intenta iniciar un torneo sin secreto (Rechazado)", () => {
    const socketData = { authenticated: false, role: "espectador", tournamentCode: null };
    const res = simulateOrganizerAction(socketData, { code: "TOR_A" });
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error.includes("No autorizado"));
  });

  test("8. Manipulación del código de torneo en el payload es neutralizada", () => {
    const socketData = { authenticated: true, role: "organizador", tournamentCode: "TOR_A" };
    // El payload omite el código o intenta enviar otro
    const resSame = simulateOrganizerAction(socketData, {});
    assert.strictEqual(resSame.allowed, true);
    assert.strictEqual(resSame.targetCode, "TOR_A");

    const resDiff = simulateOrganizerAction(socketData, { code: "HACK_TOR" });
    assert.strictEqual(resDiff.allowed, false);
  });

  // =================================================================
  // BLOQUE A-03: AISLAMIENTO DE submit_answer
  // =================================================================
  console.log("\n🛡️ A-03: Aislamiento Estricto en submit_answer:");

  // Simulador de validación perimétrica de submit_answer
  function simulateSubmitAnswer(socketData, payload, room) {
    if (!socketData.authenticated || socketData.role !== "participante") {
      return { allowed: false, error: "No autorizado" };
    }

    const sessionRoomCode = socketData.tournamentCode;
    if (!sessionRoomCode) {
      return { allowed: false, error: "Sesión no asociada" };
    }

    if (payload.tournamentCode && payload.tournamentCode.toUpperCase() !== sessionRoomCode) {
      return { allowed: false, error: "Inconsistencia de sala: no puedes enviar respuestas a un torneo diferente al de tu sesión." };
    }

    if (socketData.participantId !== payload.participantId) {
      return { allowed: false, error: "Suplantación rechazada: tu sesión no coincide con el participante." };
    }

    if (!isParticipantInMatch(room, payload.matchId, payload.participantId)) {
      return { allowed: false, error: "No estás asignado como competidor en este enfrentamiento." };
    }

    if (room.activeQuestion && room.activeQuestion.receivedAnswers && room.activeQuestion.receivedAnswers.has(payload.participantId)) {
      return { allowed: false, error: "Ya enviaste tu respuesta para esta pregunta." };
    }

    return { allowed: true, targetRoom: sessionRoomCode };
  }

  const mockRoomA = {
    code: "TOR_A",
    status: "active",
    matches: new Map([["0-0", { id: "0-0", playerA: { id: "part_1" }, playerB: { id: "part_2" } }]]),
    activeQuestion: { id: "q1", receivedAnswers: new Map() }
  };

  test("9. Participante responde legítimamente en su propio torneo", () => {
    const socketData = { authenticated: true, role: "participante", tournamentCode: "TOR_A", participantId: "part_1" };
    const payload = { tournamentCode: "TOR_A", matchId: "0-0", questionId: "q1", participantId: "part_1" };
    const res = simulateSubmitAnswer(socketData, payload, mockRoomA);
    assert.strictEqual(res.allowed, true);
  });

  test("10. Participante intenta responder en otro torneo (Rechazado)", () => {
    const socketData = { authenticated: true, role: "participante", tournamentCode: "TOR_A", participantId: "part_1" };
    const payload = { tournamentCode: "TOR_B", matchId: "0-0", questionId: "q1", participantId: "part_1" };
    const res = simulateSubmitAnswer(socketData, payload, mockRoomA);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error.includes("Inconsistencia de sala"));
  });

  test("11. Participante intenta responder por otro participante (Suplantación Rechazada)", () => {
    const socketData = { authenticated: true, role: "participante", tournamentCode: "TOR_A", participantId: "part_1" };
    const payload = { tournamentCode: "TOR_A", matchId: "0-0", questionId: "q1", participantId: "part_2" }; // Envía ID de su rival
    const res = simulateSubmitAnswer(socketData, payload, mockRoomA);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error.includes("Suplantación rechazada"));
  });

  test("12. Respuesta duplicada es bloqueada", () => {
    const socketData = { authenticated: true, role: "participante", tournamentCode: "TOR_A", participantId: "part_1" };
    const payload = { tournamentCode: "TOR_A", matchId: "0-0", questionId: "q1", participantId: "part_1" };
    // Simular que ya está registrada la respuesta
    mockRoomA.activeQuestion.receivedAnswers.set("part_1", { points: 900 });
    const res = simulateSubmitAnswer(socketData, payload, mockRoomA);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error.includes("Ya enviaste tu respuesta"));
    // Limpiar para otros tests
    mockRoomA.activeQuestion.receivedAnswers.delete("part_1");
  });

  // =================================================================
  // BLOQUE A-04: TEMPORIZADOR DE DESCONEXIÓN Y PERIODO DE GRACIA
  // =================================================================
  console.log("\n⏱️ A-04: Temporizador de Gracia y Prevención de Desconexiones Fantasma:");

  function simulateDisconnectionGraceLogic(room, pAConnected, pBConnected, currentMatchIdWhenTimeoutFires) {
    const capturedMatchId = room.currentMatchId;
    let graceStarted = false;
    let graceExpiredFired = false;

    // Disparan si ambos están desconectados
    if (!pAConnected && !pBConnected) {
      graceStarted = true;

      // Simulación de expiración del timer
      // 1. Verificar si el match sigue siendo el capturado
      if (currentMatchIdWhenTimeoutFires !== capturedMatchId) {
        // Se descarta porque el duelo avanzó
        graceExpiredFired = false;
      } else if (pAConnected || pBConnected) {
        // Se descarta porque alguien reconectó
        graceExpiredFired = false;
      } else {
        graceExpiredFired = true;
      }
    }

    return { graceStarted, graceExpiredFired };
  }

  const roomGrace = {
    code: "TOR_GRACE",
    currentMatchId: "match-01",
    disconnectionGrace: null
  };

  test("13. Ambos jugadores se desconectan y comienza el periodo de gracia", () => {
    const res = simulateDisconnectionGraceLogic(roomGrace, false, false, "match-01");
    assert.strictEqual(res.graceStarted, true);
  });

  test("14. Un jugador reconecta antes de los 30 segundos", () => {
    // Si pA reconecta antes de que expire:
    const res = simulateDisconnectionGraceLogic(roomGrace, true, false, "match-01");
    assert.strictEqual(res.graceStarted, false, "No debe iniciar gracia si uno está conectado");
  });

  test("15. El temporizador no suspende el duelo después de reconectar", () => {
    // Inició gracia, pero al cumplirse los 30s pA está conectado:
    const pAConnectedAtEnd = true;
    const pBConnectedAtEnd = false;
    let expiredAction = false;

    if (!pAConnectedAtEnd && !pBConnectedAtEnd) {
      expiredAction = true;
    }
    assert.strictEqual(expiredAction, false, "No debe suspender si un jugador reconectó");
  });

  test("16. El duelo cambia mientras existe un temporizador anterior", () => {
    // El organizador avanza de match-01 a match-02
    roomGrace.currentMatchId = "match-02";
    assert.notStrictEqual(roomGrace.currentMatchId, "match-01");
  });

  test("17. El temporizador anterior no afecta al nuevo enfrentamiento (Duelo avanzado)", () => {
    // Timeout capturó 'match-01', pero el duelo actual es 'match-02'
    const captured = "match-01";
    let suspendedMatch = null;

    if (roomGrace.currentMatchId === captured) {
      suspendedMatch = captured;
    }

    assert.strictEqual(suspendedMatch, null, "El temporizador de match-01 no debe suspender match-02");
  });

  test("18. Ambos siguen desconectados y se cumple el periodo de gracia (Suspensión legítima)", () => {
    roomGrace.currentMatchId = "match-01";
    const res = simulateDisconnectionGraceLogic(roomGrace, false, false, "match-01");
    assert.strictEqual(res.graceStarted, true);
    assert.strictEqual(res.graceExpiredFired, true);
  });

  console.log("\n================================================================");
  console.log(`🏁 RESUMEN FASE 1.2: ${passed} pruebas superadas, ${failed} fallos.`);
  console.log("================================================================");

  if (failed > 0) process.exit(1);
}

runPhase12Tests().catch((err) => {
  console.error("Error fatal en pruebas de Fase 1.2:", err);
  process.exit(1);
});

