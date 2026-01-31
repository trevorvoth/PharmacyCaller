/**
 * Shared pharmacy search helper functions
 * Used by both Google Places and OpenStreetMap providers
 */

import type { PharmacyChain } from '@prisma/client';

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

// OSM brand names to chain mapping (common OSM brand tags)
const OSM_BRAND_MAP: Record<string, PharmacyChain> = {
  'CVS Pharmacy': 'CVS',
  'CVS': 'CVS',
  'Walgreens': 'WALGREENS',
  'Rite Aid': 'RITE_AID',
  'Walmart Pharmacy': 'WALMART',
  'Walmart': 'WALMART',
  'Costco Pharmacy': 'COSTCO',
  'Costco': 'COSTCO',
  'Kroger Pharmacy': 'KROGER',
  'Kroger': 'KROGER',
  'Publix Pharmacy': 'PUBLIX',
  'Publix': 'PUBLIX',
  'H-E-B Pharmacy': 'HEB',
  'H-E-B': 'HEB',
  'HEB': 'HEB',
  'Safeway Pharmacy': 'SAFEWAY',
  'Safeway': 'SAFEWAY',
};

/**
 * Detect pharmacy chain from name using regex patterns
 */
export function detectChain(name: string): PharmacyChain | null {
  for (const { pattern, chain } of CHAIN_PATTERNS) {
    if (pattern.test(name)) {
      return chain;
    }
  }
  return null;
}

/**
 * Detect pharmacy chain from OSM brand tag
 * Falls back to name-based detection if brand not found
 */
export function detectChainFromBrand(brand: string | undefined, name: string): PharmacyChain | null {
  if (brand && OSM_BRAND_MAP[brand]) {
    return OSM_BRAND_MAP[brand];
  }
  return detectChain(name);
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Extract city and state from a formatted address
 * Supports multiple address formats
 */
export function extractCityState(address: string): { city: string; state: string } {
  // US address pattern: City, STATE ZIP
  const usPattern = /,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}/;
  const match = address.match(usPattern);

  if (match) {
    return {
      city: match[1].trim(),
      state: match[2],
    };
  }

  // Fallback: try to extract from comma-separated parts
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 3) {
    // Assume format: Street, City, State ZIP, Country
    const stateZip = parts[2].split(' ');
    return {
      city: parts[1],
      state: stateZip[0] ?? '',
    };
  }

  return { city: '', state: '' };
}

/**
 * Assemble address from OSM address components
 */
export function assembleAddressFromOSM(tags: Record<string, string | undefined>): string {
  const parts: string[] = [];

  // House number and street
  const housenumber = tags['addr:housenumber'];
  const street = tags['addr:street'];
  if (housenumber && street) {
    parts.push(`${housenumber} ${street}`);
  } else if (street) {
    parts.push(street);
  }

  // City
  const city = tags['addr:city'];
  if (city) {
    parts.push(city);
  }

  // State and postal code
  const state = tags['addr:state'];
  const postcode = tags['addr:postcode'];
  if (state && postcode) {
    parts.push(`${state} ${postcode}`);
  } else if (state) {
    parts.push(state);
  } else if (postcode) {
    parts.push(postcode);
  }

  return parts.join(', ');
}

/**
 * Format phone number to E.164 format (+1XXXXXXXXXX)
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Return original if can't format
  return phone;
}

/**
 * Check if a phone number is valid (basic validation)
 */
export function isValidPhoneNumber(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

/**
 * Convert meters to miles
 */
export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

/**
 * Convert miles to meters
 */
export function milesToMeters(miles: number): number {
  return miles * 1609.344;
}
