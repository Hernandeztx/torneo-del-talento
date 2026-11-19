# FASE 2.5: MOTOR DE ORQUESTACIÓN DE DUELOS EN TIEMPO REAL

## 1. RESUMEN TÉCNICO

En esta fase se implementó la arquitectura autoritativa del servidor para la orquestación de enfrentamientos 1v1 en tiempo real. El servidor actúa como la única autoridad en el ciclo de vida del torneo, preguntas, cronómetro, evaluación de respuestas, asignación de puntos, avance del bracket y determinación del podio final.

---

## 2. MÁQUINA DE ESTADOS DEL DUELO

```
[waiting]
   │
   ▼ (organizer_start_match)
[match_ready]
   │
   ▼ (organizer_launch_question)
[question_active] ──── (auto-cierre timeout / organizer_close_question) ────► [question_closed]
                                                                                   │
                                                                                   ▼ (organizer_reveal_answer)
                                                                            [answer_revealed]
                                                                                   │
                                                                   ┌───────────────┴───────────────┐
                                                                   │ (quedan preguntas)            │ (fin de preguntas)
                                                                   ▼                               ▼
                                                           [organizer_launch_q]             [organizer_next_match]
                                                                   │                               │
                                                                   ▼                               ▼
                                                            [question_active]              [match_finished]
                                                                                                   │
                                                                                   ┌───────────────┴───────────────┐
                                                                                   ▼                               ▼
                                                                           [siguiente match]             [tournament_finished]
```

### Definición de Estados:
- **`waiting`**: Sala en espera o en transición entre enfrentamientos.
- **`match_ready`**: Enfrentamiento seleccionado con ambos jugadores válidos y listo para la primera pregunta.
- **`question_active`**: Pregunta lanzada, cronómetro autoritativo en marcha y recepción de respuestas habilitada.
- **`question_closed`**: Tiempo límite alcanzado o cerrado anticipadamente por el organizador; no se admiten más respuestas.
- **`answer_revealed`**: Respuesta correcta expuesta a todos los clientes, cómputo de puntos completado y marcadores actualizados.
- **`match_finished`**: Enfrentamiento concluido, ganador determinado (incluyendo desempate por velocidad), bracket avanzado.
- **`tournament_finished`**: Todos los enfrentamientos del bracket completados; podio (1°, 2° y 3° lugar) proclamado.

---

## 3. MAPA DE EVENTOS SOCKET.IO

| Evento | Emisor | Receptor | Datos (Payload) | Autorización |
|---|---|---|---|---|
| `organizer_start_match` | Organizador | Servidor | `{ code, matchId }` | `organizador` autenticado + coincidencia de sala |
| `match_started` | Servidor | Sala (Broadcast) | `{ matchId, playerA, playerB, roundIndex, questionsTotal }` | Pública en sala |
| `organizer_launch_question` | Organizador | Servidor | `{ code }` | `organizador` autenticado + coincidencia de sala |
| `question_started` | Servidor | Sala (Broadcast) | `{ matchId, question (sanitizada), durationMs, startTime, questionOrder, totalQuestions }` | Pública en sala (sin respuesta correcta ni explicación) |
| `submit_answer` | Participante | Servidor | `{ tournamentCode, matchId, questionId, answer, participantId }` | `participante` autenticado + competidor del match activo |
| `answer_acknowledged` | Servidor | Sala (Broadcast) | `{ matchId, participantId, hasAnswered: true }` | Pública en sala (sin revelar opción elegida) |
| `organizer_close_question` | Organizador | Servidor | `{ code }` | `organizador` autenticado + coincidencia de sala |
| `question_closed` | Servidor | Sala (Broadcast) | `{ matchId, questionId, timeExpired }` | Pública en sala |
| `organizer_reveal_answer` | Organizador | Servidor | `{ code }` | `organizador` autenticado + coincidencia de sala |
| `question_revealed` | Servidor | Sala (Broadcast) | `{ matchId, question (completa), results, matchScores, questionsPlayed, totalQuestions }` | Pública en sala |
| `organizer_next_match` | Organizador | Servidor | `{ code }` | `organizador` autenticado + coincidencia de sala |
| `duel_result` | Servidor | Sala (Broadcast) | `{ matchId, winner, loser, isTiebreak, rounds, thirdMatch }` | Pública en sala |
| `organizer_finish_tournament` | Organizador | Servidor | `{ code }` | `organizador` autenticado + coincidencia de sala |
| `tournament_finished` | Servidor | Sala (Broadcast) | `{ code, name, podium: [{ rank, id, name, score }] }` | Pública en sala |

---

## 4. REGLAS DE PUNTUACIÓN Y TIEMPOS

1. **Fórmula Autoritativa:**
   $$\text{Puntos} = \text{round}\left(1000 \times \left(1 - \frac{\text{tiempo\_transcurrido}}{\text{tiempo\_limite}} \times \frac{1}{2}\right)\right)$$
   - Acierto inmediato ($0\text{ s}$): $1000$ puntos.
   - Acierto al límite del tiempo: $500$ puntos.
   - Respuesta incorrecta o no enviada: $0$ puntos.
2. **Margen de Red:** Período de gracia de $800\text{ ms}$ (`LATENCY_GRACE_PERIOD_MS`) para tolerar latencia móvil. Respuestas recibidas después de $\text{límite} + 800\text{ ms}$ son rechazadas como tardías ($0$ puntos).
3. **Criterio de Desempate:** En caso de empate en puntuación total al finalizar las preguntas del duelo, se define al ganador por el competidor con menor tiempo acumulado en respuestas correctas.

---

## 5. PROTECCIÓN CONTRA CONCURRENCIA Y SEGURIDAD

- **Lock de Duelo (`room.duelLock`):** Cada transición de estado adquiere y libera un cerrojo en memoria, impidiendo que peticiones paralelas disparen lanzamientos simultáneos o dobles revelaciones.
- **Anti-Spoofing en Respuestas:** Validación estricta que coteja `socket.data.participantId === payload.participantId` y verifica `isParticipantInMatch(room, matchId, participantId)`.
- **Preexistencia de Respuestas:** El mapa `receivedAnswers` impide más de una respuesta por participante por pregunta.
- **Secreto Criptográfico:** `sanitizeQuestionForClient()` elimina `correctAnswer` y `explanation` antes de cualquier emisión de pregunta.

---

## 6. INTEGRACIÓN DE FRONTENDS

1. **Participante (`/jugar`):**
   - Escucha `match_started` para mostrar la pantalla de espectador con los nombres de los competidores.
   - Escucha `question_started` para mostrar las opciones (opción múltiple, verdadero/falso, ordenamiento o teclado numérico) y el temporizador sincronizado.
   - Escucha `question_closed` para deshabilitar botones.
   - Escucha `question_revealed` para presentar el veredicto personal, puntos y explicación.
   - Escucha `duel_result` y `tournament_finished` para retroalimentación y efectos de confetti.

2. **Proyección (`/proyeccion`):**
   - Visualiza la arena de duelo 1v1 con barras de participantes, nombres y avatares.
   - Cronómetro visual circular y barra de progreso sincronizados con el servidor.
   - Indicadores de respuesta en vivo sin revelar la opción marcada por el competidor.
   - Resaltado de la opción correcta al revelar.
   - Visualización del podio oficial de premiación (1°, 2° y 3° lugar).

3. **Panel del Organizador (`/organizador`):**
   - Tarjetas de control en vivo para activar duelos del bracket (`▶ Activar Duelo`).
   - Botonera de control de duelo:
     - `🎯 Lanzar Pregunta`
     - `⏹ Cerrar Tiempo`
     - `🔍 Revelar Respuesta`
     - `⏭ Siguiente` (avanza pregunta o match según corresponda)
     - `🏁 Finalizar Torneo`
   - Protección contra doble clic e inhabilitación dinámica según la máquina de estados.

---

## 7. SUITE DE PRUEBAS AUTOMATIZADAS

La suite completa abarca **108 pruebas superadas (0 fallos)** divididas en 7 módulos:
- `phase1.test.js` (22 pruebas)
- `phase1_1.test.js` (12 pruebas)
- `phase1_2.test.js` (18 pruebas)
- `phase2_participant.test.js` (5 pruebas)
- `phase2_projection.test.js` (5 pruebas)
- `phase2_organizer.test.js` (6 pruebas)
- `phase2_duel_engine.test.js` (40 pruebas)

### Integridad del Archivo Original:
- Archivo: `Torneo_Talento.html`
- Algoritmo: `SHA-256`
- Hash: `9653BC7BDEFA1141950DDB0822E2D9768E7EED06915A60E6ADD130B9C6336248` (Inalterado)
