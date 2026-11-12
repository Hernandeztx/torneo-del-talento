"use strict";

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

const env = require("../src/config/env");
const { generateSecureToken, hashToken, verifyToken, verifyAdminSecret } = require("../src/security/tokens");
const { sanitizeName } = require("../src/security/sanitizer");
const { STATIC_BANK, TOTAL_STATIC_QUESTIONS } = require("../src/questions/staticBank");
const { GENS, generateMathQuestion } = require("../src/questions/mathGenerators");
const {
  prepareQuestionForMatch,
  sanitizeQuestionForClient,
  verifyAnswer,
  pickQuestion
} = require("../src/questions/questionService");
const { calculateScore } = require("../src/engine/scoring");
const { buildBracket, BYE_ID, getRoundName, getLevelForMatch } = require("../src/engine/bracket");
const app = require("../src/app");

async function runTests() {
  console.log("==================================================");
  console.log("🧪 INICIANDO BATERÍA DE PRUEBAS DE LA FASE 1");
  console.log("==================================================");

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

  // 1. SEGURIDAD Y TOKENS
  console.log("\n📦 1. Módulo de Seguridad y Tokens Criptográficos:");
  test("Genera tokens de 64 caracteres hex y hashes SHA-256 no invertibles", () => {
    const raw = generateSecureToken();
    assert.strictEqual(raw.length, 64);
    const hash = hashToken(raw);
    assert.strictEqual(hash.length, 64);
    assert.notStrictEqual(raw, hash);
    assert.strictEqual(verifyToken(raw, hash), true);
    assert.strictEqual(verifyToken("otro_token_invalido", hash), false);
  });

  test("Validación de Admin Secret con mitigación de timing attacks", () => {
    assert.strictEqual(verifyAdminSecret(env.ADMIN_SECRET), true);
    assert.strictEqual(verifyAdminSecret("clave_falsa"), false);
  });

  test("Sanitización de nombres contra inyecciones XSS", () => {
    const clean = sanitizeName("  <script>alert('hack')</script>Juan  Pérez  ");
    assert.strictEqual(clean, "scriptalerthackscriptJuan Pérez");
  });

  // 2. BANCO DE PREGUNTAS
  console.log("\n📚 2. Banco de Preguntas Original y Generadores:");
  test("Carga exactamente todas las 72 preguntas estáticas originales", () => {
    assert.strictEqual(TOTAL_STATIC_QUESTIONS, 72);
    STATIC_BANK.forEach((q) => {
      assert.ok(q.id.startsWith("q"), "ID determinista hid ausente");
      assert.ok(["mc", "vf", "ord"].includes(q.type), "Tipo inválido");
      assert.ok([1, 2, 3].includes(q.level), "Nivel fuera de rango");
      assert.ok(q.category && q.category.length > 0, "Categoría vacía");
      assert.ok(q.question && q.question.length > 5, "Enunciado vacío");
      assert.ok(q.explanation && q.explanation.length > 0, "Explicación vacía");
    });
  });

  test("Los 5 generadores matemáticos procedimentales producen cálculos válidos", () => {
    const keys = ["rotacion", "carga", "brecha", "productivas", "operarios"];
    assert.strictEqual(Object.keys(GENS).length, 5);
    keys.forEach((k) => {
      const q = GENS[k].make();
      assert.strictEqual(q.type, "num");
      assert.ok(typeof q.ans === "number", `Respuesta no es número en ${k}`);
      assert.ok(q.unit, `Unidad ausente en ${k}`);
      assert.ok(q.explanation, `Explicación ausente en ${k}`);
    });
  });

  // 3. PREPARACIÓN, SANITIZACIÓN Y VALIDACIÓN DE RESPUESTAS
  console.log("\n🛡️ 3. Servicio de Preguntas y Protección de Respuestas:");
  test("La sanitización para clientes ELIMINA la respuesta correcta y la explicación", () => {
    const raw = STATIC_BANK[0];
    const prepared = prepareQuestionForMatch(raw);
    const clientPayload = sanitizeQuestionForClient(prepared);

    assert.strictEqual(clientPayload.correctAnswer, undefined);
    assert.strictEqual(clientPayload.explanation, undefined);
    assert.strictEqual(clientPayload.id, raw.id);
    assert.ok(Array.isArray(clientPayload.options));
  });

  test("Validación de respuesta para Opción Múltiple (mc)", () => {
    const q = STATIC_BANK.find((x) => x.type === "mc");
    assert.strictEqual(verifyAnswer(q, q.correctAnswer), true);
    assert.strictEqual(verifyAnswer(q, "Opción incorrecta inventada"), false);
  });

  test("Validación de respuesta para Verdadero o Falso (vf)", () => {
    const q = STATIC_BANK.find((x) => x.type === "vf");
    assert.strictEqual(verifyAnswer(q, q.correctAnswer), true);
    assert.strictEqual(verifyAnswer(q, !q.correctAnswer), false);
  });

  test("Validación de respuesta para Ordenamiento (ord)", () => {
    const q = STATIC_BANK.find((x) => x.type === "ord");
    assert.strictEqual(verifyAnswer(q, q.correctAnswer), true);
    assert.strictEqual(verifyAnswer(q, q.correctAnswer.slice().reverse()), false);
  });

  test("Validación de respuesta para Cálculo Numérico (num) con tolerancia y comas decimales", () => {
    const q = { type: "num", correctAnswer: 12.5, tolerance: 0.1 };
    assert.strictEqual(verifyAnswer(q, "12,5"), true);
    assert.strictEqual(verifyAnswer(q, "12.5"), true);
    assert.strictEqual(verifyAnswer(q, "12.55"), true); // dentro de 0.1
    assert.strictEqual(verifyAnswer(q, "12.8"), false);  // fuera de 0.1
  });

  // 4. CRONÓMETRO Y FÓRMULA DE PUNTUACIÓN AUTORITATIVA
  console.log("\n⏱️ 4. Cronómetro Autoritativo y Puntuación:");
  test("Respuesta correcta inmediata (0s) otorga 1000 puntos", () => {
    const score = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: 10000,
      questionStartTimeServerTimestamp: 10000,
      limitDurationMs: 20000
    });
    assert.strictEqual(score.points, 1000);
    assert.strictEqual(score.isLate, false);
  });

  test("Respuesta correcta al 50% del tiempo otorga 750 puntos", () => {
    const score = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: 20000,
      questionStartTimeServerTimestamp: 10000, // 10s transcurridos de 20s
      limitDurationMs: 20000
    });
    // 1000 * (1 - (10/20)/2) = 1000 * (1 - 0.25) = 750
    assert.strictEqual(score.points, 750);
  });

  test("Respuesta correcta al límite del tiempo otorga 500 puntos", () => {
    const score = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: 30000,
      questionStartTimeServerTimestamp: 10000, // 20s transcurridos
      limitDurationMs: 20000
    });
    // 1000 * (1 - 1/2) = 500
    assert.strictEqual(score.points, 500);
  });

  test("Respuesta incorrecta siempre otorga 0 puntos", () => {
    const score = calculateScore({
      isCorrect: false,
      receivedAtServerTimestamp: 12000,
      questionStartTimeServerTimestamp: 10000,
      limitDurationMs: 20000
    });
    assert.strictEqual(score.points, 0);
  });

  test("Respuesta tardía fuera del periodo de gracia es rechazada con 0 puntos", () => {
    const score = calculateScore({
      isCorrect: true,
      receivedAtServerTimestamp: 31000, // 21s transcurridos (límite 20s + gracia 800ms)
      questionStartTimeServerTimestamp: 10000,
      limitDurationMs: 20000,
      gracePeriodMs: 800
    });
    assert.strictEqual(score.points, 0);
    assert.strictEqual(score.isLate, true);
  });

  // 5. MOTOR DE BRACKET Y MANEJO DE BYE
  console.log("\n🏆 5. Algoritmo del Bracket y Cuadro de Eliminación:");
  test("Torneo con 2 jugadores genera 1 ronda (Final)", () => {
    const players = [{ id: "p1", name: "Ana" }, { id: "p2", name: "Beto" }];
    const b = buildBracket(players, false);
    assert.strictEqual(b.totalRounds, 1);
    assert.strictEqual(b.rounds.length, 1);
    assert.strictEqual(b.rounds[0].length, 1);
    assert.strictEqual(getRoundName(0, b.totalRounds), "Final");
  });

  test("Torneo con 4 jugadores genera 2 rondas y partido por el Tercer Puesto", () => {
    const players = [
      { id: "p1", name: "A" }, { id: "p2", name: "B" },
      { id: "p3", name: "C" }, { id: "p4", name: "D" }
    ];
    const b = buildBracket(players, true);
    assert.strictEqual(b.totalRounds, 2);
    assert.ok(b.thirdMatch !== null);
    assert.strictEqual(getRoundName(0, 2), "Semifinal");
    assert.strictEqual(getRoundName(1, 2), "Final");
  });

  test("Torneo con número impar (3 jugadores) genera 1 BYE automático y avanza al jugador a la final", () => {
    const players = [{ id: "p1", name: "A" }, { id: "p2", name: "B" }, { id: "p3", name: "C" }];
    const b = buildBracket(players, true);
    assert.strictEqual(b.totalRounds, 2);
    // Debe haber un match completado automáticamente por BYE
    const r0 = b.rounds[0];
    const byeMatch = r0.find((m) => m.isBye);
    assert.ok(byeMatch, "No se encontró el match con BYE");
    assert.strictEqual(byeMatch.status, "completed");
    // El finalista que tuvo BYE debe estar ya en la final
    const finalMatch = b.rounds[1][0];
    assert.ok(finalMatch.playerA !== null || finalMatch.playerB !== null);
  });

  test("Torneos con 8 y 16 jugadores calculan rondas exactas", () => {
    const p8 = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const b8 = buildBracket(p8);
    assert.strictEqual(b8.totalRounds, 3);

    const p16 = Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const b16 = buildBracket(p16);
    assert.strictEqual(b16.totalRounds, 4);
    assert.strictEqual(getRoundName(0, 4), "Octavos de final");
  });

  // 6. SERVIDOR HTTP Y RUTAS UNIFICADAS
  console.log("\n🌐 6. Servidor HTTP, API Healthcheck y Vistas:");
  const testServer = http.createServer(app);

  await new Promise((resolve) => {
    testServer.listen(0, resolve);
  });

  const port = testServer.address().port;

  function httpGet(path) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, data, headers: res.headers }));
      }).on("error", reject);
    });
  }

  function httpPost(path, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        `http://localhost:${port}${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ statusCode: res.statusCode, data }));
        }
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  await asyncTest("GET /api/health responde con estado del servicio y preguntas cargadas", async () => {
    const res = await httpGet("/api/health");
    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.data);
    assert.strictEqual(json.status, "ok");
    assert.strictEqual(json.questions.staticLoaded, 72);
    assert.strictEqual(json.questions.mathGeneratorsCount, 5);
  });

  await asyncTest("POST /api/tournament/create genera torneo, código y URL unificada de QR", async () => {
    const res = await httpPost("/api/tournament/create", {
      name: "Torneo de Demostración Industrial",
      settings: { questionsPerDuel: 3, timePerQuestion: 25 }
    });
    assert.strictEqual(res.statusCode, 201);
    const json = JSON.parse(res.data);
    assert.strictEqual(json.success, true);
    assert.ok(json.data.code);
    assert.ok(json.data.joinUrl.includes(`/jugar?code=${json.data.code}`));
    assert.ok(json.data.qrCode.startsWith("data:image/png;base64,"));
  });

  await asyncTest("GET /original sirve el archivo original intacto Torneo_Talento.html", async () => {
    const res = await httpGet("/original");
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.data.includes("Torneo del Talento"));
    assert.ok(res.data.includes("Planeación estratégica del talento humano"));
  });

  testServer.close();

  console.log("\n==================================================");
  console.log(`🏁 RESUMEN: ${passed} pruebas superadas, ${failed} fallos.`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Error fatal en pruebas:", err);
  process.exit(1);
});

