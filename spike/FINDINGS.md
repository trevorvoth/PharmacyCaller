# PharmacyCaller Spike Findings

**Date:** 2026-01-18
**Status:** ARCHITECTURAL PIVOT - Twilio + OpenAI Realtime

## Executive Summary

**Original Plan:** Bland AI all-in-one solution
**Problem:** Warm Transfer (patient bridging) requires Bland AI ENTERPRISE account
**Decision:** Pivot to Full DIY with Twilio + OpenAI Realtime

## Critical Finding (Bland AI)

| Feature | Required For | Availability |
|---------|--------------|--------------|
| Outbound calls | Calling pharmacies | All plans |
| AI voice agent | IVR navigation | All plans |
| Custom prompts | Pharmacy scripts | All plans |
| Call webhooks | Status updates | All plans |
| **Warm Transfer** | **Patient bridging** | **Enterprise only** |

**Verdict:** Without Enterprise, we cannot bridge patients into ongoing calls.

## Architectural Pivot

### Selected Approach: Twilio + OpenAI Realtime (Full DIY)

```
                    PharmacyCaller Architecture (DIY)
                    ==================================

   +------------------+     +-------------------+     +----------------+
   |   Patient UI     |     |   PharmacyCaller  |     |   Pharmacies   |
   |   (WebRTC)       |<--->|   Server          |<--->|   (PSTN)       |
   +------------------+     +-------------------+     +----------------+
                                    |
                    +---------------+---------------+
                    |               |               |
              +-----v-----+   +-----v-----+   +-----v-----+
              |  Twilio   |   |  OpenAI   |   | Database  |
              | (Calls)   |   | Realtime  |   | (State)   |
              +-----------+   | (AI)      |   +-----------+
                              +-----------+
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **Twilio** | Outbound PSTN calls, conference rooms, call bridging |
| **OpenAI Realtime** | Voice AI for IVR navigation, hold monitoring |
| **WebSocket** | Stream audio between Twilio and OpenAI |
| **WebRTC** | Patient audio in browser |
| **Conference** | Bridge AI call + patient into same room |

### Why This Works

1. **Twilio Conference** - No enterprise tier required for conferencing
2. **OpenAI Realtime** - Voice-to-voice AI, handles IVR prompts
3. **Full Control** - We own the call flow, can customize everything
4. **Pay-per-use** - No monthly minimums, pay for what we use

### Cost Estimate (DIY)

| Service | Cost | Notes |
|---------|------|-------|
| Twilio outbound | ~$0.014/min | PSTN calls |
| Twilio conference | ~$0.0025/participant/min | Bridging |
| OpenAI Realtime | ~$0.06/min (audio) | AI processing |
| **Total per call** | **~$0.50-1.50** | Depends on hold time |

*Note: Hold time still dominates cost. 10 min hold = ~$0.80 for AI alone.*

## Verification Tests

### Test 1: Twilio Outbound Call (test-twilio-call.ts)

Verifies basic Twilio telephony works.

```bash
cd spike
npm install
cp .env.example .env
# Add your Twilio credentials
npm run test-twilio
```

**Expected Result:** Your phone rings, TwiML speaks, confirms audio works.

### Test 2: OpenAI Realtime (test-openai-realtime.ts)

Verifies OpenAI Realtime API connection and voice generation.

```bash
npm run test-openai
```

**Expected Result:** WebSocket connects, session created, audio generated.

### Test 3: Conference/Bridge (test-conference.ts)

**CRITICAL** - Verifies call bridging works.

```bash
# First, start ngrok for webhooks
ngrok http 3456

# Set WEBHOOK_BASE_URL in .env to your ngrok URL
# Optionally set TRANSFER_PHONE_NUMBER for full test

npm run test-conference
```

**Expected Result:**
- Conference room created
- Your phone rings and joins conference
- (If configured) Second phone joins same conference
- Both parties can speak

## Environment Setup

Create `.env` file:

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxx
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

# OpenAI Configuration
OPENAI_API_KEY=sk-xxxxxxxxxx

# Test phone number
TEST_PHONE_NUMBER=+1XXXXXXXXXX

# Optional: Second phone for conference testing
TRANSFER_PHONE_NUMBER=+1XXXXXXXXXX

# Server Configuration (for webhook testing)
WEBHOOK_BASE_URL=https://xxxx.ngrok.io
```

## Gate Decision

| Test Result | Decision |
|-------------|----------|
| All 3 tests pass | Proceed to Batch 1 with Twilio+OpenAI architecture |
| Twilio works, OpenAI fails | Check API key/access, may need waitlist |
| Conference fails | Debug Twilio config, critical blocker |
| All fail | Re-evaluate approach |

---

## Test Results (TO BE FILLED IN)

### Test 1: Twilio Outbound Call
- **Date:**
- **Result:**
- **Call SID:**
- **Audio Quality:**
- **Notes:**

### Test 2: OpenAI Realtime
- **Date:**
- **Result:**
- **Session Created:**
- **Audio Generated:**
- **Notes:**

### Test 3: Conference/Bridge
- **Date:**
- **Result:**
- **Conference SID:**
- **Bridge Successful:**
- **Notes:**

### Gate Verdict
- **Proceed to Batch 1:** YES / NO
- **Architecture:** Twilio + OpenAI Realtime
- **Reason:**
- **Blockers (if any):**

---

## Architecture Details for Implementation

### Call Flow (Simplified)

```
1. User requests calls to 3 pharmacies
2. Server creates 3 Twilio calls in parallel
3. Each call streams audio to OpenAI Realtime via WebSocket
4. OpenAI AI navigates IVR, waits on hold
5. When human detected, AI says "Please hold"
6. Server notifies patient UI via WebSocket
7. Patient clicks "Join"
8. Patient WebRTC audio -> Twilio Conference
9. AI call moved to same Conference
10. AI drops out, patient + pharmacist talk
```

### Key Technical Decisions

1. **Audio Streaming:** Twilio Media Streams -> WebSocket -> OpenAI Realtime
2. **Human Detection:** OpenAI AI trained to recognize human greetings vs IVR
3. **Conference Bridge:** Twilio Conference room with 2 participants
4. **Patient Audio:** WebRTC in browser via Twilio Client SDK
5. **State Machine:** CREATED -> DIALING -> IVR -> HOLD -> HUMAN_DETECTED -> BRIDGING -> CONNECTED -> ENDED

### Dependencies for Implementation

```json
{
  "twilio": "^5.0.0",
  "openai": "^4.28.0",
  "ws": "^8.16.0",
  "@twilio/voice-sdk": "^2.0.0"
}
```
