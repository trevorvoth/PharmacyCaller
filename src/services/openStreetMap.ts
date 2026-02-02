/**
 * OpenStreetMap pharmacy search service using Overpass API
 *
 * Replaces Google Places API for pharmacy searches.
 * Uses the public Overpass API by default, but can be configured
 * to use a self-hosted instance for production.
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';
import {
  calculateDistance,
  detectChainFromBrand,
  assembleAddressFromOSM,
  formatPhoneNumber,
  isValidPhoneNumber,
} from './pharmacyHelpers.js';
import type { PharmacyChain } from '@prisma/client';

// Default to public Overpass API, can be overridden via env
const OVERPASS_API_URL = process.env.OVERPASS_API_URL ?? 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT = 25; // seconds

export interface OSMPharmacy {
  id: string; // Format: "osm:node:123456" or "osm:way:123456"
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  name: string;
  address: string;
  phone: string | null;
  latitude: number;
  longitude: number;
  brand: string | null;
  chain: PharmacyChain | null;
  openingHours: string | null;
  openNow: boolean | null; // null if we can't determine
}

export interface OSMSearchRequest {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  chainFilter?: string[];
  openNow?: boolean;
}

export interface OSMSearchResponse {
  pharmacies: OSMPharmacy[];
  totalResults: number;
}

// OSM Element from Overpass response
interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  version: number;
  generator: string;
  elements: OverpassElement[];
}

/**
 * Build Overpass QL query for pharmacies within a radius
 * Queries multiple OSM tags to maximize coverage:
 * - amenity=pharmacy (standard)
 * - shop=chemist (common in UK/Europe)
 * - shop=pharmacy (alternative tagging)
 * - healthcare=pharmacy (healthcare classification)
 */
function buildOverpassQuery(
  latitude: number,
  longitude: number,
  radiusMeters: number
): string {
  // Query for nodes and ways tagged as pharmacies within the radius
  // Using 'around' filter for geographic search
  // Include multiple pharmacy-related tags for comprehensive coverage
  return `
[out:json][timeout:${OVERPASS_TIMEOUT}];
(
  node["amenity"="pharmacy"](around:${radiusMeters},${latitude},${longitude});
  way["amenity"="pharmacy"](around:${radiusMeters},${latitude},${longitude});
  node["shop"="chemist"](around:${radiusMeters},${latitude},${longitude});
  way["shop"="chemist"](around:${radiusMeters},${latitude},${longitude});
  node["shop"="pharmacy"](around:${radiusMeters},${latitude},${longitude});
  way["shop"="pharmacy"](around:${radiusMeters},${latitude},${longitude});
  node["healthcare"="pharmacy"](around:${radiusMeters},${latitude},${longitude});
  way["healthcare"="pharmacy"](around:${radiusMeters},${latitude},${longitude});
);
out body center;
  `.trim();
}

/**
 * Parse an OSM element into our pharmacy format
 */
function parseOSMElement(
  element: OverpassElement,
  originLat: number,
  originLon: number
): OSMPharmacy | null {
  const tags = element.tags ?? {};

  // Get coordinates - for ways, use the center point
  let lat: number;
  let lon: number;

  if (element.type === 'node') {
    if (element.lat === undefined || element.lon === undefined) {
      return null;
    }
    lat = element.lat;
    lon = element.lon;
  } else if (element.center) {
    lat = element.center.lat;
    lon = element.center.lon;
  } else {
    // Can't determine location
    return null;
  }

  // Get name - try multiple fallbacks for better coverage
  const name = tags.name
    ?? tags['name:en']
    ?? tags.brand
    ?? tags.operator
    ?? tags['official_name']
    ?? null;
  if (!name) {
    logger.debug({ osmId: element.id, type: element.type }, 'Skipping pharmacy without name');
    return null;
  }

  // Build address from components
  const address = assembleAddressFromOSM(tags);

  // Get phone number
  let phone: string | null = tags.phone ?? tags['contact:phone'] ?? null;
  if (phone) {
    phone = formatPhoneNumber(phone);
    if (!isValidPhoneNumber(phone)) {
      // Invalid format, treat as null
      phone = null;
    }
  }

  // Get brand for chain detection
  const brand = tags.brand ?? tags.operator ?? null;

  // Detect chain from brand or name
  const chain = detectChainFromBrand(brand ?? undefined, name);

  // Get opening hours (raw OSM format)
  const openingHours = tags.opening_hours ?? null;

  // Create pharmacy ID
  const id = `osm:${element.type}:${element.id}`;

  return {
    id,
    osmId: element.id,
    osmType: element.type,
    name,
    address,
    phone,
    latitude: lat,
    longitude: lon,
    brand,
    chain,
    openingHours,
    openNow: null, // Will be computed if needed
  };
}

/**
 * Filter pharmacies by chain
 */
function filterByChain(pharmacies: OSMPharmacy[], chainFilter: string[]): OSMPharmacy[] {
  if (!chainFilter || chainFilter.length === 0) {
    return pharmacies;
  }

  const normalizedFilter = chainFilter.map(c => c.toUpperCase());

  return pharmacies.filter(p => {
    if (p.chain && normalizedFilter.includes(p.chain)) {
      return true;
    }
    // Also check name for chain keywords
    const nameUpper = p.name.toUpperCase();
    return normalizedFilter.some(chain => nameUpper.includes(chain.replace('_', ' ')));
  });
}

export const osmService = {
  /**
   * Search for pharmacies near a location using Overpass API
   */
  async searchPharmaciesNearby(request: OSMSearchRequest): Promise<OSMSearchResponse> {
    const { latitude, longitude, radiusMeters, chainFilter, openNow } = request;

    logger.info({
      latitude,
      longitude,
      radiusMeters,
      chainFilter,
      openNow,
    }, 'Searching OSM for pharmacies');

    const query = buildOverpassQuery(latitude, longitude, radiusMeters);

    try {
      const response = await axios.post<OverpassResponse>(
        OVERPASS_API_URL,
        `data=${encodeURIComponent(query)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: (OVERPASS_TIMEOUT + 5) * 1000, // Add buffer to timeout
        }
      );

      const elements = response.data.elements ?? [];

      logger.info({
        rawResults: elements.length,
      }, 'Overpass API returned results');

      // Parse elements into pharmacies, deduplicating by name+address
      // OSM can have both a node and a way for the same physical pharmacy
      let pharmacies: OSMPharmacy[] = [];
      const seenKeys = new Set<string>();
      for (const element of elements) {
        const pharmacy = parseOSMElement(element, latitude, longitude);
        if (pharmacy) {
          const dedupKey = `${pharmacy.name.toLowerCase()}|${pharmacy.address.toLowerCase()}`;
          if (!seenKeys.has(dedupKey)) {
            seenKeys.add(dedupKey);
            pharmacies.push(pharmacy);
          }
        }
      }

      logger.info({
        parsed: pharmacies.length,
        duplicatesRemoved: elements.length - pharmacies.length,
      }, 'Parsed OSM pharmacies (deduplicated)');

      // Apply chain filter if specified
      if (chainFilter && chainFilter.length > 0) {
        const beforeFilter = pharmacies.length;
        pharmacies = filterByChain(pharmacies, chainFilter);
        logger.info({
          beforeFilter,
          afterFilter: pharmacies.length,
          chainFilter,
        }, 'Applied chain filter');
      }

      // Note: openNow filtering requires parsing OSM opening_hours format
      // This is complex and may be skipped or implemented later
      if (openNow) {
        logger.debug('openNow filter requested - not implemented for OSM yet');
        // TODO: Implement opening hours parsing if needed
      }

      // Calculate distances and sort
      const pharmaciesWithDistance = pharmacies.map(p => ({
        ...p,
        distance: Math.round(calculateDistance(latitude, longitude, p.latitude, p.longitude)),
      }));

      pharmaciesWithDistance.sort((a, b) => a.distance - b.distance);

      return {
        pharmacies: pharmaciesWithDistance,
        totalResults: pharmaciesWithDistance.length,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          status: error.response?.status,
          message: error.message,
          url: OVERPASS_API_URL,
        }, 'Overpass API error');

        if (error.response?.status === 429) {
          throw new Error('Overpass API rate limit exceeded. Please try again later.');
        }
        if (error.response?.status === 504) {
          throw new Error('Overpass API timeout. Try reducing the search radius.');
        }
      } else {
        logger.error({ error }, 'OSM search failed');
      }

      throw new Error('Failed to search for pharmacies. Please try again.');
    }
  },

  /**
   * Get details for a specific pharmacy by OSM ID
   * Format: "osm:node:123456" or "osm:way:123456"
   */
  async getPharmacyDetails(osmIdString: string): Promise<OSMPharmacy | null> {
    const match = osmIdString.match(/^osm:(node|way|relation):(\d+)$/);
    if (!match) {
      logger.warn({ osmIdString }, 'Invalid OSM ID format');
      return null;
    }

    const osmType = match[1] as 'node' | 'way' | 'relation';
    const osmId = parseInt(match[2], 10);

    const query = `
[out:json][timeout:10];
${osmType}(${osmId});
out body center;
    `.trim();

    try {
      const response = await axios.post<OverpassResponse>(
        OVERPASS_API_URL,
        `data=${encodeURIComponent(query)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15000,
        }
      );

      const elements = response.data.elements ?? [];
      if (elements.length === 0) {
        logger.info({ osmIdString }, 'OSM element not found');
        return null;
      }

      // Use 0,0 as origin since we don't need distance for details
      return parseOSMElement(elements[0], 0, 0);
    } catch (error) {
      logger.error({ error, osmIdString }, 'Failed to get OSM pharmacy details');
      return null;
    }
  },

  /**
   * Build an Overpass query (exported for testing)
   */
  _buildQuery: buildOverpassQuery,

  /**
   * Parse an OSM element (exported for testing)
   */
  _parseElement: parseOSMElement,
};
