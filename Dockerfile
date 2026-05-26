# eBeeControl - Autonomous Deception Engine for Kubernetes
# Multi-stage build for minimal production image

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Add non-root user for security
RUN addgroup -S ebeecontrol && adduser -S ebeecontrol -G ebeecontrol

# Copy package files and install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R ebeecontrol:ebeecontrol /app

# Switch to non-root user
USER ebeecontrol

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

# Expose health check port (if needed)
EXPOSE 8080

# Start the agent
CMD ["node", "dist/index.js"]
