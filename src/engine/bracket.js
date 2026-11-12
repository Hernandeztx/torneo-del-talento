"use strict";

const { shuffle } = require("../questions/questionService");

const BYE_ID = "__BYE__";

/**
 * Crea la estructura de un enfrentamiento individual.
 */
function createMatch(roundIndex, matchIndex, playerA = null, playerB = null) {
  return {
    id: `${roundIndex}-${matchIndex}`,
    roundIndex,
    matchIndex,
    playerA,
    playerB,
    scoreA: 0,
    scoreB: 0,
    winner: null,
    loser: null,
    isBye: false,
    status: "waiting" // 'waiting', 'ready', 'in_progress', 'completed'
  };
}

/**
 * Determina el nombre legible de la ronda.
 */
function getRoundName(roundIndex, totalRounds) {
  if (roundIndex === "t" || roundIndex === -1) return "Tercer puesto";
  const left = totalRounds - roundIndex;
  if (left === 1) return "Final";
  if (left === 2) return "Semifinal";
  if (left === 3) return "Cuartos de final";
  if (left === 4) return "Octavos de final";
  return `Ronda ${roundIndex + 1}`;
}

/**
 * Escala el nivel de dificultad según la ronda del torneo (1 a 3).
 * Idéntico a levelFor en Torneo_Talento.html (línea 396).
 */
function getLevelForMatch(roundIndex, totalRounds) {
  if (roundIndex === "t" || roundIndex === -1) {
    return totalRounds >= 3 ? 3 : 2;
  }
  if (totalRounds === 1) return 2;
  if (roundIndex === totalRounds - 1) return 3;
  return Math.min(3, 1 + Math.floor((roundIndex * 3) / totalRounds));
}

/**
 * Resuelve automáticamente los pases directos (BYE) en el cuadro.
 */
function autoResolveByes(rounds, thirdMatch) {
  const totalRounds = rounds.length;
  let changed = true;

  while (changed) {
    changed = false;
    const allMatches = rounds.flat().concat(thirdMatch ? [thirdMatch] : []);

    for (const m of allMatches) {
      if (m.status === "completed" || m.playerA === null || m.playerB === null) {
        continue;
      }

      const isABye = m.playerA && (m.playerA.id === BYE_ID || m.playerA === BYE_ID);
      const isBBye = m.playerB && (m.playerB.id === BYE_ID || m.playerB === BYE_ID);

      if (isABye && isBBye) {
        m.status = "completed";
        m.isBye = true;
        m.winner = m.playerA;
        m.loser = m.playerB;
        advanceWinner(rounds, thirdMatch, m, totalRounds);
        changed = true;
      } else if (isBBye) {
        m.status = "completed";
        m.isBye = true;
        m.winner = m.playerA;
        m.loser = m.playerB;
        advanceWinner(rounds, thirdMatch, m, totalRounds);
        changed = true;
      } else if (isABye) {
        m.status = "completed";
        m.isBye = true;
        m.winner = m.playerB;
        m.loser = m.playerA;
        advanceWinner(rounds, thirdMatch, m, totalRounds);
        changed = true;
      } else {
        // Si ambos jugadores son reales y aún está en waiting, pasa a ready
        if (m.status === "waiting") {
          m.status = "ready";
          changed = true;
        }
      }
    }
  }
}

/**
 * Avanza al ganador a la siguiente ronda o al perdedor a la final de consolidación (3er puesto).
 */
function advanceWinner(rounds, thirdMatch, match, totalRounds) {
  if (match.roundIndex === "t" || match.roundIndex === -1) return;

  const r = match.roundIndex;
  // Avanzar a la siguiente ronda
  if (r < totalRounds - 1) {
    const nextMatch = rounds[r + 1][Math.floor(match.matchIndex / 2)];
    if (match.matchIndex % 2 === 0) {
      nextMatch.playerA = match.winner;
    } else {
      nextMatch.playerB = match.winner;
    }
    if (nextMatch.playerA && nextMatch.playerB && nextMatch.status === "waiting") {
      nextMatch.status = "ready";
    }
  }

  // Si fue semifinal, enviar perdedor al duelo por el tercer puesto
  if (thirdMatch && r === totalRounds - 2) {
    if (match.matchIndex % 2 === 0) {
      thirdMatch.playerA = match.loser;
    } else {
      thirdMatch.playerB = match.loser;
    }
    if (thirdMatch.playerA && thirdMatch.playerB && thirdMatch.status === "waiting") {
      thirdMatch.status = "ready";
    }
  }
}

/**
 * Construye el árbol completo de eliminación directa con manejo automático de BYE y tercer puesto.
 */
function buildBracket(participants, enableThirdPlace = true) {
  if (!participants || participants.length < 2) {
    throw new Error("Se requieren al menos 2 participantes para generar el cuadro.");
  }

  // Orden aleatorio para sorteo inicial
  const shuffledPlayers = shuffle(participants);
  const n = shuffledPlayers.length;

  // Encontrar la potencia de 2 superior más cercana
  let size = 1;
  while (size < n) size *= 2;

  const totalRounds = Math.log2(size);
  const byes = size - n;
  const rounds = [];

  // Ronda 0 (Primera ronda)
  let playerIdx = 0;
  const round0 = [];
  const matchesInR0 = size / 2;

  for (let i = 0; i < matchesInR0; i++) {
    const playerA = shuffledPlayers[playerIdx++];
    const playerB = i < byes ? { id: BYE_ID, name: "Pasa directo" } : shuffledPlayers[playerIdx++];
    round0.push(createMatch(0, i, playerA, playerB));
  }
  rounds.push(round0);

  // Rondas subsiguientes vacías
  for (let r = 1; r < totalRounds; r++) {
    const roundMatches = [];
    const count = size / Math.pow(2, r + 1);
    for (let i = 0; i < count; i++) {
      roundMatches.push(createMatch(r, i, null, null));
    }
    rounds.push(roundMatches);
  }

  // Duelo por el tercer puesto (si hay semifinales, es decir, totalRounds >= 2)
  const thirdMatch = (enableThirdPlace && totalRounds >= 2)
    ? createMatch("t", 0, null, null)
    : null;

  // Resolver BYEs iniciales
  autoResolveByes(rounds, thirdMatch);

  return {
    rounds,
    thirdMatch,
    totalRounds,
    totalMatches: rounds.flat().length + (thirdMatch ? 1 : 0)
  };
}

module.exports = {
  BYE_ID,
  createMatch,
  getRoundName,
  getLevelForMatch,
  buildBracket,
  advanceWinner,
  autoResolveByes
};

