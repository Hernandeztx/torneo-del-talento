"use strict";

const http = require("http");
const app = require("./app");
const env = require("./config/env");
const db = require("./config/database");
const { initSocketServer } = require("./socket/socketServer");
const { TOTAL_STATIC_QUESTIONS } = require("./questions/staticBank");
const { GENS } = require("./questions/mathGenerators");
const { hydrateActiveRoomsFromDB } = require("./engine/tournamentState");

const server = http.createServer(app);

// Inicializar Socket.IO sobre el servidor HTTP
initSocketServer(server);

async function startServer() {
  console.log("==================================================");
  console.log("🚀 INICIANDO TORNEO DEL TALENTO — BACKEND BASE");
  console.log("==================================================");
  console.log(`📍 Entorno: ${env.NODE_ENV}`);
  console.log(`🌐 URL Pública: ${env.PUBLIC_URL}`);
  console.log(`📚 Banco de preguntas: ${TOTAL_STATIC_QUESTIONS} estáticas + ${Object.keys(GENS).length} generadores matemáticos cargados.`);

  // Verificar conexión con PostgreSQL
  const dbStatus = await db.testConnection();
  if (dbStatus.connected) {
    console.log(`✅ PostgreSQL conectado exitosamente (${dbStatus.latencyMs} ms de latencia).`);
    // [FASE 1.1]: Rehidratación de estado de torneos activos tras reinicio
    await hydrateActiveRoomsFromDB();
  } else {
    console.warn(`⚠️ PostgreSQL no conectado: ${dbStatus.lastError}`);
    console.warn("ℹ️ El servidor operará en modo memoria mientras PostgreSQL no esté disponible.");
  }

  server.listen(env.PORT, () => {
    console.log(`⚡ Servidor HTTP y WebSockets escuchando en el puerto ${env.PORT}`);
    console.log(`👉 Healthcheck: ${env.PUBLIC_URL}/api/health`);
    console.log(`👉 Vista de Participante: ${env.PUBLIC_URL}/jugar`);
    console.log(`👉 Archivo original preservado: ${env.PUBLIC_URL}/original`);
    console.log("==================================================");
  });
}

// Cierre ordenado (Graceful Shutdown)
function handleShutdown(signal) {
  console.log(`\n🛑 Recibida señal ${signal}. Cerrando servidor ordenadamente...`);
  server.close(async () => {
    console.log("🔌 Servidor HTTP cerrado.");
    await db.closePool();
    console.log("📦 Conexiones a base de datos cerradas.");
    process.exit(0);
  });

  // Forzar cierre si no responde en 5 segundos
  setTimeout(() => {
    console.error("⚠️ Cierre forzado por tiempo límite.");
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

if (require.main === module) {
  startServer().catch((err) => {
    console.error("❌ Error fatal al iniciar el servidor:", err);
    process.exit(1);
  });
}

module.exports = { server, app };

