# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Builder Vite
# Build context : apps/web/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copier le manifeste en premier (cache Docker)
COPY package.json ./

# Installer toutes les dépendances (pas de lock file local dans le workspace monorepo)
RUN npm install

# Copier les sources et construire
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Copier la conf nginx personnalisée
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copier les fichiers statiques buildés
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/index.html | grep -q "root" || exit 1

CMD ["nginx", "-g", "daemon off;"]
