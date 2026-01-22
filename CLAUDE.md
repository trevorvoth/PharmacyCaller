# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PharmacyCaller is an AI-powered pharmacy calling system that automates medication availability checks. It places parallel calls to pharmacies, uses OpenAI's Realtime API to navigate IVR menus and wait on hold, then connects patients to a human pharmacist when one becomes available.

## Commands

### Backend (root directory)
```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run build        # TypeScript compile to dist/
npm run lint         # ESLint with type-checking
npm run lint:fix     # Auto-fix lint issues
npm test             # Run vitest in watch mode
npm run test:run     # Run tests once
```

### Database (Prisma)
```bash
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Create/run migrations
npm run db:studio    # Open Prisma Studio GUI
```

### Frontend (web/ directory)
```bash
cd web
npm run dev          # Vite dev server
npm run build        # Production build (tsc + vite)
npm run lint         # ESLint
```

### Docker
```bash
docker-compose up -d                           # Start all services
docker-compose --profile migrate up migrate    # Run migrations
```

## Architecture

### Real-Time Audio Pipeline

The core innovation is the audio bridge that connects Twilio phone calls to OpenAI's Realtime API:

1. **Call Orchestrator** (`src/services/callOrchestrator.ts`) - Manages parallel pharmacy calls (max 3 concurrent), tracks search state in Redis
2. **Audio Bridge** (`src/services/audioBridge.ts`) - Bidirectional audio streaming between Twilio media streams and OpenAI Realtime
3. **Call State Machine** (`src/services/callStateMachine.ts`) - Enforces valid state transitions: `CREATED → DIALING → IVR → HOLD → HUMAN_DETECTED → BRIDGING → CONNECTED → ENDED`

### Key State Transitions (`src/types/callStates.ts`)
- `IVR` - AI navigating phone menu
- `HOLD` - Successfully navigated, waiting for human
- `HUMAN_DETECTED` - Pharmacist answered (triggers patient notification)
- `BRIDGING` - Connecting patient to pharmacist

### Services Architecture

| Service | Purpose |
|---------|---------|
| `twilio/` | Call initiation, media streams, conference bridging |
| `openai/realtimeClient.ts` | WebSocket to OpenAI Realtime API for voice AI |
| `openai/ivrRouter.ts` | Chain-specific IVR navigation (CVS, Walgreens, Rite Aid) |
| `pharmacyTracker.ts` | Real-time call status aggregation |
| `notifications.ts` | WebSocket push to frontend |

### IVR Patterns

Chain-specific phone menu navigation configs in `src/config/ivrPatterns/`. Each defines expected prompts and required DTMF responses.

### WebSocket Events (`src/websocket/server.ts`)

- `pharmacist_ready` - Human detected, patient can connect
- `call_status_update` - Real-time call state changes
- `search_update` - Overall search progress

### Demo Mode

Set `DEMO_MODE=true` to simulate calls without Twilio. Uses `demoSimulator.ts` to walk through state transitions with randomized delays.

## Tech Stack

- **Backend**: Fastify, TypeScript, Prisma (PostgreSQL), Redis (call state), Socket.io
- **Frontend**: React, Vite, Tailwind CSS, Twilio Voice SDK (WebRTC)
- **External**: Twilio (telephony), OpenAI Realtime API (voice AI), Google Places (pharmacy search)

## Environment Variables

Required in `.env`:
- `DATABASE_URL`, `REDIS_URL` - Data stores
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` - Telephony
- `OPENAI_API_KEY` - Voice AI
- `GOOGLE_PLACES_API_KEY` - Pharmacy search
- `JWT_SECRET` - Auth (min 32 chars)

## ESLint Rules

Strict TypeScript checking enabled:
- `@typescript-eslint/no-floating-promises: error`
- `@typescript-eslint/no-explicit-any: error`
- Unused vars must be prefixed with `_`
