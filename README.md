# Torneo del Talento — Plataforma Multijugador en Tiempo Real

> **Estado actual:** Backend base implementado (Fase 1). Frontend multijugador pendiente de desarrollo (Fase 2+).
> Este proyecto **no está listo para producción** hasta completar las fases siguientes y superar pruebas de integración reales.

---

## Descripción

**Torneo del Talento** es una plataforma web multijugador en tiempo real, diseñada para competencias académicas y de conocimiento entre equipos. Funciona con un sistema de eliminación directa por enfrentamientos uno contra uno (duelos), inspirado en la experiencia de participación de Kahoot pero con lógica de torneo por brackets.

La plataforma gestiona registro de participantes, generación automática del cuadro de eliminación, presentación de preguntas con cronómetro autoritativo de servidor, puntuación por velocidad y acierto, gestión de desconexiones con periodo de gracia, y un podio de ganadores.

---

## Tecnologías utilizadas

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Servidor HTTP | Node.js + Express | Node ≥ 20, Express ^4.19 |
| Tiempo real | Socket.IO | ^4.7.5 |
| Base de datos | PostgreSQL | ≥ 16 |
| Cliente PostgreSQL | pg (node-postgres) | ^8.11.5 |
| Seguridad HTTP | Helmet | ^7.1.0 |
| CORS | cors | ^2.8.5 |
| Código QR | qrcode | ^1.5.3 |
| Variables de entorno | dotenv | ^16.4.5 |
| Contenerización | Docker + Docker Compose | — |

---

## Arquitectura general

```
┌─────────────────────────────────────────────────────────┐
│  Clientes (Participantes · Organizador · Proyección)     │
│  Conexión vía Socket.IO (WebSockets) + HTTP              │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  Servidor Node.js / Express                              │
│  ├── HTTP API REST  (/api/*)                             │
│  ├── Vistas HTML    (/original, /jugar, /proyeccion)     │
│  └── Socket.IO Server                                    │
│       ├── Autenticación de roles (socket.data)           │
│       ├── Eventos de participantes                       │
│       └── Eventos de organizador                        │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  Motor del Torneo (en memoria + PostgreSQL)              │
│  ├── tournamentState.js  (estado activo, rehidratación)  │
│  ├── bracket.js          (cuadro de eliminación)         │
│  ├── scoring.js          (puntuación autoritativa)       │
│  └── questionService.js  (preguntas, sanitización)       │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  PostgreSQL — Fuente de verdad del estado del torneo     │
│  (torneos, participantes, matches, respuestas, eventos)  │
└─────────────────────────────────────────────────────────┘
```

**Principio de persistencia:** PostgreSQL es la fuente de verdad. La memoria de Node.js actúa como caché de alta velocidad. Al reiniciar el contenedor, `hydrateActiveRoomsFromDB()` reconstruye el estado completo sin pérdida de datos.

---

## Estructura de carpetas

```
.
├── src/
│   ├── app.js                  # Express: middlewares, CORS, Helmet, rutas
│   ├── server.js               # Punto de entrada: HTTP + Socket.IO + arranque
│   ├── config/
│   │   ├── database.js         # Pool de conexiones PostgreSQL (pg)
│   │   └── env.js              # Variables de entorno validadas
│   ├── db/
│   │   ├── init.js             # Aplica schema.sql en PostgreSQL al arrancar
│   │   └── schema.sql          # DDL completo: tablas, índices, FKs, trigger
│   ├── engine/
│   │   ├── bracket.js          # Generación del cuadro de eliminación + BYEs
│   │   ├── scoring.js          # Cálculo autoritativo de puntuación por velocidad
│   │   └── tournamentState.js  # Estado activo, registro, reconexión, rehidratación
│   ├── questions/
│   │   ├── staticBank.js       # 72 preguntas estáticas (mc, vf, ord, num)
│   │   ├── mathGenerators.js   # 5 generadores procedimentales de cálculo
│   │   └── questionService.js  # Selección, preparación y sanitización de preguntas
│   ├── routes/
│   │   ├── apiRoutes.js        # REST: /api/health, /api/tournament/create, /api/tournament/:code/qr
│   │   └── viewRoutes.js       # Vistas: /original, /jugar, /proyeccion
│   ├── security/
│   │   ├── tokens.js           # Generación y verificación de tokens (SHA-256, timingSafeEqual)
│   │   └── sanitizer.js        # Sanitización XSS de nombres y texto libre
│   └── socket/
│       └── socketServer.js     # Eventos Socket.IO: join, auth, start, submit_answer, disconnect
├── tests/
│   ├── phase1.test.js          # 22 pruebas: tokens, preguntas, scoring, bracket, HTTP
│   ├── phase1_1.test.js        # 12 pruebas: aislamiento, reconexión, schema SQL, política de reinicio
│   └── phase1_2.test.js        # 18 pruebas: A-01 a A-04 (correcciones de hallazgos)
├── .dockerignore
├── .env.example                # Plantilla de variables de entorno (sin secretos reales)
├── .gitignore
├── docker-compose.test.yml     # Entorno Docker con PostgreSQL real para pruebas de integración
├── Dockerfile                  # Imagen multi-stage para EasyPanel / VPS
├── package.json
├── package-lock.json
└── Torneo_Talento.html         # Aplicación original de referencia (preservada intacta)
```

---

## Requisitos de instalación

### Locales (desarrollo sin Docker)

- **Node.js** ≥ 20.x ([descargar](https://nodejs.org/))
- **npm** ≥ 10.x (incluido con Node.js)
- **PostgreSQL** ≥ 16.x ([descargar](https://www.postgresql.org/download/)) — opcional en desarrollo (el servidor opera en modo memoria si no hay BD)

### Con Docker

- **Docker** ≥ 24.x + **Docker Compose** ≥ 2.x

---

## Configuración de variables de entorno

Copiar el archivo de ejemplo y completarlo:

```bash
cp .env.example .env
```

Editar `.env` con los valores reales:

```dotenv
# Entorno: development | production | test
NODE_ENV=development

# Puerto HTTP del servidor Express
PORT=3000

# URL pública del sistema (crítico para los códigos QR)
# Desarrollo: http://localhost:3000
# Producción: https://torneo.tudominio.com
PUBLIC_URL=http://localhost:3000

# Cadena de conexión a PostgreSQL
# Formato: postgresql://usuario:contraseña@host:puerto/base_de_datos
DATABASE_URL=postgresql://postgres:micontraseña@localhost:5432/torneo_talento

# Secreto administrativo del organizador
# OBLIGATORIO en producción. Debe ser un valor aleatorio largo y único.
# Ejemplo de generación: openssl rand -hex 32
ADMIN_SECRET=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO

# Tolerancia de red (ms de gracia tras expirar el cronómetro)
LATENCY_GRACE_PERIOD_MS=800

# Orígenes CORS permitidos (usar dominio específico en producción, no *)
CORS_ORIGIN=*
```

> **Importante:** El archivo `.env` está excluido por `.gitignore` y nunca debe subirse al repositorio.

> **Generación de un secreto seguro:**
> ```bash
> # En Linux/macOS:
> openssl rand -hex 32
> # En Node.js:
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## Cómo ejecutar PostgreSQL

### Opción A — PostgreSQL local

Crear la base de datos manualmente:

```sql
CREATE DATABASE torneo_talento;
```

Luego configurar `DATABASE_URL` en `.env`.

### Opción B — PostgreSQL con Docker (solo la BD)

```bash
docker run --name torneo-pg \
  -e POSTGRES_DB=torneo_talento \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=micontraseña \
  -p 5432:5432 \
  -d postgres:16-alpine
```

---

## Cómo inicializar el esquema de base de datos

Una vez que PostgreSQL esté en ejecución y `DATABASE_URL` esté configurado:

```bash
npm run db:init
```

Este comando aplica `src/db/schema.sql` en la base de datos: crea tablas, índices, claves foráneas compuestas y el trigger de integridad. Es idempotente (puede ejecutarse múltiples veces sin romper nada).

---

## Cómo ejecutar el servidor

### Desarrollo (con recarga automática)

```bash
npm run dev
```

### Producción (manual)

```bash
npm start
```

El servidor estará disponible en `http://localhost:3000` (o el puerto configurado en `.env`).

**Rutas disponibles actualmente:**

| Ruta | Descripción |
|------|-------------|
| `GET /api/health` | Healthcheck: estado del servidor, BD y preguntas cargadas |
| `POST /api/tournament/create` | Crear un nuevo torneo (devuelve código y QR) |
| `GET /api/tournament/:code/qr` | Obtener código QR de un torneo |
| `GET /original` | Archivo original `Torneo_Talento.html` (referencia) |
| `GET /jugar` | Vista del participante *(frontend pendiente — Fase 2)* |
| `GET /proyeccion` | Vista de proyección *(frontend pendiente — Fase 2)* |

---

## Cómo ejecutar las pruebas

```bash
npm test
```

Ejecuta las tres baterías de pruebas en secuencia:

```
Fase 1:   22 pruebas — tokens, preguntas, scoring, bracket, HTTP
Fase 1.1: 12 pruebas — aislamiento, reconexión, schema SQL, política de reinicio
Fase 1.2: 18 pruebas — correcciones A-01 a A-04
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total:    52 pruebas (todas en modo mock/memoria)
```

> **Nota importante sobre las pruebas actuales:**
> Las 52 pruebas actuales cubren lógica de negocio con mocks en memoria. **Ninguna prueba corre contra PostgreSQL real ni contra WebSockets reales.** No sustituyen las pruebas de integración completas. Para pruebas de integración real, usar `docker-compose.test.yml` (requiere Docker).

---

## Cómo ejecutar con Docker

### Pruebas de integración con PostgreSQL real

Requiere Docker y Docker Compose instalados:

```bash
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit
```

Esto levanta PostgreSQL 16 en memoria temporal y ejecuta la suite completa de pruebas contra una base de datos real.

### Imagen de producción (EasyPanel / VPS)

El `Dockerfile` incluido es multi-stage y está preparado para EasyPanel:

```bash
# Construir la imagen
docker build -t torneo-del-talento .

# Ejecutar con variables de entorno
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://... \
  -e ADMIN_SECRET=tu_secreto_aleatorio \
  -e PUBLIC_URL=https://torneo.tudominio.com \
  torneo-del-talento
```

> **Requisito:** Configurar `ADMIN_SECRET` con un valor aleatorio antes de desplegar. El servidor no arranca en producción sin este valor.

---

## Eventos principales de Socket.IO

| Evento (cliente → servidor) | Descripción |
|-----------------------------|-------------|
| `join_participant` | Registrar o reconectar un participante en el lobby |
| `join_projection` | Conectarse como pantalla de proyección (solo lectura) |
| `auth_organizer` | Autenticar al organizador con `ADMIN_SECRET` |
| `organizer_start_tournament` | Iniciar el torneo (solo organizador autenticado) |
| `submit_answer` | Enviar respuesta a la pregunta activa (solo el competidor del duelo) |

| Evento (servidor → cliente) | Descripción |
|-----------------------------|-------------|
| `lobby_updated` | Lista de participantes conectados actualizada |
| `projection_state` | Estado completo del torneo para la pantalla de proyección |
| `tournament_started` | El torneo comenzó; incluye el cuadro de brackets |
| `answer_acknowledged` | Confirmación de que un jugador respondió (sin revelar la respuesta) |
| `duel_player_disconnected` | Un competidor del duelo activo se desconectó temporalmente |
| `duel_both_disconnected` | Ambos competidores desconectados — periodo de gracia iniciado |
| `duel_grace_expired` | Periodo de gracia agotado; el duelo queda en pausa |

---

## Consideraciones de seguridad

- **Tokens de participantes:** Generados con `crypto.randomBytes(32)`. Solo se almacena el hash SHA-256 en PostgreSQL; el token crudo nunca persiste.
- **Secreto administrativo:** Comparado con `crypto.timingSafeEqual()` para mitigar ataques de temporización.
- **Respuestas correctas:** La función `sanitizeQuestionForClient()` elimina `correctAnswer` y `explanation` antes de enviar la pregunta al cliente.
- **Anti-spoofing:** El evento `submit_answer` valida que el `participantId` del payload coincida con el de la sesión Socket.IO (`socket.data.participantId`).
- **Aislamiento de torneos:** Un organizador autenticado en el Torneo A no puede controlar el Torneo B.
- **Rate limiting Socket.IO:** Máximo 10 eventos por segundo por socket.
- **Helmet:** Cabeceras de seguridad HTTP activas (CSP desactivado temporalmente hasta implementar el frontend).
- **Usuario no-root en Docker:** El contenedor corre como usuario `node` (no como `root`).

---

## Banco de preguntas

| Tipo | Cantidad | Descripción |
|------|----------|-------------|
| Opción múltiple (`mc`) | ~40 | 4 opciones, una correcta |
| Verdadero o falso (`vf`) | ~18 | Respuesta booleana |
| Ordenamiento (`ord`) | ~8 | Ordenar una lista de elementos |
| Cálculo numérico (`num`) | ~6 + generadores | Respuesta numérica con tolerancia |
| **Generadores matemáticos** | **5** | Producción procedimental ilimitada de preguntas de cálculo |
| **Total estáticas** | **72** | Verificadas y migradas del archivo original |

---

## Estado actual del proyecto y funcionalidades pendientes

### ✅ Implementado (Fase 1)

- [x] Servidor Node.js / Express / Socket.IO funcional
- [x] Esquema PostgreSQL completo con integridad referencial compuesta y trigger PL/pgSQL
- [x] 72 preguntas estáticas migradas + 5 generadores matemáticos
- [x] Sistema de tokens criptográficos (SHA-256, timingSafeEqual)
- [x] Sanitización XSS y protección de respuestas correctas
- [x] Autenticación y autorización de organizador
- [x] Registro y reconexión de participantes
- [x] Generación del cuadro de eliminación (brackets con BYEs automáticos)
- [x] Cronómetro autoritativo de servidor
- [x] Scoring por velocidad y acierto
- [x] Política de gracia para desconexiones en duelo
- [x] Rehidratación de estado completo desde PostgreSQL tras reinicio
- [x] Healthcheck para Docker y EasyPanel
- [x] Generación de código QR por torneo
- [x] 52 pruebas de lógica de negocio (mocks)

### 🔲 Pendiente (Fase 2+)

- [ ] Frontend del participante (`/jugar`) — interfaz de lobby y duelo en tiempo real
- [ ] Frontend del organizador — panel de control del torneo
- [ ] Pantalla de proyección — vista en tiempo real del torneo
- [ ] Pruebas de integración real con PostgreSQL (usando `docker-compose.test.yml`)
- [ ] Pruebas E2E con WebSockets reales
- [ ] Content Security Policy (CSP) de Helmet configurado para el frontend
- [ ] Configuración de CORS restringida para producción
- [ ] Despliegue en VPS con EasyPanel

---

## Licencia

Por definir. El proyecto es de uso interno. No redistribuir sin autorización del autor.

