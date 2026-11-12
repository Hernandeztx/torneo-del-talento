"use strict";

const { STATIC_BANK } = require("./staticBank");
const { generateMathQuestion } = require("./mathGenerators");

/**
 * Baraja un array usando Fisher-Yates (inmutable).
 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Calcula el tiempo límite oficial según el tipo de pregunta.
 * Idéntico a Torneo_Talento.html (línea 417):
 * base + 15s para ordenar, base + 40s para cálculo numérico.
 */
function getQuestionDuration(question, baseSeconds = 20) {
  const extra = question.type === "ord" ? 15 : (question.type === "num" ? 40 : 0);
  return (baseSeconds + extra) * 1000; // Milisegundos
}

/**
 * Prepara una pregunta para ser jugada en el enfrentamiento.
 * Baraja opciones para opción múltiple y ordenamiento.
 */
function prepareQuestionForMatch(rawQuestion) {
  const q = { ...rawQuestion };

  if (q.type === "mc") {
    q.shownOptions = shuffle(q.options);
    q.correctAnswer = q.options[0];
  } else if (q.type === "ord") {
    let shuffled = shuffle(q.options);
    if (shuffled.join("|") === q.options.join("|")) {
      shuffled = shuffled.reverse();
    }
    q.shownOptions = shuffled;
    q.correctAnswer = q.options.slice(); // Orden canónico
  } else if (q.type === "vf") {
    q.shownOptions = [true, false];
  } else if (q.type === "num") {
    q.shownOptions = null;
  }

  return q;
}

/**
 * Sanitiza una pregunta antes de emitirla por Socket.IO a los participantes y al proyector.
 * ¡CRÍTICO DE SEGURIDAD!: Elimina cualquier pista de la respuesta correcta y la explicación.
 */
function sanitizeQuestionForClient(preparedQuestion) {
  return {
    id: preparedQuestion.id,
    type: preparedQuestion.type,
    level: preparedQuestion.level,
    category: preparedQuestion.category,
    question: preparedQuestion.question,
    options: preparedQuestion.shownOptions,
    unit: preparedQuestion.unit || null
  };
}

/**
 * Valida la respuesta enviada por un participante.
 * Lógica matemática idéntica a check(q, given) de Torneo_Talento.html (líneas 443-450).
 */
function verifyAnswer(question, givenAnswer) {
  if (givenAnswer === null || givenAnswer === undefined) return false;

  if (question.type === "mc") {
    return String(givenAnswer).trim() === String(question.correctAnswer).trim();
  }

  if (question.type === "vf") {
    return Boolean(givenAnswer) === Boolean(question.correctAnswer);
  }

  if (question.type === "ord") {
    if (!Array.isArray(givenAnswer)) return false;
    const expected = Array.isArray(question.correctAnswer) ? question.correctAnswer : question.options;
    return givenAnswer.join("|") === expected.join("|");
  }

  if (question.type === "num") {
    let x = String(givenAnswer).trim().replace(/\s/g, "");
    if (x.includes(",")) {
      x = x.replace(/\./g, "").replace(",", ".");
    } else if (/^\d{1,3}(\.\d{3})+$/.test(x)) {
      x = x.replace(/\./g, "");
    }
    const val = parseFloat(x);
    const expected = parseFloat(question.correctAnswer);
    const tolerance = question.tolerance !== undefined ? question.tolerance : 0;
    return !isNaN(val) && Math.abs(val - expected) <= tolerance + 1e-9;
  }

  return false;
}

/**
 * Selecciona una pregunta apropiada para la ronda sin repetir las ya utilizadas.
 */
function pickQuestion({ targetLevel = 2, lastType = null, usedKeys = new Set(), customQuestions = [] }) {
  const pool = STATIC_BANK.concat(customQuestions).filter((q) => !usedKeys.has(q.id));

  // 1. Intentar buscar en niveles cercanos
  const levelCandidates = [targetLevel, targetLevel - 1, targetLevel + 1, targetLevel - 2, targetLevel + 2];
  for (const lv of levelCandidates) {
    let available = pool.filter((q) => q.level === lv);
    if (!available.length) continue;

    // Variar el tipo respecto al anterior si es posible
    const varied = available.filter((q) => q.type !== lastType);
    if (varied.length) available = varied;

    const chosen = available[Math.floor(Math.random() * available.length)];
    usedKeys.add(chosen.id);
    return prepareQuestionForMatch(chosen);
  }

  // 2. Si no hay estáticas disponibles, generar una matemática procedimental
  const mathQ = generateMathQuestion(targetLevel, usedKeys);
  if (mathQ) {
    return prepareQuestionForMatch(mathQ);
  }

  return null;
}

module.exports = {
  shuffle,
  getQuestionDuration,
  prepareQuestionForMatch,
  sanitizeQuestionForClient,
  verifyAnswer,
  pickQuestion
};

