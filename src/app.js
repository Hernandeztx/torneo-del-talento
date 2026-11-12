"use strict";

const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const env = require("./config/env");
const apiRoutes = require("./routes/apiRoutes");
const viewRoutes = require("./routes/viewRoutes");

const app = express();

// Seguridad HTTP con Helmet (ajustando CSP para permitir WebSockets y scripts en línea si se requiere)
app.use(
  helmet({
    contentSecurityPolicy: false, // Se configurará finamente en la fase de frontend
    crossOriginEmbedderPolicy: false
  })
);

// Control de Acceso CORS
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true
  })
);

// Parseo de cuerpos JSON y URL-encoded
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Archivos estáticos
app.use("/public", express.static(path.join(__dirname, "public")));

// Montaje de rutas API y Vistas
app.use("/api", apiRoutes);
app.use("/", viewRoutes);

// Manejador 404
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada", path: req.originalUrl });
});

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error("❌ Error no controlado:", err);
  res.status(500).json({
    error: "Error interno del servidor",
    message: env.isProduction() ? "Ocurrió un error inesperado" : err.message
  });
});

module.exports = app;

