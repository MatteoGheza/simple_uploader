# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
# Enable pnpm
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
COPY . .
RUN pnpm run build

# Stage 2: Production
FROM node:22-slim AS runner
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/views ./dist/views

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server.js"]
