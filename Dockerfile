# syntax=docker/dockerfile:1
# Imagen única: NestJS sirve la API + el frontend compilado. Postgres va aparte
# (docker-compose). Multi-stage para que la imagen final no cargue toolchain de build.

# ---- 1) Build del frontend (Vite) ----
FROM node:22-slim AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2) Build del backend (NestJS + Prisma) ----
FROM node:22-slim AS backend
WORKDIR /be
COPY backend-node/package*.json ./
RUN npm ci
COPY backend-node/ ./
RUN npx prisma generate && npm run build

# ---- 3) Runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SERVE_FRONTEND=true
ENV PORT=8000
# Prisma necesita openssl en runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# node_modules del backend (incluye @prisma/client generado + engines + CLI para migrar).
COPY --from=backend /be/node_modules ./node_modules
COPY --from=backend /be/dist ./dist
COPY --from=backend /be/prisma ./prisma
COPY --from=backend /be/package.json ./package.json
# Frontend compilado → se sirve desde /app/public (FRONTEND_DIR por defecto = ../public de dist).
COPY --from=frontend /fe/dist ./public
EXPOSE 8000
# Aplica migraciones y arranca. `migrate deploy` es idempotente.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
