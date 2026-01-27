import { googlePlacesService, type PlaceResult } from './googlePlaces.js';
import { redisHelpers } from './redis.js';
import { nppesApiService } from './nppesApi.js';
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

export type PhoneSource = 'google' | 'nppes' | null;

export interface PharmacySearchResult {
  id: string;
  name: string;
  address: string;
  phone: string | null; // null for pharmacies without phone numbers
  phoneSource: PhoneSource; // Track where the phone number came from
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
  enableNppesEnrichment?: boolean; // Enable NPPES API enrichment for missing phone numbers (default: true)
}

// Internal interface for places without phone numbers (for enrichment)
interface PlaceWithoutPhone {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  chain: PharmacyChain | null;
  distance: number;
  openNow?: boolean;
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

/**
 * Extract city and state from a formatted address
 * Example: "123 Main St, Los Angeles, CA 90001, USA" -> { city: "Los Angeles", state: "CA" }
 */
function extractCityState(address: string): { city: string; state: string } {
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
      enableNppesEnrichment = true,
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
      enableNppesEnrichment,
    }, 'Starting pharmacy search with auto-pagination');

    // Collect all results across pages
    const allResults: PharmacySearchResult[] = [];
    const allPlacesWithoutPhone: PlaceWithoutPhone[] = [];
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

      // Transform places, separating those with and without phone numbers
      const { withPhone, withoutPhone } = this._transformPlacesForEnrichment(
        response.places,
        latitude,
        longitude
      );

      // Add new results, avoiding duplicates by checking place ID
      const existingIds = new Set(allResults.map((r) => r.id));
      for (const result of withPhone) {
        if (!existingIds.has(result.id)) {
          allResults.push(result);
          existingIds.add(result.id);
        }
      }

      // Also track places without phones for potential NPPES enrichment
      const existingWithoutPhoneIds = new Set(allPlacesWithoutPhone.map((r) => r.id));
      for (const place of withoutPhone) {
        if (!existingIds.has(place.id) && !existingWithoutPhoneIds.has(place.id)) {
          allPlacesWithoutPhone.push(place);
          existingWithoutPhoneIds.add(place.id);
        }
      }

      logger.info({
        page: pagesRetrieved,
        rawResults: response.places.length,
        withPhone: withPhone.length,
        withoutPhone: withoutPhone.length,
        totalWithPhone: allResults.length,
        totalWithoutPhone: allPlacesWithoutPhone.length,
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

    // Log NPPES enrichment evaluation for debugging
    logger.info({
      enableNppesEnrichment,
      allResultsCount: allResults.length,
      targetPharmacyCount,
      allPlacesWithoutPhoneCount: allPlacesWithoutPhone.length,
      willAttemptEnrichment: enableNppesEnrichment && allResults.length < targetPharmacyCount && allPlacesWithoutPhone.length > 0,
    }, 'NPPES enrichment condition evaluation');

    // If we still need more pharmacies and have places without phones, try NPPES enrichment
    if (enableNppesEnrichment && allResults.length < targetPharmacyCount && allPlacesWithoutPhone.length > 0) {
      const neededCount = targetPharmacyCount - allResults.length;
      const maxEnrichments = Math.min(neededCount, 15); // Cap at 15 to limit API calls

      logger.info({
        currentCount: allResults.length,
        needed: neededCount,
        availableForEnrichment: allPlacesWithoutPhone.length,
        attempting: maxEnrichments,
      }, 'Attempting NPPES enrichment for pharmacies without phone numbers');

      const enrichedPharmacies = await this.enrichWithNppes(allPlacesWithoutPhone, maxEnrichments);

      // Add enriched pharmacies to results (with deduplication check)
      const existingIds = new Set(allResults.map(r => r.id));
      let addedCount = 0;
      for (const enriched of enrichedPharmacies) {
        if (!existingIds.has(enriched.id)) {
          allResults.push(enriched);
          existingIds.add(enriched.id);
          addedCount++;
        }
      }

      logger.info({
        enrichedCount: enrichedPharmacies.length,
        addedCount,
        skippedDuplicates: enrichedPharmacies.length - addedCount,
        newTotal: allResults.length,
      }, 'NPPES enrichment added to results');
    }

    // Add remaining pharmacies without phones to results (so all nearby pharmacies are shown)
    // These will be marked with phone: null and phoneSource: null
    const existingIdsForPhoneless = new Set(allResults.map(r => r.id));
    let phonelessAdded = 0;
    for (const place of allPlacesWithoutPhone) {
      if (!existingIdsForPhoneless.has(place.id)) {
        allResults.push({
          id: place.id,
          name: place.name,
          address: place.address,
          phone: null,
          phoneSource: null,
          latitude: place.latitude,
          longitude: place.longitude,
          chain: place.chain,
          distance: place.distance,
          openNow: place.openNow,
        });
        existingIdsForPhoneless.add(place.id);
        phonelessAdded++;
      }
    }

    if (phonelessAdded > 0) {
      logger.info({
        phonelessAdded,
        totalWithoutPhoneAvailable: allPlacesWithoutPhone.length,
        newTotal: allResults.length,
      }, 'Added pharmacies without phone numbers to results');
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
          phone, // May be empty string if no phone available
          phoneSource: phone ? 'google' as const : null,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          chain: detectChain(place.displayName),
          distance: Math.round(distance),
          openNow: place.openNow,
        };
      })
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)); // Sort by distance
  },

  /**
   * Transform places including those without phone numbers (for enrichment)
   * All pharmacies are included in results; those without phones can still be displayed
   */
  _transformPlacesForEnrichment(
    places: PlaceResult[],
    originLat: number,
    originLon: number
  ): { withPhone: PharmacySearchResult[]; withoutPhone: PlaceWithoutPhone[] } {
    const withPhone: PharmacySearchResult[] = [];
    const withoutPhone: PlaceWithoutPhone[] = [];

    for (const place of places) {
      const phone = formatPhoneNumber(place);
      const distance = calculateDistance(
        originLat,
        originLon,
        place.location.latitude,
        place.location.longitude
      );

      const { city, state } = extractCityState(place.formattedAddress);

      if (phone) {
        // Only add pharmacies WITH phone numbers to withPhone
        withPhone.push({
          id: place.id,
          name: place.displayName,
          address: place.formattedAddress,
          phone,
          phoneSource: 'google' as const,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          chain: detectChain(place.displayName),
          distance: Math.round(distance),
          openNow: place.openNow,
        });
      } else if (city && state) {
        // Track places WITHOUT phones for NPPES enrichment
        withoutPhone.push({
          id: place.id,
          name: place.displayName,
          address: place.formattedAddress,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          city,
          state,
          chain: detectChain(place.displayName),
          distance: Math.round(distance),
          openNow: place.openNow,
        });
      } else {
        // No phone AND city/state extraction failed - log for debugging
        // Still add to withoutPhone with empty city/state so it appears in results
        logger.info({
          pharmacyName: place.displayName,
          address: place.formattedAddress,
          extractedCity: city,
          extractedState: state,
        }, 'City/state extraction failed - pharmacy will appear without phone and cannot use NPPES');

        // Add with empty city/state - won't be enriched but will still show in results
        withoutPhone.push({
          id: place.id,
          name: place.displayName,
          address: place.formattedAddress,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          city: '',
          state: '',
          chain: detectChain(place.displayName),
          distance: Math.round(distance),
          openNow: place.openNow,
        });
      }
    }

    return { withPhone, withoutPhone };
  },

  /**
   * Enrich pharmacies without phone numbers using NPPES API
   */
  async enrichWithNppes(
    placesWithoutPhone: PlaceWithoutPhone[],
    maxEnrichments: number = 10
  ): Promise<PharmacySearchResult[]> {
    if (placesWithoutPhone.length === 0) {
      return [];
    }

    // Filter to only pharmacies with valid city/state for NPPES lookup
    const enrichable = placesWithoutPhone.filter(p => p.city && p.state);
    const skippedCount = placesWithoutPhone.length - enrichable.length;

    if (skippedCount > 0) {
      logger.info({
        skipped: skippedCount,
        reason: 'missing_city_or_state',
      }, 'Pharmacies skipped for NPPES enrichment - no city/state');
    }

    const toEnrich = enrichable.slice(0, maxEnrichments);
    const enriched: PharmacySearchResult[] = [];

    logger.info({
      toEnrich: toEnrich.length,
      totalEnrichable: enrichable.length,
      totalWithoutPhone: placesWithoutPhone.length,
    }, 'Starting NPPES enrichment');

    // Use batch lookup for efficiency
    const pharmaciesToLookup = toEnrich.map(p => ({
      name: p.name,
      city: p.city,
      state: p.state,
    }));

    const phoneMap = await nppesApiService.batchLookupPhones(pharmaciesToLookup);

    for (const place of toEnrich) {
      const phone = phoneMap.get(place.name);
      if (phone) {
        enriched.push({
          id: place.id,
          name: place.name,
          address: place.address,
          phone,
          phoneSource: 'nppes' as const,
          latitude: place.latitude,
          longitude: place.longitude,
          chain: place.chain,
          distance: place.distance,
          openNow: place.openNow,
        });
      }
    }

    logger.info({
      enriched: enriched.length,
      attempted: toEnrich.length,
      successRate: toEnrich.length > 0 ? Math.round((enriched.length / toEnrich.length) * 100) : 0,
    }, 'NPPES enrichment complete');

    return enriched;
  },
};
