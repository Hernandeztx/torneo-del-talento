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

test("FASE 2.1 Y 2.2 — PRUEBAS DE INTERFAZ E INFRAESTRUCTURA DEL PARTICIPANTE", async (t) => {
  let server;
  let serverPort;

  await t.test("0. Integridad estricta de Torneo_Talento.html", () => {
    const filePath = path.resolve(process.cwd(), "Torneo_Talento.html");
    assert.ok(fs.existsSync(filePath), "Torneo_Talento.html debe existir");
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex").toUpperCase();
    assert.equal(hash, EXPECTED_HASH, "El hash SHA-256 del archivo original debe ser exactamente el esperado");
  });

  await t.test("1. Existencia y estructura de archivos de Fase 2.1 y 2.2", () => {
    const requiredFiles = [
      "src/public/css/theme.css",
      "src/public/css/participant.css",
      "src/public/js/audio.js",
      "src/public/js/confetti.js",
      "src/public/js/participant.js",
      "src/views/participant.html"
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      assert.ok(fs.existsSync(fullPath), `El archivo ${relPath} debe existir`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 200, `El archivo ${relPath} no debe estar vacío (${stat.size} bytes)`);
    }
  });

  await t.test("2. Arranque de servidor HTTP y verificación de rutas estáticas y vistas", async () => {
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

    // Vista de participante (/jugar)
    const jugarRes = await get("/jugar");
    assert.equal(jugarRes.status, 200);
    assert.ok(jugarRes.body.includes("TORNEO DEL TALENTO"), "Debe contener el título");
    assert.ok(jugarRes.body.includes('id="screen-join"'), "Debe incluir pantalla de ingreso");
    assert.ok(jugarRes.body.includes('id="screen-lobby"'), "Debe incluir pantalla de lobby");
    assert.ok(jugarRes.body.includes('id="screen-spectator"'), "Debe incluir pantalla de espectador");
    assert.ok(jugarRes.body.includes('id="screen-question"'), "Debe incluir pantalla de pregunta");
    assert.ok(jugarRes.body.includes('id="screen-answered"'), "Debe incluir pantalla de respondido");
    assert.ok(jugarRes.body.includes('id="screen-verdict"'), "Debe incluir pantalla de veredicto");
    assert.ok(jugarRes.body.includes('id="connection-badge"'), "Debe incluir badge de conexión");
    assert.ok(jugarRes.body.includes('id="sound-toggle"'), "Debe incluir toggle de sonido");

    // Alias /unirse
    const unirseRes = await get("/unirse");
    assert.equal(unirseRes.status, 200);
    assert.ok(unirseRes.body.includes('id="screen-join"'));

    // Recursos CSS compartidos y del participante
    const themeRes = await get("/public/css/theme.css");
    assert.equal(themeRes.status, 200);
    assert.ok(themeRes.body.includes("--bg: #0a302b"));
    assert.ok(themeRes.body.includes("--gold: #f2a93b"));

    const partCssRes = await get("/public/css/participant.css");
    assert.equal(partCssRes.status, 200);
    assert.ok(partCssRes.body.includes(".participant-shell"));
    assert.ok(partCssRes.body.includes(".options-grid"));

    // Recursos JS compartidos y del participante
    const audioJsRes = await get("/public/js/audio.js");
    assert.equal(audioJsRes.status, 200);
    assert.ok(audioJsRes.body.includes("TalentoAudio"));

    const confettiJsRes = await get("/public/js/confetti.js");
    assert.equal(confettiJsRes.status, 200);
    assert.ok(confettiJsRes.body.includes("TalentoConfetti"));

    const partJsRes = await get("/public/js/participant.js");
    assert.equal(partJsRes.status, 200);
    assert.ok(partJsRes.body.includes("talento_token"));

    // Ruta original preservada
    const origRes = await get("/original");
    assert.equal(origRes.status, 200);
    assert.ok(origRes.body.includes("Torneo del Talento"));
  });

  await t.test("3. Verificación de lógica de participante (registro, token y reconexión)", async () => {
    const code = "TESTP2";
    const created = await tournamentState.createTournament({ code, name: "Torneo Test Participante" });
    assert.equal(created.code, code);

    // Intento con sala inválida
    await assert.rejects(
      async () => tournamentState.registerParticipant({ code: "NOEXISTE", name: "Carlos" }),
      /El torneo no existe o el código es incorrecto/
    );

    // Registro válido de participante
    const p1 = await tournamentState.registerParticipant({
      code,
      name: "  Ing. Carlos Ruiz  ",
      socketId: "sock-123"
    });

    assert.ok(p1.participantId);
    assert.equal(p1.name, "Ing. Carlos Ruiz");
    assert.ok(p1.rawToken, "Debe generar rawToken");
    assert.equal(p1.rawToken.length, 64, "El rawToken debe ser de 64 caracteres hex");

    // Intento de reconexión con el rawToken
    const reconn = await tournamentState.reconnectParticipant({
      code,
      rawToken: p1.rawToken,
      socketId: "sock-reconnected"
    });

    assert.ok(reconn, "Debe reconectar exitosamente");
    assert.equal(reconn.id, p1.participantId, "Debe ser el mismo participante");
    assert.equal(reconn.name, "Ing. Carlos Ruiz");
    assert.equal(reconn.socketId, "sock-reconnected");

    // Comprobar que no se duplicó el participante
    const room = tournamentState.getRoom(code);
    assert.equal(room.participants.size, 1, "La sala debe tener exactamente 1 participante");
  });

  t.after(() => {
    if (server) {
      server.close();
    }
  });
});
