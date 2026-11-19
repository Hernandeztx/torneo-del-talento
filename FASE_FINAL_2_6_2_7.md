# TORNEO DEL TALENTO — FASE FINAL 2.6 + 2.7
## CIERRE FUNCIONAL, INTEGRACIÓN, AUDITORÍA Y PREPARACIÓN PARA PRUEBA REAL

---

## 1. ARQUITECTURA FINAL DEL PROYECTO

El sistema está construido como una aplicación monolítica modular en **Node.js + Express** con comunicación bidireccional en tiempo real a través de **Socket.IO** y persistencia en **PostgreSQL**.

### Componentes Clave:
- **`src/engine/duelOrchestrator.js`**: Motor autoritativo de máquina de estados para los duelos (`waiting` -> `match_ready` -> `question_active` -> `question_closed` -> `answer_revealed` -> `match_finished` -> `tournament_finished`).
- **`src/engine/tournamentState.js`**: Registro de salas en memoria para baja latencia, participantes, hash SHA-256 de tokens y recuperación/rehidratación desde PostgreSQL.
- **`src/engine/bracket.js`**: Generación recursiva de árboles de eliminación directa, cálculo de BYEs automáticos, asignación de semifinales y partido de consolidación (3er puesto).
- **`src/engine/scoring.js`**: Puntuación autoritativa basada en precisión y velocidad ($1000\text{ a }500\text{ pts}$ con decaimiento lineal) con tolerancia de red de $800\text{ ms}$.
- **`src/socket/socketServer.js`**: Enrutador de eventos Socket.IO protegidos por roles (`participante`, `organizador`, `proyeccion`).
- **`src/questions/`**: Banco con 72 preguntas estáticas y 5 generadores matemáticos procedimentales.

---

## 2. FLUJO COMPLETO DE UN TORNEO

1. **Creación:** El organizador define nombre, parámetros (preguntas por duelo, tiempo por pregunta, tercer puesto) y contraseña administrativa en `/organizador`.
2. **Inscripción:** Los competidores ingresan el código de sala y su nombre en `/jugar`. El servidor les genera un token criptográfico único (`sessionStorage`).
3. **Lobby:** Tanto la proyección `/proyeccion` como el panel `/organizador` reflejan en tiempo real el mosaico de participantes inscritos.
4. **Sorteo y Cuadro:** Al iniciar el torneo, se arma el bracket de eliminación directa y se resuelven pases directos (`BYE`).
5. **Duelos 1v1:**
   - El organizador activa el duelo listo en el cuadro.
   - Ambos competidores reciben la vista de duelo y el público observa la arena en pantalla gigante.
   - El organizador lanza la pregunta. Ambos participantes reciben la misma pregunta simultáneamente y el cronómetro autoritativo comienza a descontar.
   - Al responder un jugador, el servidor notifica a la proyección y al panel que "ya respondió" sin revelar su selección.
   - Cumplido el tiempo o cerrado manualmente, el organizador revela la respuesta correcta, puntuaciones y explicaciones.
   - Concluidas las preguntas configuradas, el ganador avanza a la siguiente ronda (o al 3er puesto si perdió en semifinal).
6. **Gran Final y Podio:**
   - La final define el Campeón (1°) y Subcampeón (2°).
   - El duelo por el 3er puesto define el Tercer Lugar.
   - La pantalla de proyección despliega el podio con efectos visuales y fanfarria.

---

## 3. EVENTOS SOCKET.IO Y CONTRATOS

| Evento | Emisor | Receptor | Propósito |
|---|---|---|---|
| `join_participant` | Participante | Servidor | Registro nuevo o reconexión transparente con token |
| `lobby_updated` | Servidor | Sala | Actualización de lista y contador de participantes |
| `organizer_start_tournament` | Organizador | Servidor | Cierre de lobby y armado del bracket |
| `tournament_started` | Servidor | Sala | Notificación de inicio de torneo y envío del bracket |
| `organizer_start_match` | Organizador | Servidor | Selección e inicio de un match específico |
| `match_started` | Servidor | Sala | Apertura de la arena de duelo en participantes y proyección |
| `organizer_launch_question` | Organizador | Servidor | Lanzamiento de pregunta seleccionada |
| `question_started` | Servidor | Sala | Emisión de la pregunta sanitizada (sin respuestas correctas) |
| `submit_answer` | Participante | Servidor | Envío de respuesta con validación de identidad y tiempo |
| `answer_acknowledged` | Servidor | Sala | Notificación de recepción de respuesta (anti-leakage) |
| `organizer_close_question` | Organizador | Servidor | Cierre anticipado o fin de tiempo |
| `question_closed` | Servidor | Sala | Bloqueo de opciones en clientes |
| `organizer_reveal_answer` | Organizador | Servidor | Revelación autoritativa |
| `question_revealed` | Servidor | Sala | Difusión de respuesta correcta, puntos y explicación |
| `organizer_next_match` | Organizador | Servidor | Avance de pregunta o del bracket |
| `duel_result` | Servidor | Sala | Notificación de ganador y actualización del bracket |
| `organizer_finish_tournament` | Organizador | Servidor | Cierre oficial del torneo |
| `tournament_finished` | Servidor | Sala | Proclamación del podio (1°, 2° y 3° puesto) |

---

## 4. PERSISTENCIA Y RECONEXIÓN

- **Persistencia Dual:** Las operaciones críticas se ejecutan en memoria (baja latencia) y se reflejan asíncronamente en PostgreSQL (`tournaments`, `tournament_matches`, `match_questions`, `participant_answers`, `tournament_results`).
- **Reconexión Transparente:** Si un participante recarga su celular o pierde señal temporalmente, al reconectar con su `rawToken`, el servidor restaura su sesión y le envía el estado actual (si hay una pregunta activa, la reanuda con el tiempo restante exacto del servidor y respeta si ya había enviado respuesta).
- **Proyección Resiliente:** Si la pantalla de proyección se recarga en medio de un torneo, `join_projection` le devuelve el estado completo del bracket o la pregunta en curso sin interrumpir el juego.

---

## 5. GUÍA DE INSTALACIÓN Y EJECUCIÓN LOCAL

### Requisitos:
- Node.js 18+ instalado.
- PostgreSQL opcional (el sistema opera con fallback en memoria si no hay base de datos conectada).

### Pasos:
```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno (crear .env a partir de .env.example)
# ADMIN_SECRET=tu_clave_secreta

# 3. Inicializar base de datos (si se usa PostgreSQL)
npm run db:init

# 4. Iniciar servidor
npm start
```

### URLs Locales:
- **Juego Original Intacto:** `http://localhost:3000/original`
- **Participante (Móvil):** `http://localhost:3000/jugar`
- **Pantalla de Proyección:** `http://localhost:3000/proyeccion`
- **Panel del Organizador:** `http://localhost:3000/organizador`
- **Healthcheck:** `http://localhost:3000/api/health`

### Ejecución de Pruebas:
```bash
# Ejecutar toda la batería (114 pruebas)
npm test

# Ejecutar por grupos
npm run test:unit
npm run test:integration
npm run test:e2e
```
