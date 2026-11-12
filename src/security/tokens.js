"use strict";

const crypto = require("crypto");
const env = require("../config/env");

/**
 * Genera un token criptográficamente seguro para un participante u organizador.
 * Longitud: 64 caracteres hexadecimales (32 bytes de entropía).
 */
function generateSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Calcula el hash SHA-256 del token para almacenamiento seguro en PostgreSQL.
 * NUNCA se almacena el token en texto plano en la base de datos.
 */
function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("Token no válido para hashing");
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Compara un token en texto plano con un hash almacenado de forma segura (mitigando ataques de temporización).
 */
function verifyToken(rawToken, storedHash) {
  if (!rawToken || !storedHash) return false;
  try {
    const computedHash = hashToken(rawToken);
    return crypto.timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(storedHash, "hex"));
  } catch (err) {
    return false;
  }
}

/**
 * Genera un código de acceso amigable de 6 caracteres alfanuméricos en mayúsculas (ej: 'TAL482')
 * evitando caracteres ambiguos como 'O', '0', 'I', '1'.
 */
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Valida la clave secreta o token administrativo del organizador.
 */
function verifyAdminSecret(candidateSecret) {
  if (!candidateSecret || typeof candidateSecret !== "string") return false;
  try {
    const a = crypto.createHash("sha256").update(candidateSecret).digest();
    const b = crypto.createHash("sha256").update(env.ADMIN_SECRET).digest();
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    return false;
  }
}

module.exports = {
  generateSecureToken,
  hashToken,
  verifyToken,
  generateRoomCode,
  verifyAdminSecret
};

