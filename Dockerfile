# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: Install dependencies
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS deps

# openssl is required by Prisma's query engine on Debian/slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# --legacy-peer-deps matches CI: resolves nodemailer@8 / next-auth@5 peer conflict
RUN npm ci --legacy-peer-deps

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: Build the Next.js application
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client against the correct Linux binary target
RUN npx prisma generate

# Build-time public env vars must be available during `next build`.
# These are passed as --build-arg from docker-compose and are safe to bake
# into the image (they are already public / publishable values).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_GEMINI_API_KEY

ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_GEMINI_API_KEY=${NEXT_PUBLIC_GEMINI_API_KEY}

ENV NODE_ENV=production

RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: Production runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Create a non-root system user; running as root inside containers is a
# security risk even with Docker network isolation.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy the full node_modules (needed for `next start` and `prisma migrate deploy`)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy the compiled application output
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts

# Prisma schema + migrations are required for `prisma migrate deploy` at startup
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Entrypoint: runs migrations then starts the Next.js server
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

# PORT is injected at runtime via docker-compose environment
EXPOSE 3001

ENTRYPOINT ["./docker-entrypoint.sh"]
