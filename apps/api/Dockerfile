# ---- Builder ----
# bookworm-slim carries OpenSSL 3, which Prisma's migration engine expects.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
COPY src ./src
# Generate the Rust-free client, then compile.
RUN npx prisma generate
RUN npm run build

# ---- Runner ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
EXPOSE 3000
# Apply migrations, then boot. migrate deploy is a no-op when up to date.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
