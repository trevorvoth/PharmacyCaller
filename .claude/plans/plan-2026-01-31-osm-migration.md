# Plan: Replace Google Places API with OpenStreetMap

## Overview

This plan outlines the migration from Google Places API to OpenStreetMap (OSM) for pharmacy search functionality. OSM is a free, open-source alternative that eliminates API costs while providing similar functionality.

## Current State Analysis

### Google Places API Usage

| Component | File | Purpose |
|-----------|------|---------|
| `googlePlacesService` | `src/services/googlePlaces.ts` | Low-level API calls |
| `pharmacySearchService` | `src/services/pharmacySearch.ts` | High-level search orchestration |
| `pharmacies` route | `src/routes/pharmacies.ts` | API endpoint |
| `searches` route | `src/routes/searches.ts` | Search creation endpoint |
| Config | `src/config/google.ts` | API key & endpoints |
| Environment | `src/config/env.ts` | GOOGLE_PLACES_API_KEY |

### Data Currently Retrieved from Google Places

```typescript
{
  id: string;                    // Google Place ID
  displayName: string;           // Pharmacy name
  formattedAddress: string;      // Full address
  nationalPhoneNumber?: string;  // Phone number
  location: { latitude, longitude };
  types: string[];               // Includes 'pharmacy'
  openNow?: boolean;             // Current open status
}
```

---

## OpenStreetMap Architecture

### API Options

| API | Purpose | Rate Limits | Best For |
|-----|---------|-------------|----------|
| **Overpass API** | Query POIs by type/area | 10,000 requests/day (public) | Pharmacy search by radius |
| **Nominatim** | Geocoding/reverse geocoding | 1 request/second | Address lookup |
| **Photon** | Fast geocoding | Higher limits | Alternative geocoder |

**Recommendation**: Use **Overpass API** for pharmacy searches (queries POIs directly) with optional self-hosting for production scale.

### OSM Pharmacy Data Structure

OSM uses tags to categorize places. Pharmacies are tagged as:
```
amenity=pharmacy
```

Available fields in OSM:
- `name` - Pharmacy name
- `addr:street`, `addr:city`, `addr:postcode` - Address components
- `phone` - Phone number (often missing)
- `opening_hours` - Hours in OSM format (requires parsing)
- `brand` / `operator` - Chain identification
- `lat`, `lon` - Coordinates

---

## Migration Plan

### Phase 1: Create OSM Service Layer

**New File**: `src/services/openStreetMap.ts`

```typescript
export interface OSMPharmacy {
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  name: string;
  address: string;
  phone?: string;
  latitude: number;
  longitude: number;
  brand?: string;
  openingHours?: string;
}

export interface OSMSearchRequest {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit?: number;
}

export const osmService = {
  searchPharmaciesNearby(request: OSMSearchRequest): Promise<OSMPharmacy[]>,
  parseOpeningHours(osmHours: string): { openNow: boolean },
};
```

**Overpass Query Example**:
```
[out:json][timeout:25];
(
  node["amenity"="pharmacy"](around:8047,40.7128,-74.0060);
  way["amenity"="pharmacy"](around:8047,40.7128,-74.0060);
);
out body;
>;
out skel qt;
```

### Phase 2: Update Data Types

**File**: `src/types/pharmacy.ts` (new or update existing)

```typescript
// Change from Google Place ID to OSM ID format
export type PharmacyId = `osm:${'node' | 'way' | 'relation'}:${number}`;

export interface PharmacyResult {
  id: PharmacyId;              // e.g., "osm:node:12345678"
  name: string;
  address: string;
  phone: string | null;
  phoneSource: 'osm' | 'nppes' | null;
  latitude: number;
  longitude: number;
  chain: PharmacyChain | null;
  distance?: number;
  openNow?: boolean;
}
```

### Phase 3: Adapt pharmacySearchService

**File**: `src/services/pharmacySearch.ts`

Changes needed:
1. Replace `googlePlacesService` calls with `osmService` calls
2. Implement custom pagination (OSM returns all results at once)
3. Parse OSM opening hours format
4. Handle address assembly from OSM components
5. Keep NPPES phone enrichment (OSM phone data is sparse)

```typescript
// Before
import { googlePlacesService } from './googlePlaces';

// After
import { osmService } from './openStreetMap';
```

### Phase 4: Opening Hours Parsing

OSM uses a specific format for opening hours that needs parsing:
```
Mo-Fr 09:00-21:00; Sa 09:00-18:00; Su 10:00-17:00
```

**Options**:
1. Use `opening_hours` npm package (parses OSM format)
2. Implement simple regex parser for common patterns
3. Skip `openNow` filtering if too complex

**Recommendation**: Use the `opening_hours` package:
```bash
npm install opening_hours
```

### Phase 5: Chain Detection Enhancement

OSM has `brand` and `operator` tags that can directly identify chains:

```typescript
// OSM tags to check
const brandTag = element.tags?.brand || element.tags?.operator;

// Map OSM brand names to our chain enum
const OSM_BRAND_MAP: Record<string, PharmacyChain> = {
  'CVS Pharmacy': 'CVS',
  'CVS': 'CVS',
  'Walgreens': 'WALGREENS',
  'Rite Aid': 'RITE_AID',
  'Walmart': 'WALMART',
  // ... etc
};
```

### Phase 6: Database Schema Update

**File**: `prisma/schema.prisma`

```prisma
model PharmacyResult {
  id            String              @id
  searchId      String
  pharmacyName  String
  address       String
  phone         String?
  phoneSource   PhoneSource?        // Add OSM as option
  latitude      Float
  longitude     Float
  osmId         String?             // NEW: "node:12345678"
  placeId       String?             // DEPRECATED: Keep for migration
  chain         PharmacyChain?
  callStatus    PharmacyCallStatus
  hasMedication Boolean?
}

enum PhoneSource {
  GOOGLE   // DEPRECATED
  OSM      // NEW
  NPPES
}
```

### Phase 7: Remove Google Dependencies

**Files to modify**:
- `src/config/google.ts` - Delete file
- `src/config/env.ts` - Remove `GOOGLE_PLACES_API_KEY`
- `src/services/googlePlaces.ts` - Delete file
- `.env.example` - Remove `GOOGLE_PLACES_API_KEY`

**Files to update**:
- `src/routes/pharmacies.ts` - Use new service
- `src/routes/searches.ts` - Use new service

### Phase 8: Self-Hosting Consideration (Production)

For production with high traffic, consider self-hosting Overpass:

**Docker Option**:
```yaml
# docker-compose.yml addition
overpass:
  image: wiktorn/overpass-api
  volumes:
    - ./overpass-data:/db
  environment:
    OVERPASS_META: "yes"
    OVERPASS_MODE: "clone"
    OVERPASS_PLANET_URL: "https://download.geofabrik.de/north-america-latest.osm.pbf"
```

**Benefits**:
- No rate limits
- Faster responses
- Full control over data updates

---

## Implementation Tasks

### Backend Changes

| # | Task | File(s) | Priority |
|---|------|---------|----------|
| 1 | Create OSM service with Overpass queries | `src/services/openStreetMap.ts` | High |
| 2 | Add opening hours parsing | `src/services/openStreetMap.ts` | Medium |
| 3 | Create address assembly from OSM tags | `src/services/openStreetMap.ts` | High |
| 4 | Update pharmacySearchService to use OSM | `src/services/pharmacySearch.ts` | High |
| 5 | Add OSM brand-to-chain mapping | `src/services/pharmacySearch.ts` | Medium |
| 6 | Update database schema | `prisma/schema.prisma` | High |
| 7 | Create migration script | `prisma/migrations/` | High |
| 8 | Update routes to use new types | `src/routes/pharmacies.ts`, `searches.ts` | High |
| 9 | Remove Google Places dependencies | Multiple files | High |
| 10 | Add OSM attribution (required by license) | Frontend | Medium |

### Frontend Changes

| # | Task | File(s) | Priority |
|---|------|---------|----------|
| 1 | Update API types for OSM ID format | `web/src/services/api.ts` | High |
| 2 | Update phone source badge | `web/src/components/PharmacyCard.tsx` | Low |
| 3 | Add OSM attribution to map/search | `web/src/pages/SearchPage.tsx` | Medium |

### Configuration Changes

| # | Task | File(s) | Priority |
|---|------|---------|----------|
| 1 | Add OSM config (Overpass endpoint) | `src/config/osm.ts` | High |
| 2 | Remove Google config | `src/config/google.ts`, `env.ts` | High |
| 3 | Update .env.example | `.env.example` | High |
| 4 | Update docker-compose for self-hosting | `docker-compose.yml` | Low |

---

## Data Quality Considerations

### Advantages of OSM
- **Free** - No API costs
- **Open data** - Full control, can self-host
- **Community maintained** - Active updates
- **Brand tags** - Direct chain identification

### Disadvantages vs Google Places
- **Phone numbers** - Less complete (NPPES enrichment mitigates)
- **Opening hours** - Requires parsing complex format
- **Address format** - Components need assembly
- **Rate limits** - Public Overpass has limits (self-host for production)

### Mitigation Strategies

1. **Phone Number Gap**: Continue using NPPES enrichment (already implemented)
2. **Opening Hours**: Use `opening_hours` npm package for parsing
3. **Address Assembly**: Build address from components:
   ```typescript
   const address = [
     tags['addr:housenumber'],
     tags['addr:street'],
     tags['addr:city'],
     tags['addr:state'],
     tags['addr:postcode']
   ].filter(Boolean).join(', ');
   ```

---

## Licensing Requirements

OSM data is under **Open Database License (ODbL)**. Requirements:

1. **Attribution**: Must credit OpenStreetMap
   ```html
   Data © OpenStreetMap contributors
   ```

2. **Share-Alike**: If you distribute derived databases, use same license

3. **No additional restrictions**: Cannot add DRM or legal terms that restrict ODbL rights

**Implementation**: Add attribution footer to search results and map views.

---

## Testing Strategy

### Unit Tests
- OSM service Overpass query building
- Opening hours parsing
- Address assembly
- Chain detection from brand tags

### Integration Tests
- End-to-end pharmacy search with OSM
- NPPES enrichment with OSM data
- Pagination handling

### Manual Testing
- Compare results quality vs Google Places
- Verify phone number coverage
- Test chain filtering accuracy

---

## Rollback Plan

1. Keep Google Places code in a feature branch
2. Use feature flag during transition:
   ```typescript
   const PHARMACY_PROVIDER = process.env.PHARMACY_PROVIDER || 'osm';
   ```
3. Database can store both `placeId` and `osmId` during transition
4. If issues found, switch flag back to 'google'

---

## Timeline Estimate

| Phase | Tasks | Effort |
|-------|-------|--------|
| Phase 1-2 | OSM service + types | ~4 hours |
| Phase 3-4 | Search service + opening hours | ~3 hours |
| Phase 5-6 | Chain mapping + DB schema | ~2 hours |
| Phase 7-8 | Cleanup + routes | ~2 hours |
| Phase 9 | Frontend updates + attribution | ~1 hour |
| Testing | Unit + integration + manual | ~3 hours |
| **Total** | | **~15 hours** |

---

## Questions to Resolve Before Implementation

1. **Self-hosting**: Should we self-host Overpass for production, or use public API with caching?
2. **Opening hours**: Is `openNow` filtering critical? If not, can simplify by skipping it.
3. **Phone priority**: Keep NPPES as primary phone source, or try OSM first?
4. **Feature flag**: Implement gradual rollout, or direct replacement?
