import { googlePlacesService, type PlaceResult } from './googlePlaces.js';
import { logger } from '../utils/logger.js';
import type { PharmacyChain } from '@prisma/client';

export interface PharmacySearchResult {
  id: string;
  name: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  chain: PharmacyChain | null;
  distance?: number; // meters
}

export interface PharmacySearchRequest {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  maxResults?: number;
}

// Chain detection patterns
const CHAIN_PATTERNS: Array<{ pattern: RegExp; chain: PharmacyChain }> = [
  { pattern: /\bcvs\b/i, chain: 'CVS' },
  { pattern: /\bwalgreens\b/i, chain: 'WALGREENS' },
  { pattern: /\brite\s*aid\b/i, chain: 'RITE_AID' },
  { pattern: /\bwalmart\b/i, chain: 'WALMART' },
  { pattern: /\bcostco\b/i, chain: 'COSTCO' },
  { pattern: /\bkroger\b/i, chain: 'KROGER' },
  { pattern: /\bpublix\b/i, chain: 'PUBLIX' },
  { pattern: /\bh-?e-?b\b/i, chain: 'HEB' },
  { pattern: /\bsafeway\b/i, chain: 'SAFEWAY' },
];

function detectChain(name: string): PharmacyChain | null {
  for (const { pattern, chain } of CHAIN_PATTERNS) {
    if (pattern.test(name)) {
      return chain;
    }
  }
  return null;
}

function formatPhoneNumber(place: PlaceResult): string {
  // Prefer national format, fall back to international
  let phone = place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? '';

  // Ensure US numbers start with +1
  if (phone && !phone.startsWith('+')) {
    // Remove any non-digit characters for processing
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      phone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      phone = `+${digits}`;
    }
  }

  return phone;
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  // Haversine formula
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

export const pharmacySearchService = {
  async searchNearby(request: PharmacySearchRequest): Promise<PharmacySearchResult[]> {
    const { latitude, longitude, radiusMeters, maxResults } = request;

    logger.info({
      latitude,
      longitude,
      radiusMeters,
      maxResults,
    }, 'Starting pharmacy search');

    const places = await googlePlacesService.searchPharmaciesNearby({
      latitude,
      longitude,
      radiusMeters,
      maxResults,
    });

    const results: PharmacySearchResult[] = places
      .map((place) => {
        const phone = formatPhoneNumber(place);

        // Skip places without a valid phone number
        if (!phone) {
          return null;
        }

        const distance = calculateDistance(
          latitude,
          longitude,
          place.location.latitude,
          place.location.longitude
        );

        return {
          id: place.id,
          name: place.displayName,
          address: place.formattedAddress,
          phone,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          chain: detectChain(place.displayName),
          distance: Math.round(distance),
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)); // Sort by distance

    logger.info({
      resultsCount: results.length,
      withKnownChains: results.filter((r) => r.chain !== null).length,
    }, 'Pharmacy search completed');

    return results;
  },
};
