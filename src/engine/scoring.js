"use strict";

const env = require("../config/env");

/**
 * Calcula la puntuación oficial autoritativa según precisión y velocidad.
 * 
 * Regla matemática:
 * - Respuesta incorrecta o sin responder: 0 puntos.
 * - Respuesta correcta: Puntos = round( 1000 * (1 - (tiempo_transcurrido / tiempo_limite) / 2) )
 *   - Mínimo puntaje por acierto (al límite del tiempo): 500 puntos.
 *   - Máximo puntaje por acierto instantáneo: 1000 puntos.
 * 
 * Margen de tolerancia de red:
 * - Se permite un periodo de gracia (LATENCY_GRACE_PERIOD_MS, por defecto 800 ms) para absorber
 *   la fluctuación de latencia (RTT) en redes celulares sin perjudicar al estudiante.
 * - Toda respuesta recibida después de (tiempo_limite + gracia) es rechazada como tardía (0 puntos).
 */
function calculateScore({
  isCorrect,
  receivedAtServerTimestamp,
  questionStartTimeServerTimestamp,
  limitDurationMs,
  gracePeriodMs = env.LATENCY_GRACE_PERIOD_MS
}) {
  if (!isCorrect) {
    return {
      points: 0,
      elapsedMs: Math.max(0, receivedAtServerTimestamp - questionStartTimeServerTimestamp),
      isLate: false,
      reason: "incorrect"
    };
  }

  const rawElapsed = receivedAtServerTimestamp - questionStartTimeServerTimestamp;
  const elapsedMs = Math.max(0, rawElapsed);

  // Verificación estricta de tiempo límite + tolerancia de red
  if (elapsedMs > limitDurationMs + gracePeriodMs) {
    return {
      points: 0,
      elapsedMs,
      isLate: true,
      reason: "time_expired"
    };
  }

  // Acotar el tiempo transcurrido para la fórmula al límite oficial
  const effectiveElapsed = Math.min(limitDurationMs, elapsedMs);

  // Fórmula oficial: 1000 * (1 - (tiempo / limite) / 2)
  const ratio = effectiveElapsed / limitDurationMs;
  const rawPoints = 1000 * (1 - ratio / 2);
  const points = Math.round(rawPoints);

  return {
    points,
    elapsedMs,
    isLate: false,
    reason: "correct"
  };
}

module.exports = {
  calculateScore
};

