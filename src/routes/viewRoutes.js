"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

/**
 * Ruta canónica para el archivo original de respaldo (NUNCA modificado).
 */
router.get("/original", (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "Torneo_Talento.html"));
});

/**
 * Rutas unificadas para el participante (Soporta ?code=XXXX o ?codigo=XXXX)
 */
router.get(["/jugar", "/unirse"], (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "src/views/participant.html"));
});

/**
 * Ruta del organizador
 */
router.get(["/organizador", "/admin"], (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "src/views/organizer.html"));
});

/**
 * Ruta de proyección
 */
router.get(["/proyeccion", "/proyeccion/:code", "/presentacion/:code"], (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "src/views/projection.html"));
});

/**
 * Redirección raíz
 */
router.get("/", (req, res) => {
  res.redirect("/organizador");
});

module.exports = router;

