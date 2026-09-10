# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /usr/src/app
ENV NODE_ENV=production

# Install production dependencies with a reproducible lockfile.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source.
COPY src ./src
COPY public ./public

# Run as a non-root user (node image ships an unprivileged `node` user).
USER node

EXPOSE 5000

# Lightweight liveness probe against the health endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
