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

const os = require("os");

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

async function startServer() {
  const localIp = getLocalIpAddress();

  console.log("==================================================");
  console.log("🚀 INICIANDO TORNEO DEL TALENTO — BACKEND BASE");
  console.log("==================================================");
  console.log(`📍 Entorno: ${env.NODE_ENV}`);
  console.log(`🌐 IP de Red Local (Wi-Fi): http://${localIp}:${env.PORT}`);
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

  server.listen(env.PORT, "0.0.0.0", () => {
    console.log(`⚡ Servidor escuchando en TODAS las interfaces (0.0.0.0:${env.PORT})`);
    console.log(`👉 Panel Organizador (este equipo): http://localhost:${env.PORT}/organizador`);
    console.log(`👉 Panel Organizador (misma red):   http://${localIp}:${env.PORT}/organizador`);
    console.log(`👉 Vista de Participante (celulares): http://${localIp}:${env.PORT}/jugar`);
    console.log(`👉 Pantalla de Proyección:           http://${localIp}:${env.PORT}/proyeccion`);
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

