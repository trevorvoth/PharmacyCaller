import { googlePlacesService, type PlaceResult } from './googlePlaces.js';
import { redisHelpers } from './redis.js';
import { logger } from '../utils/logger.js';
import type { PharmacyChain } from '@prisma/client';

// Redis key prefix and TTL for pagination state
const PAGINATION_STATE_PREFIX = 'search:pagination:';
const PAGINATION_STATE_TTL = 60 * 60 * 2; // 2 hours (tokens expire after this)

export interface PaginationState {
  searchId: string;
  nextPageToken: string | null;
  searchParams: {
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    chainFilter?: string[];
    openNow?: boolean;
  };
  pagesRetrieved: number;
  totalResultsFetched: number;
  createdAt: number;
}

export interface PharmacySearchResult {
  id: string;
  name: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  chain: PharmacyChain | null;
  distance?: number; // meters
  openNow?: boolean;
}

export interface PharmacySearchResponse {
  pharmacies: PharmacySearchResult[];
  hasNextPage: boolean;
  pagesRetrieved: number;
}

export interface PharmacySearchRequest {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  maxResults?: number;
  chainFilter?: string[];
  openNow?: boolean;
  searchId?: string; // For storing pagination state
  targetPharmacyCount?: number; // Target number of pharmacies with valid phone numbers (default: 25)
  maxPages?: number; // Maximum API pages to fetch to cap costs (default: 5)
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
  async searchNearby(request: PharmacySearchRequest): Promise<PharmacySearchResponse> {
    const {
      latitude,
      longitude,
      radiusMeters,
      maxResults,
      chainFilter,
      openNow,
      searchId,
      targetPharmacyCount = 25,
      maxPages = 5,
    } = request;

    logger.info({
      latitude,
      longitude,
      radiusMeters,
      maxResults,
      chainFilter,
      openNow,
      searchId,
      targetPharmacyCount,
      maxPages,
    }, 'Starting pharmacy search with auto-pagination');

    // Collect all results across pages
    const allResults: PharmacySearchResult[] = [];
    let pagesRetrieved = 0;
    let nextPageToken: string | undefined;
    let hasMorePages = true;

    // Auto-paginate until we have enough pharmacies or hit limits
    while (hasMorePages && allResults.length < targetPharmacyCount && pagesRetrieved < maxPages) {
      const response = await googlePlacesService.searchPharmaciesNearby({
        latitude,
        longitude,
        radiusMeters,
        maxResults,
        chainFilter,
        openNow,
        pageToken: nextPageToken,
      });

      pagesRetrieved++;
      const pageResults = this._transformPlaces(response.places, latitude, longitude);

      // Add new results, avoiding duplicates by checking place ID
      const existingIds = new Set(allResults.map((r) => r.id));
      for (const result of pageResults) {
        if (!existingIds.has(result.id)) {
          allResults.push(result);
          existingIds.add(result.id);
        }
      }

      logger.info({
        page: pagesRetrieved,
        rawResults: response.places.length,
        validResults: pageResults.length,
        totalCollected: allResults.length,
        targetPharmacyCount,
        hasNextPage: !!response.nextPageToken,
      }, 'Pagination: page fetched');

      nextPageToken = response.nextPageToken;
      hasMorePages = !!nextPageToken;

      // Stop if we've collected enough
      if (allResults.length >= targetPharmacyCount) {
        logger.info({
          collected: allResults.length,
          target: targetPharmacyCount,
          pagesUsed: pagesRetrieved,
        }, 'Target pharmacy count reached');
        break;
      }
    }

    // Sort all results by distance
    allResults.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

    // Store pagination state in Redis if we have a searchId and more pages available
    if (searchId && nextPageToken && pagesRetrieved < maxPages) {
      const paginationState: PaginationState = {
        searchId,
        nextPageToken,
        searchParams: {
          latitude,
          longitude,
          radiusMeters,
          chainFilter,
          openNow,
        },
        pagesRetrieved,
        totalResultsFetched: allResults.length,
        createdAt: Date.now(),
      };
      await redisHelpers.setJson(
        `${PAGINATION_STATE_PREFIX}${searchId}`,
        paginationState,
        PAGINATION_STATE_TTL
      );
    }

    // Log final stats
    const targetReached = allResults.length >= targetPharmacyCount;
    if (!targetReached && !hasMorePages) {
      logger.warn({
        collected: allResults.length,
        target: targetPharmacyCount,
        pagesUsed: pagesRetrieved,
        maxPages,
      }, 'Could not reach target pharmacy count - no more results available');
    }

    logger.info({
      resultsCount: allResults.length,
      withKnownChains: allResults.filter((r) => r.chain !== null).length,
      pagesRetrieved,
      targetReached,
      hasNextPage: hasMorePages && pagesRetrieved < maxPages,
    }, 'Pharmacy search completed');

    return {
      pharmacies: allResults,
      hasNextPage: hasMorePages && pagesRetrieved < maxPages,
      pagesRetrieved,
    };
  },

  async fetchNextPage(searchId: string): Promise<PharmacySearchResponse | null> {
    // Get pagination state from Redis
    const paginationState = await redisHelpers.getJson<PaginationState>(
      `${PAGINATION_STATE_PREFIX}${searchId}`
    );

    if (!paginationState || !paginationState.nextPageToken) {
      logger.info({ searchId }, 'No more pages available for search');
      return null;
    }

    // Check if token might be expired (older than 2 hours)
    const tokenAge = Date.now() - paginationState.createdAt;
    if (tokenAge > PAGINATION_STATE_TTL * 1000) {
      logger.warn({ searchId, tokenAge }, 'Pagination token may be expired');
      // Clean up expired state
      await redisHelpers.deleteKey(`${PAGINATION_STATE_PREFIX}${searchId}`);
      return null;
    }

    // Limit to 3 pages total (60 results max)
    if (paginationState.pagesRetrieved >= 3) {
      logger.info({ searchId, pagesRetrieved: paginationState.pagesRetrieved }, 'Maximum pages reached');
      return null;
    }

    logger.info({
      searchId,
      currentPage: paginationState.pagesRetrieved + 1,
    }, 'Fetching next page of pharmacy results');

    const response = await googlePlacesService.searchPharmaciesNearby({
      latitude: paginationState.searchParams.latitude,
      longitude: paginationState.searchParams.longitude,
      radiusMeters: paginationState.searchParams.radiusMeters,
      chainFilter: paginationState.searchParams.chainFilter,
      openNow: paginationState.searchParams.openNow,
      pageToken: paginationState.nextPageToken,
    });

    const results = this._transformPlaces(
      response.places,
      paginationState.searchParams.latitude,
      paginationState.searchParams.longitude
    );

    // Update pagination state
    const newPagesRetrieved = paginationState.pagesRetrieved + 1;
    if (response.nextPageToken && newPagesRetrieved < 3) {
      paginationState.nextPageToken = response.nextPageToken;
      paginationState.pagesRetrieved = newPagesRetrieved;
      paginationState.totalResultsFetched += results.length;
      await redisHelpers.setJson(
        `${PAGINATION_STATE_PREFIX}${searchId}`,
        paginationState,
        PAGINATION_STATE_TTL
      );
    } else {
      // No more pages or reached limit - clean up state
      await redisHelpers.deleteKey(`${PAGINATION_STATE_PREFIX}${searchId}`);
    }

    logger.info({
      searchId,
      resultsCount: results.length,
      pagesRetrieved: newPagesRetrieved,
      hasNextPage: !!response.nextPageToken && newPagesRetrieved < 3,
    }, 'Next page fetched');

    return {
      pharmacies: results,
      hasNextPage: !!response.nextPageToken && newPagesRetrieved < 3,
      pagesRetrieved: newPagesRetrieved,
    };
  },

  async getPaginationState(searchId: string): Promise<PaginationState | null> {
    return redisHelpers.getJson<PaginationState>(`${PAGINATION_STATE_PREFIX}${searchId}`);
  },

  async hasMorePages(searchId: string): Promise<boolean> {
    const state = await this.getPaginationState(searchId);
    return !!(state && state.nextPageToken && state.pagesRetrieved < 3);
  },

  _transformPlaces(places: PlaceResult[], originLat: number, originLon: number): PharmacySearchResult[] {
    return places
      .map((place) => {
        const phone = formatPhoneNumber(place);

        // Skip places without a valid phone number
        if (!phone) {
          return null;
        }

        const distance = calculateDistance(
          originLat,
          originLon,
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
          openNow: place.openNow,
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)); // Sort by distance
  },
};
