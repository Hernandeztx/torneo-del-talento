"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");

const app = require("../src/app");
const env = require("../src/config/env");
const tournamentState = require("../src/engine/tournamentState");
const { verifyAdminSecret } = require("../src/security/tokens");

const EXPECTED_HASH = "9653BC7BDEFA1141950DDB0822E2D9768E7EED06915A60E6ADD130B9C6336248";

test("FASE 2.4 — PRUEBAS DEL PANEL DEL ORGANIZADOR (/organizador)", async (t) => {
  let server;
  let serverPort;

  await t.test("0. Integridad estricta de Torneo_Talento.html", () => {
    const filePath = path.resolve(process.cwd(), "Torneo_Talento.html");
    assert.ok(fs.existsSync(filePath), "Torneo_Talento.html debe existir");
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex").toUpperCase();
    assert.equal(hash, EXPECTED_HASH, "El hash SHA-256 del archivo original debe ser exactamente el esperado");
  });

  await t.test("1. Existencia y consistencia de archivos de Módulo 2.4", () => {
    const requiredFiles = [
      "src/public/css/organizer.css",
      "src/public/js/organizer.js",
      "src/views/organizer.html"
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      assert.ok(fs.existsSync(fullPath), `El archivo ${relPath} debe existir`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 200, `El archivo ${relPath} no debe estar vacío (${stat.size} bytes)`);
    }
  });

  await t.test("2. Servidor HTTP y entrega de vistas y recursos estáticos del organizador", async () => {
    server = http.createServer(app);

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    const get = (urlPath) =>
      new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${serverPort}${urlPath}`, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
          res.on("error", reject);
        });
      });

    // Vista de organizador base (/organizador)
    const orgRes = await get("/organizador");
    assert.equal(orgRes.status, 200);
    assert.ok(orgRes.body.includes("TORNEO DEL TALENTO"));
    assert.ok(orgRes.body.includes('id="tab-summary"'), "Debe incluir pestaña resumen");
    assert.ok(orgRes.body.includes('id="tab-create"'), "Debe incluir pestaña crear torneo");
    assert.ok(orgRes.body.includes('id="tab-lobby"'), "Debe incluir pestaña sala de espera");
    assert.ok(orgRes.body.includes('id="tab-matches"'), "Debe incluir pestaña de duelos");
    assert.ok(orgRes.body.includes('id="tab-connection"'), "Debe incluir pestaña de diagnóstico");
    assert.ok(orgRes.body.includes('id="modal-confirm-start"'), "Debe incluir modal de confirmación");

    // Alias /admin
    const adminRes = await get("/admin");
    assert.equal(adminRes.status, 200);
    assert.ok(adminRes.body.includes('id="tab-summary"'));

    // Recursos CSS y JS
    const cssRes = await get("/public/css/organizer.css");
    assert.equal(cssRes.status, 200);
    assert.ok(cssRes.body.includes(".organizer-shell"));
    assert.ok(cssRes.body.includes(".metric-card"));

    const jsRes = await get("/public/js/organizer.js");
    assert.equal(jsRes.status, 200);
    assert.ok(jsRes.body.includes("auth_organizer"));
    assert.ok(jsRes.body.includes("organizer_start_tournament"));

    // Comprobar que rutas anteriores se mantienen intactas
    const partRes = await get("/jugar");
    assert.equal(partRes.status, 200);
    assert.ok(partRes.body.includes('id="screen-join"'));

    const projRes = await get("/proyeccion");
    assert.equal(projRes.status, 200);
    assert.ok(projRes.body.includes('id="panel-lobby"'));

    const origRes = await get("/original");
    assert.equal(origRes.status, 200);
    assert.ok(origRes.body.includes("Torneo del Talento"));
  });

  await t.test("3. Validación de formularios y creación de torneo vía POST /api/tournament/create", async () => {
    const post = (urlPath, body) =>
      new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request(
          `http://127.0.0.1:${serverPort}${urlPath}`,
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
            res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
          }
        );
        req.on("error", reject);
        req.write(payload);
        req.end();
      });

    // Intento con nombre corto (< 3 caracteres)
    const errRes = await post("/api/tournament/create", { name: "ab" });
    assert.equal(errRes.status, 400);
    assert.ok(errRes.body.error.includes("al menos 3 caracteres"));

    // Creación válida
    const validRes = await post("/api/tournament/create", {
      name: "Torneo de Evaluación Industrial",
      settings: {
        questionsPerDuel: 3,
        timePerQuestion: 25,
        maxParticipants: 16
      }
    });

    assert.equal(validRes.status, 201);
    assert.equal(validRes.body.success, true);
    assert.ok(validRes.body.data.code, "Debe generar código de torneo");
    assert.ok(validRes.body.data.joinUrl.includes("/jugar?code="));
    assert.ok(validRes.body.data.qrCode.startsWith("data:image/png;base64,"));
  });

  await t.test("4. Autenticación de organizador y protección de inicio de torneo", async () => {
    // 1. Verificación de clave con verifyAdminSecret
    assert.equal(verifyAdminSecret("CLAVE_INCORRECTA"), false);
    assert.equal(verifyAdminSecret(env.ADMIN_SECRET), true);

    // 2. Crear un torneo para probar la lógica de inicio
    const code = "ORGTEST";
    await tournamentState.createTournament({ code, name: "Torneo Org Test" });

    // 3. Intento de inicio con menos de 2 participantes debe ser rechazado
    await assert.rejects(
      async () => tournamentState.startTournament({ code, adminSecretOrToken: env.ADMIN_SECRET }),
      /Se necesitan al menos 2 participantes para comenzar el torneo/
    );

    // 4. Inscribir 2 participantes
    await tournamentState.registerParticipant({ code, name: "P1", socketId: "s-1" });
    await tournamentState.registerParticipant({ code, name: "P2", socketId: "s-2" });

    // 5. Iniciar torneo con credencial válida
    const started = await tournamentState.startTournament({ code, adminSecretOrToken: env.ADMIN_SECRET });
    assert.ok(started.rounds);
    assert.equal(started.rounds.length, 1, "2 participantes generan 1 ronda (Final)");

    const room = tournamentState.getRoom(code);
    assert.equal(room.status, "active", "El torneo debe pasar a estado activo");
  });

  t.after(() => {
    if (server) {
      server.close();
    }
  });
});
