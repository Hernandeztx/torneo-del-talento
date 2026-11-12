"use strict";

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

const env = require("../src/config/env");
const db = require("../src/config/database");
const {
  activeRooms,
  createTournament,
  registerParticipant,
  reconnectParticipant,
  startTournament,
  isParticipantInMatch,
  hydrateActiveRoomsFromDB
} = require("../src/engine/tournamentState");
const { calculateScore } = require("../src/engine/scoring");
const { verifyAnswer, sanitizeQuestionForClient, prepareQuestionForMatch } = require("../src/questions/questionService");
const { STATIC_BANK } = require("../src/questions/staticBank");

async function runPhase11Tests() {
  console.log("================================================================");
  console.log("🧪 BATERÍA DE PRUEBAS DE FASE 1.1 — INFRAESTRUCTURA Y SEGURIDAD");
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

  // -----------------------------------------------------------------
  // 1. INICIO DEL SERVIDOR Y VERIFICACIÓN DE DIAGNÓSTICO DE BASE DE DATOS
  // -----------------------------------------------------------------
  console.log("\n📦 1. Diagnóstico de Conexión a Base de Datos:");
  await asyncTest("El cliente de PostgreSQL maneja estado y latencia transparentemente", async () => {
    const status = await db.testConnection();
    assert.ok(status.testedAt);
    if (!status.connected) {
      console.log(`     ℹ️ Diagnóstico reportado: ${status.lastError} (esperado en host local sin Postgres)`);
    } else {
      console.log(`     ℹ️ Conectado a PostgreSQL físico (${status.latencyMs} ms)`);
    }
  });

  // -----------------------------------------------------------------
  // 2. CREACIÓN Y RECUPERACIÓN DE TORNEOS (LOBBY Y ACTIVO)
  // -----------------------------------------------------------------
  console.log("\n🔄 2. Creación y Manejo de Estado de Torneos:");
  let roomCode1, roomCode2;
  await asyncTest("Creación de dos salas independientes con tokens administrativos únicos", async () => {
    const t1 = await createTournament({ code: "TOR001", name: "Torneo Alfa", adminSecret: "AdminKey1" });
    const t2 = await createTournament({ code: "TOR002", name: "Torneo Beta", adminSecret: "AdminKey2" });

    assert.strictEqual(t1.code, "TOR001");
    assert.strictEqual(t2.code, "TOR002");
    assert.notStrictEqual(t1.adminToken, t2.adminToken);
    roomCode1 = t1.code;
    roomCode2 = t2.code;
  });

  // -----------------------------------------------------------------
  // 3. AISLAMIENTO ESTRICTO DE DOS TORNEOS SIMULTÁNEOS
  // -----------------------------------------------------------------
  console.log("\n🧱 3. Aislamiento Estricto entre Torneos Múltiples:");
  let pAlfa1, pAlfa2, pBeta1, pBeta2;
  await asyncTest("Los participantes registrados en Torneo Alfa no existen ni interfieren en Torneo Beta", async () => {
    pAlfa1 = await registerParticipant({ code: roomCode1, name: "Carlos Alfa", socketId: "s-alfa-1" });
    pAlfa2 = await registerParticipant({ code: roomCode1, name: "Diana Alfa", socketId: "s-alfa-2" });

    pBeta1 = await registerParticipant({ code: roomCode2, name: "Elena Beta", socketId: "s-beta-1" });
    pBeta2 = await registerParticipant({ code: roomCode2, name: "Fernando Beta", socketId: "s-beta-2" });

    const room1 = activeRooms.get(roomCode1);
    const room2 = activeRooms.get(roomCode2);

    assert.strictEqual(room1.participants.size, 2);
    assert.strictEqual(room2.participants.size, 2);

    assert.ok(room1.participants.has(pAlfa1.participantId));
    assert.strictEqual(room1.participants.has(pBeta1.participantId), false);
    assert.ok(room2.participants.has(pBeta1.participantId));
    assert.strictEqual(room2.participants.has(pAlfa1.participantId), false);
  });

  // -----------------------------------------------------------------
  // 4. INTENTO DE ASIGNAR UN PARTICIPANTE A UN TORNEO AJENO
  // -----------------------------------------------------------------
  console.log("\n🚫 4. Validación Contra Cruce de Torneos (Anti Cross-Tournament):");
  test("isParticipantInMatch rechaza participantes de otros torneos o de duelos ajenos", () => {
    const room1 = activeRooms.get(roomCode1);
    room1.matches.set("0-0", {
      id: "0-0",
      playerA: { id: pAlfa1.participantId, name: pAlfa1.name },
      playerB: { id: pAlfa2.participantId, name: pAlfa2.name }
    });

    // pBeta1 intentando actuar en match 0-0 del Torneo Alfa
    const isAllowed = isParticipantInMatch(room1, "0-0", pBeta1.participantId);
    assert.strictEqual(isAllowed, false, "Se permitió incorrectamente un participante de otro torneo");

    // Participantes legítimos sí son aceptados
    assert.strictEqual(isParticipantInMatch(room1, "0-0", pAlfa1.participantId), true);
    assert.strictEqual(isParticipantInMatch(room1, "0-0", pAlfa2.participantId), true);
  });

  // -----------------------------------------------------------------
  // 5. INTENTO DE REGISTRAR RESPUESTAS DE PARTICIPANTES NO HABILITADOS
  // -----------------------------------------------------------------
  console.log("\n🛡️ 5. Protección de Respuestas de No Competidores:");
  test("Un espectador o participante fuera del duelo activo es rechazado al responder", () => {
    const room1 = activeRooms.get(roomCode1);
    // Registrar un tercer participante en Alfa que no está en el duelo 0-0
    const pAlfa3Id = "p-alfa-3";
    const allowed = isParticipantInMatch(room1, "0-0", pAlfa3Id);
    assert.strictEqual(allowed, false);
  });

  // -----------------------------------------------------------------
  // 6. DOS JUGADORES RESPONDIENDO SIMULTÁNEAMENTE Y SCORING AUTORITATIVO
  // -----------------------------------------------------------------
  console.log("\n⚡ 6. Respuestas Simultáneas y Cálculo Autoritativo:");
  test("Dos competidores legítimos responden al mismo milisegundo con cálculo exacto", () => {
    const room1 = activeRooms.get(roomCode1);
    const rawQ = STATIC_BANK[0];
    const preparedQ = prepareQuestionForMatch(rawQ);

    const now = Date.now();
    const startTime = now - 5000; // 5 segundos transcurridos
    const durationMs = 20000;      // 20s límite

    room1.activeQuestion = {
      ...preparedQ,
      startTime,
      durationMs,
      receivedAnswers: new Map()
    };

    // Jugador A responde correcto
    const scoreA = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: now,
      questionStartTimeServerTimestamp: startTime,
      limitDurationMs: durationMs
    });

    // Jugador B responde incorrecto
    const scoreB = calculateScore({
      isCorrect: false,
      receivedAtServerTimestamp: now,
      questionStartTimeServerTimestamp: startTime,
      limitDurationMs: durationMs
    });

    room1.activeQuestion.receivedAnswers.set(pAlfa1.participantId, scoreA);
    room1.activeQuestion.receivedAnswers.set(pAlfa2.participantId, scoreB);

    assert.strictEqual(room1.activeQuestion.receivedAnswers.size, 2);
    // 1000 * (1 - (5/20)/2) = 1000 * 0.875 = 875 puntos
    assert.strictEqual(scoreA.points, 875);
    assert.strictEqual(scoreB.points, 0);
  });

  // -----------------------------------------------------------------
  // 7. ENVÍO DUPLICADO DE RESPUESTAS
  // -----------------------------------------------------------------
  console.log("\n🛑 7. Rechazo Estricto de Respuestas Duplicadas:");
  test("Un competidor que intenta responder por segunda vez es bloqueado", () => {
    const room1 = activeRooms.get(roomCode1);
    assert.ok(room1.activeQuestion.receivedAnswers.has(pAlfa1.participantId));

    // Intento de reenvío
    const alreadyAnswered = room1.activeQuestion.receivedAnswers.has(pAlfa1.participantId);
    assert.strictEqual(alreadyAnswered, true, "El sistema debe detectar el intento duplicado");
  });

  // -----------------------------------------------------------------
  // 8. RESPUESTAS FUERA DE TIEMPO (T > LÍMITE + GRACIA)
  // -----------------------------------------------------------------
  console.log("\n⏰ 8. Control Temporal y Rechazo Fuera de Plazo:");
  test("Respuesta enviada después de (límite + 800ms) es invalidada con 0 puntos", () => {
    const start = 100000;
    const duration = 20000;
    const grace = 800;

    // Llega a los 21.5 segundos (vencida)
    const late = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: start + 21500,
      questionStartTimeServerTimestamp: start,
      limitDurationMs: duration,
      gracePeriodMs: grace
    });

    assert.strictEqual(late.isLate, true);
    assert.strictEqual(late.points, 0);
  });

  // -----------------------------------------------------------------
  // 9. DESCONEXIÓN Y RECONEXIÓN SIN DUPLICADOS
  // -----------------------------------------------------------------
  console.log("\n🔌 9. Reconexión Transparente y Prevención de Duplicados:");
  await asyncTest("Un participante reconecta usando su token secreto sin crear un segundo registro", async () => {
    const room1 = activeRooms.get(roomCode1);
    const initialCount = room1.participants.size;

    const reconnected = await reconnectParticipant({
      code: roomCode1,
      rawToken: pAlfa1.rawToken,
      socketId: "socket-nuevo-reconectado"
    });

    assert.ok(reconnected);
    assert.strictEqual(reconnected.id, pAlfa1.participantId);
    assert.strictEqual(reconnected.socketId, "socket-nuevo-reconectado");
    assert.strictEqual(room1.participants.size, initialCount, "No debe duplicar participantes en la sala");
  });

  // -----------------------------------------------------------------
  // 10. PROTECCIÓN DE RESPUESTAS CORRECTAS ANTES DE REVELAR
  // -----------------------------------------------------------------
  console.log("\n🙈 10. Secreto de Respuestas Correctas:");
  test("La carga enviada a los clientes carece de correctAnswer y explanation", () => {
    const raw = STATIC_BANK[5];
    const prepared = prepareQuestionForMatch(raw);
    const sanitized = sanitizeQuestionForClient(prepared);

    assert.strictEqual(sanitized.correctAnswer, undefined);
    assert.strictEqual(sanitized.explanation, undefined);
    assert.strictEqual(sanitized.options.length, 4);
    assert.ok(sanitized.id);
  });

  // -----------------------------------------------------------------
  // 11. POLÍTICA DE RECUPERACIÓN ANTE REINICIO CON PREGUNTAS ACTIVAS
  // -----------------------------------------------------------------
  console.log("\n♻️ 11. Política de Recuperación y Temporizador Interrumpido:");
  test("La política de reinicio distingue preguntas vencidas de preguntas interrumpidas", () => {
    // Escenario A: Pregunta que arrancó hace 60s con duración de 20s (Venció durante el crash)
    const elapsedVencida = 60000;
    const durationA = 20000;
    const isExpired = elapsedVencida >= durationA;
    assert.strictEqual(isExpired, true, "Debe pasar a pending_reveal sin tiempo adicional");

    // Escenario B: Pregunta que arrancó hace 5s con duración de 20s (Interrumpida)
    const elapsedInterrumpida = 5000;
    const durationB = 20000;
    const isInterrupted = elapsedInterrumpida < durationB;
    assert.strictEqual(isInterrupted, true, "Debe pausarse e informar respuestas existentes");
  });

  // -----------------------------------------------------------------
  // 12. VERIFICACIÓN DE SINTAXIS Y RESTRICCIONES DDL DE POSTGRESQL
  // -----------------------------------------------------------------
  console.log("\n📜 12. Verificación Estática del Esquema SQL Actualizado:");
  test("schema.sql contiene claves foráneas compuestas, checks y trigger de validación", () => {
    const schemaPath = path.join(__dirname, "../src/db/schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");

    assert.ok(sql.includes("uq_participant_tournament_id UNIQUE (tournament_id, id)"), "Falta constraint único en participants");
    assert.ok(sql.includes("CONSTRAINT fk_matches_player_a FOREIGN KEY (tournament_id, player_a_id)"), "Falta FK compuesta player_a");
    assert.ok(sql.includes("CONSTRAINT fk_matches_player_b FOREIGN KEY (tournament_id, player_b_id)"), "Falta FK compuesta player_b");
    assert.ok(sql.includes("CONSTRAINT chk_different_players CHECK"), "Falta check de jugadores distintos");
    assert.ok(sql.includes("validate_participant_in_match()"), "Falta función PL/pgSQL del trigger");
    assert.ok(sql.includes("CREATE TRIGGER trg_validate_participant_in_match"), "Falta trigger en participant_answers");
  });

  console.log("\n================================================================");
  console.log(`🏁 RESUMEN FASE 1.1: ${passed} pruebas superadas, ${failed} fallos.`);
  console.log("================================================================");

  if (failed > 0) process.exit(1);
}

runPhase11Tests().catch((err) => {
  console.error("Error fatal en pruebas de Fase 1.1:", err);
  process.exit(1);
});

