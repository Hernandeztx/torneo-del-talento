"use strict";

const { Server } = require("socket.io");
const env = require("../config/env");
const {
  activeRooms,
  registerParticipant,
  reconnectParticipant,
  markParticipantDisconnected,
  startTournament,
  isParticipantInMatch,
  getRoom
} = require("../engine/tournamentState");
const { sanitizeName } = require("../security/sanitizer");
const { verifyAdminSecret } = require("../security/tokens");
const {
  pickQuestion,
  sanitizeQuestionForClient,
  verifyAnswer,
  getQuestionDuration
} = require("../questions/questionService");
const { calculateScore } = require("../engine/scoring");

let ioInstance = null;

// Mapa para limitar frecuencia de eventos por socket (mitigación de flooding/spam)
const socketRateLimits = new Map();

function isRateLimited(socketId, maxPerSec = 10) {
  const now = Date.now();
  const entry = socketRateLimits.get(socketId) || { count: 0, resetAt: now + 1000 };

  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + 1000;
  } else {
    entry.count++;
  }

  socketRateLimits.set(socketId, entry);
  return entry.count > maxPerSec;
}

/**
 * Inicializa y configura el servidor Socket.IO con autorización basada en roles (socket.data).
 */
function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 5000
  });

  ioInstance = io;

  io.on("connection", (socket) => {
    // Inicializar metadatos de sesión en socket.data (no autenticado por defecto)
    socket.data = {
      authenticated: false,
      role: "espectador",
      tournamentCode: null,
      participantId: null,
      tokenHash: null
    };

    // -------------------------------------------------------------------
    // 1. UNIRSE A LA SALA (LOBBY DEL PARTICIPANTE) CON AUTENTICACIÓN
    // -------------------------------------------------------------------
    socket.on("join_participant", async (payload, callback) => {
      if (isRateLimited(socket.id)) return;
      const { code, name, rawToken } = payload || {};
      const roomCode = (code || "").toUpperCase();

      try {
        let result;
        // Si el cliente ya poseía un token previo (reconexión automática tras recargar)
        if (rawToken) {
          const reconnected = await reconnectParticipant({
            code: roomCode,
            rawToken,
            socketId: socket.id
          });
          if (reconnected) {
            socket.join(roomCode);
            // Fijar identidad y rol en socket.data
            socket.data.authenticated = true;
            socket.data.role = "participante";
            socket.data.tournamentCode = roomCode;
            socket.data.participantId = reconnected.id;
            socket.data.tokenHash = reconnected.tokenHash;

            result = {
              reconnected: true,
              participantId: reconnected.id,
              name: reconnected.name,
              tournamentCode: roomCode
            };
          }
        }

        // Si es un nuevo ingreso
        if (!result) {
          const cleanName = sanitizeName(name);
          if (!cleanName || cleanName.length < 2) {
            return callback && callback({ error: "Ingresa un nombre válido (mínimo 2 letras)." });
          }

          result = await registerParticipant({
            code: roomCode,
            name: cleanName,
            socketId: socket.id
          });

          socket.join(roomCode);
          // Fijar identidad y rol en socket.data
          socket.data.authenticated = true;
          socket.data.role = "participante";
          socket.data.tournamentCode = roomCode;
          socket.data.participantId = result.participantId;
        }

        const room = getRoom(roomCode);
        const pList = Array.from(room.participants.values()).map((p) => ({
          id: p.id,
          name: p.name,
          isConnected: p.isConnected
        }));

        io.to(roomCode).emit("lobby_updated", {
          totalParticipants: pList.length,
          participants: pList
        });

        if (callback) callback({ success: true, data: result });
      } catch (err) {
        if (callback) callback({ error: err.message });
      }
    });

    // -------------------------------------------------------------------
    // 2. UNIRSE COMO PANTALLA DE PROYECCIÓN (SOLO LECTURA)
    // -------------------------------------------------------------------
    socket.on("join_projection", (payload, callback) => {
      const roomCode = (payload?.code || "").toUpperCase();
      const room = getRoom(roomCode);
      if (!room) {
        return callback && callback({ error: "Torneo no encontrado." });
      }

      socket.join(roomCode);
      socket.data.role = "proyeccion";
      socket.data.tournamentCode = roomCode;
      socket.data.authenticated = true;

      const pList = Array.from(room.participants.values()).map((p) => ({
        id: p.id,
        name: p.name,
        isConnected: p.isConnected
      }));

      socket.emit("projection_state", {
        code: roomCode,
        name: room.name,
        status: room.status,
        participants: pList,
        rounds: room.rounds,
        thirdMatch: room.thirdMatch,
        currentMatchId: room.currentMatchId
      });

      if (callback) callback({ success: true });
    });

    // -------------------------------------------------------------------
    // 3. AUTENTICACIÓN DEL ORGANIZADOR
    // -------------------------------------------------------------------
    socket.on("auth_organizer", (payload, callback) => {
      const { code, adminSecret } = payload || {};
      const roomCode = (code || "").toUpperCase();
      const room = getRoom(roomCode);

      if (!room) {
        return callback && callback({ error: "Torneo no encontrado." });
      }

      if (!verifyAdminSecret(adminSecret)) {
        return callback && callback({ error: "Credencial de organizador no válida." });
      }

      socket.join(roomCode);
      socket.data.role = "organizador";
      socket.data.tournamentCode = roomCode;
      socket.data.authenticated = true;

      if (callback) callback({ success: true, message: "Organizador autenticado." });
    });

    // -------------------------------------------------------------------
    // 4. EVENTO PROTEGIDO: INICIAR TORNEO
    // -------------------------------------------------------------------
    socket.on("organizer_start_tournament", async (payload, callback) => {
      const { code, adminSecret } = payload || {};
      const requestedCode = (code || "").toUpperCase();

      // [FASE 1.2 / A-02]: Validación estricta de pertenencia y rol de organizador
      const sessionCode = socket.data.tournamentCode;
      const isAuthOrganizer = socket.data.authenticated && socket.data.role === "organizador";

      let targetCode = null;

      if (isAuthOrganizer) {
        // El organizador ya autenticado solo puede controlar su propio torneo
        if (requestedCode && requestedCode !== sessionCode) {
          return callback && callback({ 
            error: "Violación de autorización: No tienes permisos para controlar un torneo diferente al de tu sesión." 
          });
        }
        targetCode = sessionCode;
      } else {
        // Si no estaba autenticado en la sesión, exige obligatoriamente código y adminSecret válido
        if (!requestedCode || !adminSecret || !verifyAdminSecret(adminSecret)) {
          return callback && callback({ error: "No autorizado: credencial de organizador requerida." });
        }
        targetCode = requestedCode;
        socket.join(targetCode);
        socket.data.role = "organizador";
        socket.data.tournamentCode = targetCode;
        socket.data.authenticated = true;
      }

      const room = getRoom(targetCode);
      if (!room) {
        return callback && callback({ error: "Torneo no encontrado." });
      }

      try {
        const result = await startTournament({ code: targetCode, adminSecretOrToken: adminSecret });
        io.to(targetCode).emit("tournament_started", {
          status: "active",
          rounds: result.rounds,
          thirdMatch: result.thirdMatch
        });
        if (callback) callback({ success: true, data: result });
      } catch (err) {
        if (callback) callback({ error: err.message });
      }
    });

    // -------------------------------------------------------------------
    // 5. EVENTO PROTEGIDO: RESPUESTA DE DUELO EN TIEMPO REAL
    // -------------------------------------------------------------------
    socket.on("submit_answer", async (payload, callback) => {
      if (isRateLimited(socket.id)) return;

      // 1. Validar que el socket pertenezca a un participante autenticado
      if (!socket.data.authenticated || socket.data.role !== "participante") {
        return callback && callback({ error: "No autorizado: solo participantes registrados pueden responder." });
      }

      // [FASE 1.2 / A-03]: Obtener el código de sala EXCLUSIVAMENTE de socket.data
      const sessionRoomCode = socket.data.tournamentCode;
      if (!sessionRoomCode) {
        return callback && callback({ error: "Sesión no asociada a ningún torneo." });
      }

      const { tournamentCode, matchId, questionId, answer, participantId } = payload || {};

      // Si el payload intenta especificar un torneo diferente, rechazar explícitamente
      if (tournamentCode && tournamentCode.toUpperCase() !== sessionRoomCode) {
        return callback && callback({ error: "Inconsistencia de sala: no puedes enviar respuestas a un torneo diferente al de tu sesión." });
      }

      const roomCode = sessionRoomCode;

      // 2. Anti-spoofing: impedir que un participante responda usando el ID de otro
      if (socket.data.participantId !== participantId) {
        return callback && callback({ error: "Suplantación rechazada: tu sesión no coincide con el participante." });
      }

      const room = getRoom(roomCode);
      if (!room || room.status !== "active") {
        return callback && callback({ error: "El torneo no está activo." });
      }

      // 3. Validar que el participante pertenezca a los competidores del enfrentamiento activo
      if (!isParticipantInMatch(room, matchId, participantId)) {
        return callback && callback({ error: "No estás asignado como competidor en este enfrentamiento." });
      }

      // 4. Validar que la pregunta esté activa y corresponda al duelo
      if (!room.activeQuestion || room.activeQuestion.id !== questionId) {
        return callback && callback({ error: "La pregunta no está activa o ya expiró." });
      }

      // 5. Prevenir envíos duplicados en memoria
      if (!room.activeQuestion.receivedAnswers) {
        room.activeQuestion.receivedAnswers = new Map();
      }

      if (room.activeQuestion.receivedAnswers.has(participantId)) {
        return callback && callback({ error: "Ya enviaste tu respuesta para esta pregunta." });
      }

      // 6. Servidor como autoridad temporal y scoring autoritativo
      const now = Date.now();
      const startTime = room.activeQuestion.startTime;
      const durationMs = room.activeQuestion.durationMs;
      const isCorrect = verifyAnswer(room.activeQuestion, answer);

      const scoreResult = calculateScore({
        isCorrect,
        receivedAtServerTimestamp: now,
        questionStartTimeServerTimestamp: startTime,
        limitDurationMs: durationMs
      });

      const recordedAnswer = {
        participantId,
        givenAnswer: answer,
        isCorrect,
        points: scoreResult.points,
        elapsedMs: scoreResult.elapsedMs,
        isLate: scoreResult.isLate,
        answeredAt: new Date(now).toISOString()
      };

      room.activeQuestion.receivedAnswers.set(participantId, recordedAnswer);

      // Notificar al proyector y organizador que este jugador YA respondió (¡sin revelar qué marcó!)
      io.to(roomCode).emit("answer_acknowledged", {
        matchId,
        participantId,
        hasAnswered: true
      });

      if (callback) callback({ success: true, message: "Respuesta recibida correctamente." });
    });

    // -------------------------------------------------------------------
    // 6. DESCONEXIÓN Y POLÍTICA DE GRACIA PARA DUELOS
    // -------------------------------------------------------------------
    socket.on("disconnect", async () => {
      socketRateLimits.delete(socket.id);
      const dis = await markParticipantDisconnected(socket.id);
      if (!dis) return;

      const { room, participant } = dis;
      const pList = Array.from(room.participants.values()).map((p) => ({
        id: p.id,
        name: p.name,
        isConnected: p.isConnected
      }));

      io.to(room.code).emit("lobby_updated", {
        totalParticipants: pList.length,
        participants: pList
      });

      // POLÍTICA DE GRACIA CUANDO DESCONECTAN AMBOS COMPETIDORES:
      // [FASE 1.2 / A-04]: Capturar el matchId exacto para evitar interferencias
      const activeMatchId = room.currentMatchId;
      if (activeMatchId && isParticipantInMatch(room, activeMatchId, participant.id)) {
        const match = room.matches.get(activeMatchId);
        if (match && match.playerA && match.playerB) {
          const opponentId = match.playerA.id === participant.id ? match.playerB.id : match.playerA.id;
          const opponent = room.participants.get(opponentId);

          if (opponent && !opponent.isConnected) {
            // AMBOS competidores están desconectados
            if (!room.disconnectionGrace) {
              console.log(`⚠️ Ambos competidores del duelo ${activeMatchId} se desconectaron. Iniciando gracia de 30s...`);
              io.to(room.code).emit("duel_both_disconnected", {
                matchId: activeMatchId,
                graceSeconds: 30,
                message: "Ambos competidores perdieron conexión. Pausa temporal de 30s para reconexión."
              });

              room.disconnectionGrace = {
                matchId: activeMatchId,
                expiresAt: Date.now() + 30000,
                timeout: setTimeout(() => {
                  // [FASE 1.2 / A-04]: Verificar que el duelo siga siendo exactamente el capturado
                  if (room.currentMatchId !== activeMatchId) {
                    console.log(`ℹ️ Temporizador de gracia descartado: el duelo avanzó de ${activeMatchId} a ${room.currentMatchId}.`);
                    room.disconnectionGrace = null;
                    return;
                  }

                  // Verificar que ambos competidores continúen desconectados
                  const currentMatch = room.matches.get(activeMatchId);
                  if (currentMatch && currentMatch.playerA && currentMatch.playerB) {
                    const pA = room.participants.get(currentMatch.playerA.id);
                    const pB = room.participants.get(currentMatch.playerB.id);
                    if ((pA && pA.isConnected) || (pB && pB.isConnected)) {
                      console.log(`ℹ️ Temporizador de gracia descartado: al menos un competidor reconectó.`);
                      room.disconnectionGrace = null;
                      return;
                    }
                  }

                  console.log(`🛑 Periodo de gracia expirado para duelo ${activeMatchId}. Pausando enfrentamiento.`);
                  io.to(room.code).emit("duel_grace_expired", {
                    matchId: activeMatchId,
                    message: "Periodo de gracia agotado. El enfrentamiento queda en pausa para decisión del organizador."
                  });
                  room.disconnectionGrace = null;
                }, 30000)
              };
            }
          } else {
            // Solo uno se desconectó: avisar sin detener el cronómetro (para no perjudicar al conectado)
            io.to(room.code).emit("duel_player_disconnected", {
              matchId: activeMatchId,
              participantId: participant.id,
              name: participant.name,
              message: `${participant.name} se ha desconectado temporalmente.`
            });
          }
        }
      }
    });
  });

  return io;
}

function getIO() {
  return ioInstance;
}

module.exports = {
  initSocketServer,
  getIO
};
