# Backend Dockerfile
FROM node:20-alpine AS base

# Install dependencies for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
FROM base AS deps
RUN npm ci --only=production

# Build stage
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build
RUN npx prisma generate

# Production stage
FROM base AS production
ENV NODE_ENV=production

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy built application
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Copy package.json for scripts
COPY package*.json ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start command
CMD ["npm", "run", "start"]
