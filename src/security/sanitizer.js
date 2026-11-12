"use strict";

/**
 * Sanitiza nombres de participantes y texto libre para evitar XSS o inyecciones visuales.
 */
function sanitizeName(name) {
  if (typeof name !== "string") return "";
  const cleaned = name
    .trim()
    .replace(/[<>'"&/\\;`()={}[\]]/g, "") // Remueve caracteres potencialmente peligrosos y código ejecutable
    .replace(/\s+/g, " ")                // Unifica espacios consecutivos
    .slice(0, 40);                      // Límite razonable de longitud
  return cleaned;
}

/**
 * Escapa caracteres HTML para salida segura en el DOM.
 */
function escapeHtml(str) {
  if (typeof str !== "string") return String(str || "");
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return str.replace(/[&<>"']/g, (m) => map[m]);
}

module.exports = {
  sanitizeName,
  escapeHtml
};
