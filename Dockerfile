# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim
# Run as UID 1000 to match the headless sync container's default PUID.
# This ensures both containers can read/write the shared vault volume.
RUN groupadd -g 1000 mcp && useradd -u 1000 -g mcp -m mcp
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json .
RUN chown -R mcp:mcp /app
USER mcp
EXPOSE 3456
CMD ["node", "dist/index.js"]
