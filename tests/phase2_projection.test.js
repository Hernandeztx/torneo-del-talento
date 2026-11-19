"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");

const app = require("../src/app");
const tournamentState = require("../src/engine/tournamentState");

const EXPECTED_HASH = "9653BC7BDEFA1141950DDB0822E2D9768E7EED06915A60E6ADD130B9C6336248";

test("FASE 2.3 — PRUEBAS DE PANTALLA DE PROYECCIÓN (/proyeccion)", async (t) => {
  let server;
  let serverPort;

  await t.test("0. Integridad estricta de Torneo_Talento.html", () => {
    const filePath = path.resolve(process.cwd(), "Torneo_Talento.html");
    assert.ok(fs.existsSync(filePath), "Torneo_Talento.html debe existir");
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex").toUpperCase();
    assert.equal(hash, EXPECTED_HASH, "El hash SHA-256 del archivo original debe ser exactamente el esperado");
  });

  await t.test("1. Existencia y consistencia de archivos de Módulo 2.3", () => {
    const requiredFiles = [
      "src/public/css/projection.css",
      "src/public/js/projection.js",
      "src/views/projection.html"
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      assert.ok(fs.existsSync(fullPath), `El archivo ${relPath} debe existir`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 200, `El archivo ${relPath} no debe estar vacío (${stat.size} bytes)`);
    }
  });

  await t.test("2. Servidor HTTP y entrega de vistas y recursos estáticos de proyección", async () => {
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

    // Vista de proyección base (/proyeccion)
    const projRes = await get("/proyeccion");
    assert.equal(projRes.status, 200);
    assert.ok(projRes.body.includes("TORNEO DEL TALENTO"));
    assert.ok(projRes.body.includes('id="panel-code-select"'), "Debe incluir panel selector de sala");
    assert.ok(projRes.body.includes('id="panel-lobby"'), "Debe incluir panel lobby");
    assert.ok(projRes.body.includes('id="panel-prep"'), "Debe incluir panel preparación");
    assert.ok(projRes.body.includes('id="panel-duel"'), "Debe incluir panel duelo 1v1");
    assert.ok(projRes.body.includes('id="panel-question"'), "Debe incluir panel pregunta en vivo");
    assert.ok(projRes.body.includes('id="panel-bracket"'), "Debe incluir panel cuadro de eliminación");
    assert.ok(projRes.body.includes('id="panel-podium"'), "Debe incluir panel podio");
    assert.ok(projRes.body.includes('id="btn-proj-fullscreen"'), "Debe incluir botón de pantalla completa");
    assert.ok(projRes.body.includes('id="btn-proj-sound"'), "Debe incluir botón de sonido");

    // Rutas con parámetro (/proyeccion/ABCDE y /presentacion/ABCDE)
    const paramRes1 = await get("/proyeccion/TEST99");
    assert.equal(paramRes1.status, 200);
    assert.ok(paramRes1.body.includes('id="panel-lobby"'));

    const paramRes2 = await get("/presentacion/TEST99");
    assert.equal(paramRes2.status, 200);
    assert.ok(paramRes2.body.includes('id="panel-lobby"'));

    // Recursos CSS y JS
    const cssRes = await get("/public/css/projection.css");
    assert.equal(cssRes.status, 200);
    assert.ok(cssRes.body.includes(".projection-body"));
    assert.ok(cssRes.body.includes(".qr-join-card"));
    assert.ok(cssRes.body.includes(".podium-pedestal"));

    const jsRes = await get("/public/js/projection.js");
    assert.equal(jsRes.status, 200);
    assert.ok(jsRes.body.includes("join_projection"));
    assert.ok(jsRes.body.includes("projection_state"));

    // Endpoint de código QR dinámico
    const qrRes = await get("/api/tournament/PROJQR/qr");
    assert.equal(qrRes.status, 200);
    const qrJson = JSON.parse(qrRes.body);
    assert.equal(qrJson.code, "PROJQR");
    assert.ok(qrJson.joinUrl.includes("/jugar?code=PROJQR"));
    assert.ok(qrJson.qrDataUrl.startsWith("data:image/png;base64,"));

    // Comprobar que rutas anteriores se mantienen intactas
    const partRes = await get("/jugar");
    assert.equal(partRes.status, 200);
    assert.ok(partRes.body.includes('id="screen-join"'));

    const origRes = await get("/original");
    assert.equal(origRes.status, 200);
    assert.ok(origRes.body.includes("Torneo del Talento"));
  });

  await t.test("3. Integración con el estado del torneo y estructura de proyección", async () => {
    const code = "PROJTEST";
    const created = await tournamentState.createTournament({
      code,
      name: "Torneo Gran Auditorio"
    });
    assert.equal(created.code, code);

    // Registro de 2 participantes para poblar el estado
    await tournamentState.registerParticipant({ code, name: "Dra. Sofía Mora", socketId: "s-sofia" });
    await tournamentState.registerParticipant({ code, name: "Ing. Marco Soto", socketId: "s-marco" });

    const room = tournamentState.getRoom(code);
    assert.ok(room);
    assert.equal(room.participants.size, 2);

    // Simular el payload exacto emitido por join_projection
    const pList = Array.from(room.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      isConnected: p.isConnected
    }));

    const projectionPayload = {
      code: room.code,
      name: room.name,
      status: room.status,
      participants: pList,
      rounds: room.rounds,
      thirdMatch: room.thirdMatch,
      currentMatchId: room.currentMatchId
    };

    assert.equal(projectionPayload.code, "PROJTEST");
    assert.equal(projectionPayload.name, "Torneo Gran Auditorio");
    assert.equal(projectionPayload.status, "lobby");
    assert.equal(projectionPayload.participants.length, 2);
    assert.equal(projectionPayload.participants[0].name, "Dra. Sofía Mora");
    assert.equal(projectionPayload.participants[1].name, "Ing. Marco Soto");
  });

  t.after(() => {
    if (server) {
      server.close();
    }
  });
});
