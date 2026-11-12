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
  const code = (req.query.code || req.query.codigo || "").toUpperCase();
  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf8">
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
      <title>Participar | Torneo del Talento</title>
      <style>
        body { font-family: sans-serif; background: #0a302b; color: #eef4f1; margin: 0; padding: 20px; text-align: center; }
        .box { max-width: 420px; margin: 40px auto; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 24px; }
        h1 { color: #f2a93b; margin-top: 0; }
        input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid #a9c7bb; margin: 12px 0; font-size: 16px; background: #04130f; color: #fff; text-align: center; }
        .tag { display: inline-block; background: rgba(242,169,59,0.15); color: #f2a93b; padding: 4px 10px; border-radius: 6px; font-weight: bold; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="tag">FASE 1: BACKEND ACTIVO</div>
        <h1>Torneo del Talento</h1>
        <p>Vista del Participante</p>
        <p>Código de sala detectado: <b>${code || "Ninguno (ingrésalo a continuación)"}</b></p>
        <p><small>En la Fase 2 y 4 se habilitará la interfaz interactiva móvil completa estilo Kahoot.</small></p>
      </div>
    </body>
    </html>
  `);
});

/**
 * Ruta del organizador
 */
router.get(["/organizador", "/admin"], (req, res) => {
  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Organizador | Torneo del Talento</title>
      <style>
        body { font-family: sans-serif; background: #0a302b; color: #eef4f1; margin: 0; padding: 20px; }
        .box { max-width: 600px; margin: 40px auto; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 24px; }
        h1 { color: #f2a93b; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>Panel del Organizador</h1>
        <p>Backend v1.0.0 activo y escuchando peticiones en tiempo real.</p>
        <p><a href="/original" style="color:#f2a93b">Ver aplicación original preservada (Torneo_Talento.html)</a></p>
      </div>
    </body>
    </html>
  `);
});

/**
 * Ruta de proyección
 */
router.get(["/proyeccion", "/proyeccion/:code", "/presentacion/:code"], (req, res) => {
  const code = (req.params.code || req.query.code || "").toUpperCase();
  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Proyección | Torneo del Talento</title>
      <style>
        body { font-family: sans-serif; background: #0a302b; color: #eef4f1; margin: 0; padding: 20px; text-align: center; }
        h1 { color: #f2a93b; font-size: 40px; }
      </style>
    </head>
    <body>
      <h1>Pantalla de Proyección</h1>
      <p>Sala: <b>${code || "En espera"}</b></p>
    </body>
    </html>
  `);
});

/**
 * Redirección raíz
 */
router.get("/", (req, res) => {
  res.redirect("/organizador");
});

module.exports = router;

