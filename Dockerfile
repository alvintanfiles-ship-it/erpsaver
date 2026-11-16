# ParkERP Backend Dockerfile
FROM node:20-alpine AS base

# Install dependencies for PostGIS and native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    postgresql-dev

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

RUN apk add --no-cache postgresql-client

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=base /app/dist ./dist
COPY --from=base /app/schema.sql ./schema.sql
COPY --from=base /app/erp-data ./erp-data
COPY --from=base /app/erp_gantry_rates_2026-09-07.json ./erp_gantry_rates_2026-09-07.json
COPY --from=base /app/gantryZoneMap.json ./gantryZoneMap.json

EXPOSE 3000

CMD ["node", "dist/index.js"]