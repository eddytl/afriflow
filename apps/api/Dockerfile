# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Builder
# Build context doit être la racine du monorepo
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Outils natifs pour bcrypt (node-gyp)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copier les manifestes de tous les workspaces (couche cachée)
COPY package.json package-lock.json turbo.json ./
COPY packages/config/package.json          ./packages/config/package.json
COPY packages/db/package.json              ./packages/db/package.json
COPY packages/email/package.json           ./packages/email/package.json
COPY packages/ai/package.json              ./packages/ai/package.json
COPY packages/payments/package.json        ./packages/payments/package.json
COPY packages/sms/package.json             ./packages/sms/package.json
COPY apps/api/package.json                 ./apps/api/package.json

# Installer toutes les dépendances (crée les symlinks workspace)
RUN npm ci

# Copier les sources
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build des packages dans l'ordre des dépendances
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=packages/email
RUN npm run build --workspace=packages/ai
RUN npm run build --workspace=packages/payments
RUN npm run build --workspace=packages/sms
RUN npm run build --workspace=apps/api

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Production runner
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Outils natifs pour bcrypt
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copier les manifestes pour npm ci --omit=dev
COPY package.json package-lock.json turbo.json ./
COPY packages/config/package.json          ./packages/config/package.json
COPY packages/db/package.json              ./packages/db/package.json
COPY packages/email/package.json           ./packages/email/package.json
COPY packages/ai/package.json              ./packages/ai/package.json
COPY packages/payments/package.json        ./packages/payments/package.json
COPY packages/sms/package.json             ./packages/sms/package.json
COPY apps/api/package.json                 ./apps/api/package.json

# Installer uniquement les dépendances de production
RUN npm ci --omit=dev

# Copier les artefacts buildés depuis le stage builder
COPY --from=builder /app/packages/db/dist       ./packages/db/dist
COPY --from=builder /app/packages/email/dist     ./packages/email/dist
COPY --from=builder /app/packages/ai/dist        ./packages/ai/dist
COPY --from=builder /app/packages/payments/dist  ./packages/payments/dist
COPY --from=builder /app/packages/sms/dist       ./packages/sms/dist

# Les migrations SQL sont lues à l'exécution par createTenantSchema()
# import.meta.dirname dans dist/client.js → packages/db/dist/
COPY packages/db/src/migrations ./packages/db/dist/migrations/

# Le package config n'a pas de build step (expose des JSON/JS directement)
COPY packages/config ./packages/config/

# Copier l'API buildée
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Utilisateur non-root pour la sécurité
RUN addgroup -S afriflow && adduser -S afriflow -G afriflow
USER afriflow

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
