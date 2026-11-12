# ==============================================================
# DOCKERFILE MULTI-STAGE: TORNEO DEL TALENTO (PRODUCCIÓN EASYPANEL)
# ==============================================================

# Etapa 1: Dependencias
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Etapa 2: Imagen Final de Producción
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Añadir curl para healthcheck
RUN apk add --no-cache curl

# Copiar dependencias de producción con propiedad explícita no-root
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./

# Copiar código fuente y assets con propiedad no-root
COPY --chown=node:node src ./src
COPY --chown=node:node Torneo_Talento.html ./Torneo_Talento.html

# Usar usuario no root por seguridad
USER node

# Exponer el puerto de escucha
EXPOSE 3000

# Healthcheck nativo para EasyPanel / Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/api/health || exit 1

# Comando de arranque
CMD ["node", "src/server.js"]

