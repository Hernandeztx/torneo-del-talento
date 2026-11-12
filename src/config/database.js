"use strict";

const { Pool } = require("pg");
const env = require("./env");

let pool = null;
let dbState = {
  configured: false,
  connected: false,
  lastError: null,
  latencyMs: null,
  testedAt: null
};

if (env.DATABASE_URL) {
  dbState.configured = true;
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: env.DATABASE_URL.includes("sslmode=require") || env.DATABASE_URL.includes("ssl=true")
      ? { rejectUnauthorized: false }
      : false
  });

  pool.on("error", (err) => {
    console.error("⚠️ Error inesperado en el Pool de PostgreSQL:", err.message);
    dbState.connected = false;
    dbState.lastError = err.message;
  });
}

/**
 * Prueba la conectividad con la base de datos y mide latencia.
 */
async function testConnection() {
  dbState.testedAt = new Date().toISOString();
  if (!pool) {
    dbState.connected = false;
    dbState.lastError = "DATABASE_URL no configurada";
    return dbState;
  }

  const start = Date.now();
  try {
    const res = await pool.query("SELECT 1 AS alive, NOW() AS server_time");
    dbState.connected = res.rows.length > 0;
    dbState.latencyMs = Date.now() - start;
    dbState.lastError = null;
  } catch (err) {
    dbState.connected = false;
    dbState.latencyMs = null;
    dbState.lastError = err.message;
  }
  return dbState;
}

/**
 * Ejecuta una consulta directa sobre el pool.
 */
async function query(text, params = []) {
  if (!pool) {
    throw new Error("Base de datos no inicializada: DATABASE_URL ausente");
  }
  return pool.query(text, params);
}

/**
 * Obtiene un cliente dedicado del pool para operaciones manuales.
 */
async function getClient() {
  if (!pool) {
    throw new Error("Base de datos no inicializada: DATABASE_URL ausente");
  }
  return pool.connect();
}

/**
 * Ejecuta un bloque de operaciones dentro de una transacción PostgreSQL (BEGIN / COMMIT / ROLLBACK).
 * Garantiza persistencia atómica para cambios críticos del torneo.
 */
async function withTransaction(callback) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cierra ordenadamente el pool de conexiones.
 */
async function closePool() {
  if (pool) {
    await pool.end();
    dbState.connected = false;
  }
}

function getStatus() {
  return { ...dbState };
}

module.exports = {
  pool,
  query,
  getClient,
  withTransaction,
  testConnection,
  closePool,
  getStatus
};

