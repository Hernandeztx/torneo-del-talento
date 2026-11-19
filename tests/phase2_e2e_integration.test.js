"use strict";

/**
 * ==========================================================================
 * TORNEO DEL TALENTO — SUITE DE INTEGRACIÓN Y END-TO-END (FASE 2.6 / 2.7)
 * ==========================================================================
 * Valida el flujo completo de vida de un torneo:
 * Creación -> Registro -> Sorteo -> Duelos 1v1 -> Cierre -> Desempates -> Podio
 * ==========================================================================
 */

const assert = require("assert");
const {
  createTournament,
  registerParticipant,
  startTournament,
  getRoom,
  activeRooms
} = require("../src/engine/tournamentState");

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

const { GENS, generateMathQuestion } = require("../src/questions/mathGenerators");
const { STATIC_BANK } = require("../src/questions/staticBank");
const { verifyAnswer } = require("../src/questions/questionService");

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

async function runE2ETests() {
  console.log("==================================================");
  console.log("🧪 SUITE INTEGRACIÓN Y END-TO-END (FASE 2.6 + 2.7)");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // ESCENARIO COMPLETO DE TORNEO (4 PARTICIPANTES: SEMIS + FINAL + TERCERO)
  // -------------------------------------------------------------
  await test("1. Ciclo completo de torneo (4 jugadores, semifinales, 3er puesto, final y podio)", async () => {
    const code = "E2E4P";
    activeRooms.delete(code);
    const io = createMockIo();

    // 1. Crear torneo
    await createTournament({
      code,
      name: "Copa Talento E2E",
      settings: { questionsPerDuel: 1, timePerQuestion: 15, enableThirdPlace: true },
      adminSecret: "admin123"
    });
    const room = getRoom(code);

    // 2. Registro de 4 jugadores
    const p1 = await registerParticipant({ code, name: "Alice", socketId: "s1" });
    const p2 = await registerParticipant({ code, name: "Bob", socketId: "s2" });
    const p3 = await registerParticipant({ code, name: "Charlie", socketId: "s3" });
    const p4 = await registerParticipant({ code, name: "Diana", socketId: "s4" });

    assert.strictEqual(room.participants.size, 4);

    // 3. Inicio del torneo y bracket
    await startTournament({ code, adminSecretOrToken: "admin123" });
    assert.strictEqual(room.status, "active");
    assert.strictEqual(room.rounds.length, 2); // Ronda 0: Semifinales (2 duelos), Ronda 1: Final (1 duelo)
    assert.ok(room.thirdMatch, "Debe existir duelo por tercer puesto");

    // Ejecutar todos los matches hasta culminar
    let currentStep = selectNextMatch(room);
    let duelsExecuted = 0;

    while (!currentStep.tournamentFinished && currentStep.nextMatch) {
      const match = currentStep.nextMatch;
      duelsExecuted++;

      // Iniciar match
      await startMatch(room, match.id, io);

      // Lanzar pregunta
      await launchQuestion(room, io);
      if (room.activeQuestion?.autoCloseTimer) clearTimeout(room.activeQuestion.autoCloseTimer);

      // Simular respuesta: playerA responde correctamente con 900 pts
      room.activeQuestion.receivedAnswers.set(match.playerA.id, {
        participantId: match.playerA.id,
        points: 900,
        isCorrect: true,
        elapsedMs: 2500,
        givenAnswer: "ok"
      });

      // Cerrar y revelar
      closeQuestion(room);
      await revealAnswer(room, io);

      // Finalizar match
      await finishMatch(room, io);
      assert.strictEqual(match.status, "completed");

      // Consultar siguiente
      currentStep = selectNextMatch(room);
    }

    assert.ok(duelsExecuted >= 3, `Se debieron ejecutar al menos 3 o 4 duelos (ejecutados: ${duelsExecuted})`);
    assert.ok(currentStep.tournamentFinished, "El torneo debe marcarse como terminado");

    // Proclamar podio
    const finalResult = await finishTournament(room, io);
    assert.strictEqual(room.status, "finished");
    // Con 4 jugadores hay partido por el 3er puesto → podio tiene 4 competidores (ranks 1-4)
    assert.ok(finalResult.podium.length >= 3, `El podio debe tener al menos 3 competidores (tiene ${finalResult.podium.length})`);
    assert.strictEqual(finalResult.podium[0].rank, 1);
    assert.strictEqual(finalResult.podium[1].rank, 2);
    assert.strictEqual(finalResult.podium[2].rank, 3);
    if (finalResult.podium[3]) {
      assert.strictEqual(finalResult.podium[3].rank, 4);
    }
  });

  // -------------------------------------------------------------
  // DESEMPATES RIGUROSOS Y CONSISTENCIA
  // -------------------------------------------------------------
  await test("2. Desempate riguroso: evalúa velocidad acumulada real de respuestas correctas", async () => {
    const code = "TIEBRK";
    activeRooms.delete(code);
    const io = createMockIo();

    await createTournament({
      code,
      name: "Torneo Desempate",
      settings: { questionsPerDuel: 2, timePerQuestion: 20 },
      adminSecret: "admin123"
    });
    const room = getRoom(code);
    await registerParticipant({ code, name: "FastPlayer", socketId: "sf" });
    await registerParticipant({ code, name: "SlowPlayer", socketId: "ss" });
    await startTournament({ code, adminSecretOrToken: "admin123" });

    const match = room.rounds[0][0];
    await startMatch(room, match.id, io);

    const fastId = match.playerA.name === "FastPlayer" ? match.playerA.id : match.playerB.id;
    const slowId = match.playerA.name === "SlowPlayer" ? match.playerA.id : match.playerB.id;

    // Pregunta 1
    await launchQuestion(room, io);
    if (room.activeQuestion?.autoCloseTimer) clearTimeout(room.activeQuestion.autoCloseTimer);
    // FastPlayer: acierta en 2000ms (+700pts). SlowPlayer: falla (0pts)
    room.activeQuestion.receivedAnswers.set(fastId, {
      participantId: fastId, points: 700, isCorrect: true, elapsedMs: 2000, givenAnswer: "a"
    });
    closeQuestion(room);
    await revealAnswer(room, io);

    // Pregunta 2
    await launchQuestion(room, io);
    if (room.activeQuestion?.autoCloseTimer) clearTimeout(room.activeQuestion.autoCloseTimer);
    // SlowPlayer: acierta en 9000ms (+700pts). FastPlayer: falla (0pts)
    room.activeQuestion.receivedAnswers.set(slowId, {
      participantId: slowId, points: 700, isCorrect: true, elapsedMs: 9000, givenAnswer: "b"
    });
    closeQuestion(room);
    await revealAnswer(room, io);

    assert.strictEqual(match.scoreA, 700);
    assert.strictEqual(match.scoreB, 700);

    // Finalizar duelo: empate a 700 puntos
    const finishRes = await finishMatch(room, io);
    assert.strictEqual(finishRes.isTiebreak, true, "Debe ser catalogado como desempate");
    assert.strictEqual(finishRes.winner.id, fastId, "FastPlayer gana por menor tiempo (2000ms vs 9000ms)");
  });

  // -------------------------------------------------------------
  // AUDITORÍA DE BANCO DE PREGUNTAS Y GENERADORES MATEMÁTICOS
  // -------------------------------------------------------------
  await test("3. Integridad masiva del Banco Estático (72 preguntas válidas sin campos vacíos)", () => {
    assert.strictEqual(STATIC_BANK.length, 72, "Deben existir exactamente 72 preguntas");
    for (const q of STATIC_BANK) {
      assert.ok(q.id, "Cada pregunta debe tener un id");
      assert.ok(q.type, `Pregunta ${q.id} debe tener un type`);
      assert.ok(q.question, `Pregunta ${q.id} debe tener texto`);
      assert.ok(q.correctAnswer !== undefined, `Pregunta ${q.id} debe tener correctAnswer`);
      if (q.type === "mc") {
        assert.ok(Array.isArray(q.options) && q.options.length >= 2, `Pregunta mc ${q.id} debe tener opciones`);
      }
    }
  });

  await test("4. Generación masiva de preguntas matemáticas (100 ejecuciones sin NaN ni errores)", () => {
    const usedKeys = new Set();
    for (let i = 0; i < 100; i++) {
      const level = (i % 3) + 1;
      const mathQ = generateMathQuestion(level, usedKeys);
      assert.ok(mathQ, `El generador debe producir una pregunta en intento ${i}`);
      assert.ok(!isNaN(parseFloat(mathQ.correctAnswer)), `correctAnswer debe ser numérico válido: ${mathQ.correctAnswer}`);
      assert.ok(verifyAnswer(mathQ, mathQ.correctAnswer), "verifyAnswer debe validar la respuesta correcta generada");
    }
  });

  // -------------------------------------------------------------
  // ESCALABILIDAD LOCAL (16 PARTICIPANTES, BRACKET COMPLETO)
  // -------------------------------------------------------------
  await test("5. Simulación de torneo mediano (16 participantes, 4 rondas de eliminación)", async () => {
    const code = "SIM16";
    activeRooms.delete(code);
    await createTournament({
      code,
      name: "Torneo 16 Jugadores",
      settings: { questionsPerDuel: 1, timePerQuestion: 10, enableThirdPlace: true },
      adminSecret: "admin123"
    });
    const room = getRoom(code);
    for (let i = 1; i <= 16; i++) {
      await registerParticipant({ code, name: `Player_${i}`, socketId: `sock_${i}` });
    }
    assert.strictEqual(room.participants.size, 16);

    await startTournament({ code, adminSecretOrToken: "admin123" });
    assert.strictEqual(room.rounds.length, 4, "16 jugadores deben generar 4 rondas completas");
    assert.strictEqual(room.rounds[0].length, 8, "Octavos de final con 8 duelos");
    assert.strictEqual(room.rounds[1].length, 4, "Cuartos con 4 duelos");
    assert.strictEqual(room.rounds[2].length, 2, "Semifinales con 2 duelos");
    assert.strictEqual(room.rounds[3].length, 1, "Gran Final con 1 duelo");
  });

  // -------------------------------------------------------------
  // IDEMPOTENCIA Y PROTECCIÓN CONTRA DOBLE CIERRE/FINALIZACIÓN
  // -------------------------------------------------------------
  await test("6. Idempotencia y protección de estados de terminación", async () => {
    const code = "IDEMP1";
    activeRooms.delete(code);
    const io = createMockIo();

    await createTournament({ code, name: "Torneo Idempotente", adminSecret: "admin123" });
    const room = getRoom(code);
    await registerParticipant({ code, name: "P1" });
    await registerParticipant({ code, name: "P2" });
    await startTournament({ code, adminSecretOrToken: "admin123" });

    const match = room.rounds[0][0];
    await startMatch(room, match.id, io);
    await launchQuestion(room, io);
    if (room.activeQuestion?.autoCloseTimer) clearTimeout(room.activeQuestion.autoCloseTimer);
    closeQuestion(room);
    await revealAnswer(room, io);
    await finishMatch(room, io);

    // Primera finalización
    const res1 = await finishTournament(room, io);
    assert.ok(res1.podium);

    // Segunda finalización (debe responder limpiamente sin crashear)
    const res2 = await finishTournament(room, io);
    assert.strictEqual(room.status, "finished");
    assert.strictEqual(res2.podium.length, res1.podium.length);
  });

  console.log("\n==================================================");
  console.log(`🏁 RESULTADO E2E: ${passed} pasadas / ${failed} fallidas`);
  if (failed > 0) {
    process.exit(1);
  }
}

runE2ETests().catch((err) => {
  console.error("💥 Error en suite E2E:", err);
  process.exit(1);
});
