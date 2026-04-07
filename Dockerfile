# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim
RUN groupadd -r mcp && useradd -r -g mcp -m mcp
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json .
RUN chown -R mcp:mcp /app
USER mcp
EXPOSE 3456
CMD ["node", "dist/index.js"]
