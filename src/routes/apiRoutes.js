"use strict";

const express = require("express");
const QRCode = require("qrcode");
const env = require("../config/env");
const db = require("../config/database");
const { TOTAL_STATIC_QUESTIONS } = require("../questions/staticBank");
const { GENS } = require("../questions/mathGenerators");
const {
  createTournament,
  getRoom
} = require("../engine/tournamentState");
const { generateRoomCode } = require("../security/tokens");

const router = express.Router();

/**
 * Endpoint de Healthcheck (auditoría de salud y dependencias).
 * Utilizado por Docker HEALTHCHECK y sistemas de monitoreo.
 */
router.get("/health", async (req, res) => {
  const dbStatus = await db.testConnection();
  const uptimeSeconds = Math.floor(process.uptime());

  const responsePayload = {
    status: "ok",
    service: "torneo-del-talento-backend",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    uptime: `${uptimeSeconds}s`,
    database: {
      configured: dbStatus.configured,
      connected: dbStatus.connected,
      latency: dbStatus.latencyMs !== null ? `${dbStatus.latencyMs}ms` : null,
      lastError: dbStatus.lastError
    },
    questions: {
      staticLoaded: TOTAL_STATIC_QUESTIONS,
      mathGeneratorsCount: Object.keys(GENS).length
    },
    memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    environment: env.NODE_ENV,
    publicUrl: env.PUBLIC_URL
  };

  const statusCode = dbStatus.configured && !dbStatus.connected ? 503 : 200;
  return res.status(statusCode).json(responsePayload);
});

/**
 * Endpoint para crear un nuevo torneo.
 */
router.post("/tournament/create", async (req, res) => {
  try {
    const { name, settings, adminSecret } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 3) {
      return res.status(400).json({ error: "El nombre del torneo debe tener al menos 3 caracteres." });
    }

    const code = generateRoomCode();
    const result = await createTournament({
      code,
      name: name.trim(),
      settings: settings || {},
      adminSecret
    });

    // Detectar host dinámico a partir de la petición para permitir acceso desde IP local (móviles) o proxy
    const hostHeader = req.get("host");
    const protocol = req.protocol || "http";
    const baseUrl = (!env.isProduction() && hostHeader) 
      ? `${protocol}://${hostHeader}` 
      : env.PUBLIC_URL;

    const joinUrl = `${baseUrl}/jugar?code=${code}`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 1,
      color: {
        dark: "#0a302b",
        light: "#ffffff"
      }
    });

    return res.status(201).json({
      success: true,
      data: {
        ...result,
        joinUrl,
        qrCode: qrDataUrl
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint para obtener el código QR unificado en formato DataURL Base64 o SVG.
 */
router.get("/tournament/:code/qr", async (req, res) => {
  const code = (req.params.code || "").toUpperCase();
  const hostHeader = req.get("host");
  const protocol = req.protocol || "http";
  const baseUrl = (!env.isProduction() && hostHeader) 
    ? `${protocol}://${hostHeader}` 
    : env.PUBLIC_URL;

  const joinUrl = `${baseUrl}/jugar?code=${code}`;

  try {
    const format = req.query.format || "png";
    if (format === "svg") {
      const svg = await QRCode.toString(joinUrl, { type: "svg", margin: 1 });
      res.setHeader("Content-Type", "image/svg+xml");
      return res.send(svg);
    }

    const dataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 400,
      color: {
        dark: "#0a302b",
        light: "#ffffff"
      }
    });
    return res.json({ code, joinUrl, qrDataUrl: dataUrl });
  } catch (err) {
    return res.status(500).json({ error: "Error al generar el código QR" });
  }
});

module.exports = router;

