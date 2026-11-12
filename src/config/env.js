"use strict";

const path = require("path");
const dotenv = require("dotenv");

// Cargar .env si existe
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ===========================================================================
// VALIDACIÓN CRÍTICA DE ADMIN_SECRET
//
// En producción: la ausencia o uso del valor de ejemplo provoca un error fatal
// que detiene el proceso inmediatamente. No existe fallback funcional.
//
// En desarrollo / test: se usa un valor fijo claramente marcado como no válido
// para producción. Nunca puede confundirse con un secreto real.
// ===========================================================================

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// Valor centinela usado únicamente en entornos de desarrollo y pruebas.
// NO es un secreto real. NO funciona en producción.
const DEV_ONLY_ADMIN_SECRET = "dev-only__NO-usar-en-produccion";

function resolveAdminSecret() {
  const raw = process.env.ADMIN_SECRET;

  if (IS_PRODUCTION) {
    // En producción: exigir variable de entorno configurada explícitamente
    if (!raw || raw.trim() === "") {
      console.error("❌ FATAL: La variable de entorno ADMIN_SECRET no está configurada.");
      console.error("   Configure ADMIN_SECRET con un valor aleatorio seguro antes de iniciar en producción.");
      process.exit(1);
    }
    // Rechazar el marcador de posición del .env.example si alguien lo copió sin cambiarlo
    if (raw.trim() === "REEMPLAZAR_POR_UN_SECRETO_ALEATORIO") {
      console.error("❌ FATAL: ADMIN_SECRET contiene el valor de marcador de posición de .env.example.");
      console.error("   Genere un secreto aleatorio seguro y configúrelo antes de iniciar en producción.");
      process.exit(1);
    }
    return raw.trim();
  }

  // Desarrollo y pruebas: usar variable si está definida, o el centinela de desarrollo
  return (raw && raw.trim()) ? raw.trim() : DEV_ONLY_ADMIN_SECRET;
}

const env = {
  NODE_ENV,
  PORT: parseInt(process.env.PORT || "3000", 10),
  PUBLIC_URL: (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, ""),
  DATABASE_URL: process.env.DATABASE_URL || "",
  ADMIN_SECRET: resolveAdminSecret(),
  LATENCY_GRACE_PERIOD_MS: parseInt(process.env.LATENCY_GRACE_PERIOD_MS || "800", 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",

  isProduction() {
    return this.NODE_ENV === "production";
  }
};

module.exports = env;

