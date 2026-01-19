# PharmacyCaller Deployment Guide

## Prerequisites

- Docker and Docker Compose v2.x
- Node.js 20+ (for local development)
- PostgreSQL 16+ (or use Docker)
- Redis 7+ (or use Docker)

## Quick Start with Docker

### 1. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

- **Required:** `JWT_SECRET` (generate with `openssl rand -base64 32`)
- **Required:** Twilio credentials (Account SID, Auth Token, Phone Number, API Key, TwiML App SID)
- **Required:** `OPENAI_API_KEY`
- **Required:** `GOOGLE_PLACES_API_KEY`

### 2. Start Services

```bash
# Build and start all services
./scripts/docker-up.sh
```

This will:
1. Start PostgreSQL and Redis
2. Run database migrations
3. Start the backend API
4. Start the frontend (nginx)

### 3. Access the Application

- **Frontend:** http://localhost:80
- **Backend API:** http://localhost:3000
- **Health Check:** http://localhost:3000/health

### 4. View Logs

```bash
docker-compose logs -f
```

### 5. Stop Services

```bash
./scripts/docker-down.sh
```

## Local Development

### 1. Start Dependencies

```bash
docker-compose up -d postgres redis
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env - use the local development DATABASE_URL and REDIS_URL (ports 5433 and 6380)
```

### 3. Install and Build

```bash
# Backend
npm install
npm run db:generate
npm run db:migrate

# Frontend
cd web
npm install
```

### 4. Run Development Servers

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
cd web
npm run dev
```

## Production Build (without Docker)

```bash
./scripts/build.sh
```

This creates:
- `dist/` - Compiled backend
- `web/dist/` - Built frontend (serve with nginx or similar)

## Database Migrations

### With Docker

```bash
docker-compose --profile migrate up migrate
```

### Without Docker

```bash
./scripts/migrate.sh
# or
npx prisma migrate deploy
```

## External Services Setup

### Twilio

1. Create a Twilio account at https://www.twilio.com
2. Get your Account SID and Auth Token from the Console
3. Buy a phone number with Voice capability
4. Create an API Key at Console > Account > API Keys
5. Create a TwiML App at Console > Voice > TwiML Apps
   - Set the Voice Request URL to `https://your-domain.com/webhooks/twilio/voice`
   - Set the Status Callback URL to `https://your-domain.com/webhooks/twilio/status`

### OpenAI

1. Create an account at https://platform.openai.com
2. Generate an API key at https://platform.openai.com/api-keys

### Google Places

1. Go to https://console.cloud.google.com
2. Create a project (or select existing)
3. Enable the Places API
4. Create an API key at APIs & Services > Credentials

## Environment Variables Reference

See `.env.example` for all variables with descriptions.

### Required Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret for JWT token signing |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |
| `TWILIO_API_KEY_SID` | Twilio API Key SID |
| `TWILIO_API_KEY_SECRET` | Twilio API Key Secret |
| `TWILIO_TWIML_APP_SID` | Twilio TwiML App SID |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_PLACES_API_KEY` | Google Places API key |

## Health Checks

The backend provides a `/health` endpoint that returns:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "database": "up",
    "redis": "up"
  }
}
```

Docker containers use this for health checks.

## Troubleshooting

### Database connection failed

1. Check `DATABASE_URL` format: `postgresql://user:pass@host:port/dbname`
2. Ensure PostgreSQL is running: `docker-compose ps postgres`
3. Check logs: `docker-compose logs postgres`

### Redis connection failed

1. Check `REDIS_URL` format: `redis://host:port`
2. Ensure Redis is running: `docker-compose ps redis`
3. Check logs: `docker-compose logs redis`

### Twilio calls not working

1. Verify all Twilio credentials are correct
2. Check TwiML App webhook URLs are publicly accessible
3. For local development, use ngrok: `ngrok http 3000`

### Frontend not loading

1. Check nginx logs: `docker-compose logs frontend`
2. Verify backend is healthy: `curl http://localhost:3000/health`
3. Check browser console for errors

## Scaling

For production with higher load:

1. Use managed PostgreSQL (AWS RDS, Google Cloud SQL, etc.)
2. Use managed Redis (AWS ElastiCache, Redis Cloud, etc.)
3. Run multiple backend instances behind a load balancer
4. Use a CDN for frontend static assets
