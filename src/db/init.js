"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../config/database");

/**
 * Inicializa el esquema de PostgreSQL ejecutando el archivo schema.sql.
 */
async function initializeSchema() {
  const status = await db.testConnection();
  if (!status.connected) {
    console.warn("⚠️ PostgreSQL no está conectado actualmente:", status.lastError);
    console.warn("ℹ️ La inicialización del esquema en base de datos física se omitirá hasta que PostgreSQL esté en ejecución.");
    return false;
  }

  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  try {
    console.log("🔄 Aplicando esquema DDL en PostgreSQL...");
    await db.query(sql);
    console.log("✅ Esquema de base de datos aplicado correctamente.");
    return true;
  } catch (err) {
    console.error("❌ Error al aplicar el esquema en PostgreSQL:", err.message);
    throw err;
  }
}

// Ejecución directa si se invoca con `node src/db/init.js`
if (require.main === module) {
  initializeSchema()
    .then((ok) => {
      if (ok) console.log("🏁 Proceso de base de datos finalizado con éxito.");
      process.exit(ok ? 0 : 1);
    })
    .catch(() => process.exit(1));
}

module.exports = {
  initializeSchema
};

