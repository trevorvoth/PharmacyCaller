/**
 * Pharmacy Search Service
 *
 * Searches for pharmacies using OpenStreetMap's Overpass API.
 * Enriches results with phone numbers from NPPES when needed.
 */

import { osmService, type OSMPharmacy } from './openStreetMap.js';
import { redisHelpers } from './redis.js';
import { nppesApiService } from './nppesApi.js';
import { logger } from '../utils/logger.js';
import { extractCityState } from './pharmacyHelpers.js';
import type { PharmacyChain } from '@prisma/client';

// Redis key prefix and TTL for search state
const SEARCH_STATE_PREFIX = 'search:state:';
const SEARCH_STATE_TTL = 60 * 60 * 2; // 2 hours

export interface SearchState {
  searchId: string;
  searchParams: {
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    chainFilter?: string[];
    openNow?: boolean;
  };
  totalResultsFetched: number;
  createdAt: number;
}

// Keep 'google' for backwards compatibility with existing data, add 'osm' as new source
export type PhoneSource = 'google' | 'osm' | 'nppes' | null;

export interface PharmacySearchResult {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  phoneSource: PhoneSource;
  latitude: number;
  longitude: number;
  chain: PharmacyChain | null;
  distance?: number; // meters
  openNow?: boolean;
}

export interface PharmacySearchResponse {
  pharmacies: PharmacySearchResult[];
  hasNextPage: boolean; // OSM returns all at once, so typically false
  pagesRetrieved: number;
}

export interface PharmacySearchRequest {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  maxResults?: number;
  chainFilter?: string[];
  openNow?: boolean;
  searchId?: string;
  targetPharmacyCount?: number;
  maxPages?: number; // Not used by OSM but kept for API compatibility
  enableNppesEnrichment?: boolean;
}

// Internal interface for pharmacies without phone numbers (for NPPES enrichment)
interface PharmacyWithoutPhone {
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

// Default radius: 5 miles in meters
const DEFAULT_RADIUS_METERS = 8047;
// Expanded radius when filtering: 15 miles in meters
const FILTERED_RADIUS_METERS = 24140;

export const pharmacySearchService = {
  /**
   * Search for pharmacies near a location
   */
  async searchNearby(request: PharmacySearchRequest): Promise<PharmacySearchResponse> {
    const {
      latitude,
      longitude,
      radiusMeters: requestedRadius,
      maxResults,
      chainFilter,
      openNow,
      searchId,
      targetPharmacyCount = 25,
      enableNppesEnrichment = true,
    } = request;

    // When chain filter is active, use expanded radius to find more matching pharmacies
    const hasChainFilter = chainFilter && chainFilter.length > 0;
    const radiusMeters = requestedRadius ?? (hasChainFilter ? FILTERED_RADIUS_METERS : DEFAULT_RADIUS_METERS);

    logger.info({
      latitude,
      longitude,
      radiusMeters,
      maxResults,
      chainFilter,
      openNow,
      searchId,
      targetPharmacyCount,
      enableNppesEnrichment,
      hasChainFilter,
    }, 'Starting pharmacy search with OSM');

    // Search OSM for pharmacies
    const osmResponse = await osmService.searchPharmaciesNearby({
      latitude,
      longitude,
      radiusMeters,
      chainFilter,
      openNow,
    });

    // Separate pharmacies with and without phone numbers
    const { withPhone, withoutPhone } = this._separateByPhone(osmResponse.pharmacies);

    logger.info({
      totalResults: osmResponse.totalResults,
      withPhone: withPhone.length,
      withoutPhone: withoutPhone.length,
    }, 'OSM search results separated');

    // Start with pharmacies that have phones
    const allResults: PharmacySearchResult[] = [...withPhone];

    // Enrich with NPPES if needed and enabled
    if (enableNppesEnrichment && allResults.length < targetPharmacyCount && withoutPhone.length > 0) {
      const neededCount = targetPharmacyCount - allResults.length;
      const maxEnrichments = Math.min(neededCount, 15); // Cap NPPES calls

      logger.info({
        currentCount: allResults.length,
        needed: neededCount,
        availableForEnrichment: withoutPhone.length,
        attempting: maxEnrichments,
      }, 'Attempting NPPES enrichment');

      const enriched = await this.enrichWithNppes(withoutPhone, maxEnrichments);

      // Add enriched pharmacies
      const existingIds = new Set(allResults.map(r => r.id));
      for (const pharmacy of enriched) {
        if (!existingIds.has(pharmacy.id)) {
          allResults.push(pharmacy);
          existingIds.add(pharmacy.id);
        }
      }

      logger.info({
        enrichedCount: enriched.length,
        newTotal: allResults.length,
      }, 'NPPES enrichment complete');
    }

    // Add remaining pharmacies without phones (they'll be displayed but not callable)
    const existingIds = new Set(allResults.map(r => r.id));
    for (const pharmacy of withoutPhone) {
      if (!existingIds.has(pharmacy.id)) {
        allResults.push({
          id: pharmacy.id,
          name: pharmacy.name,
          address: pharmacy.address,
          phone: null,
          phoneSource: null,
          latitude: pharmacy.latitude,
          longitude: pharmacy.longitude,
          chain: pharmacy.chain,
          distance: pharmacy.distance,
          openNow: pharmacy.openNow,
        });
      }
    }

    // Apply maxResults limit if specified
    let finalResults = allResults;
    if (maxResults && maxResults > 0) {
      finalResults = allResults.slice(0, maxResults);
    }

    // Store search state in Redis if searchId provided
    if (searchId) {
      const searchState: SearchState = {
        searchId,
        searchParams: {
          latitude,
          longitude,
          radiusMeters,
          chainFilter,
          openNow,
        },
        totalResultsFetched: finalResults.length,
        createdAt: Date.now(),
      };
      await redisHelpers.setJson(
        `${SEARCH_STATE_PREFIX}${searchId}`,
        searchState,
        SEARCH_STATE_TTL
      );
    }

    logger.info({
      resultsCount: finalResults.length,
      withKnownChains: finalResults.filter(r => r.chain !== null).length,
      withPhones: finalResults.filter(r => r.phone !== null).length,
    }, 'Pharmacy search completed');

    return {
      pharmacies: finalResults,
      hasNextPage: false, // OSM returns all results at once
      pagesRetrieved: 1,
    };
  },

  /**
   * Separate OSM pharmacies into those with and without phone numbers
   */
  _separateByPhone(pharmacies: (OSMPharmacy & { distance?: number })[]): {
    withPhone: PharmacySearchResult[];
    withoutPhone: PharmacyWithoutPhone[];
  } {
    const withPhone: PharmacySearchResult[] = [];
    const withoutPhone: PharmacyWithoutPhone[] = [];

    for (const pharmacy of pharmacies) {
      const { city, state } = extractCityState(pharmacy.address);

      if (pharmacy.phone) {
        withPhone.push({
          id: pharmacy.id,
          name: pharmacy.name,
          address: pharmacy.address,
          phone: pharmacy.phone,
          phoneSource: 'osm',
          latitude: pharmacy.latitude,
          longitude: pharmacy.longitude,
          chain: pharmacy.chain,
          distance: pharmacy.distance,
          openNow: pharmacy.openNow ?? undefined,
        });
      } else {
        withoutPhone.push({
          id: pharmacy.id,
          name: pharmacy.name,
          address: pharmacy.address,
          latitude: pharmacy.latitude,
          longitude: pharmacy.longitude,
          city,
          state,
          chain: pharmacy.chain,
          distance: pharmacy.distance ?? 0,
          openNow: pharmacy.openNow ?? undefined,
        });
      }
    }

    return { withPhone, withoutPhone };
  },

  /**
   * Enrich pharmacies without phone numbers using NPPES API
   */
  async enrichWithNppes(
    pharmaciesWithoutPhone: PharmacyWithoutPhone[],
    maxEnrichments: number = 10
  ): Promise<PharmacySearchResult[]> {
    if (pharmaciesWithoutPhone.length === 0) {
      return [];
    }

    // Filter to only pharmacies with valid city/state for NPPES lookup
    const enrichable = pharmaciesWithoutPhone.filter(p => p.city && p.state);
    const skippedCount = pharmaciesWithoutPhone.length - enrichable.length;

    if (skippedCount > 0) {
      logger.info({
        skipped: skippedCount,
        reason: 'missing_city_or_state',
      }, 'Pharmacies skipped for NPPES enrichment');
    }

    const toEnrich = enrichable.slice(0, maxEnrichments);
    const enriched: PharmacySearchResult[] = [];

    logger.info({
      toEnrich: toEnrich.length,
      totalEnrichable: enrichable.length,
      totalWithoutPhone: pharmaciesWithoutPhone.length,
    }, 'Starting NPPES enrichment');

    // Use batch lookup for efficiency
    const pharmaciesToLookup = toEnrich.map(p => ({
      name: p.name,
      city: p.city,
      state: p.state,
    }));

    const phoneMap = await nppesApiService.batchLookupPhones(pharmaciesToLookup);

    for (const pharmacy of toEnrich) {
      const phone = phoneMap.get(pharmacy.name);
      if (phone) {
        enriched.push({
          id: pharmacy.id,
          name: pharmacy.name,
          address: pharmacy.address,
          phone,
          phoneSource: 'nppes',
          latitude: pharmacy.latitude,
          longitude: pharmacy.longitude,
          chain: pharmacy.chain,
          distance: pharmacy.distance,
          openNow: pharmacy.openNow,
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

  /**
   * Get search state from Redis
   */
  async getSearchState(searchId: string): Promise<SearchState | null> {
    return redisHelpers.getJson<SearchState>(`${SEARCH_STATE_PREFIX}${searchId}`);
  },

  // Legacy methods for API compatibility - OSM doesn't use pagination tokens
  // These are kept to avoid breaking existing code that calls them

  /**
   * @deprecated OSM returns all results at once, pagination not needed
   */
  async fetchNextPage(_searchId: string): Promise<PharmacySearchResponse | null> {
    logger.info({ _searchId }, 'fetchNextPage called - OSM returns all results at once');
    return null;
  },

  /**
   * @deprecated OSM returns all results at once, pagination not needed
   */
  async getPaginationState(_searchId: string): Promise<SearchState | null> {
    return this.getSearchState(_searchId);
  },

  /**
   * @deprecated OSM returns all results at once
   */
  async hasMorePages(_searchId: string): Promise<boolean> {
    return false;
  },
};

// Legacy exports for backwards compatibility
export interface PaginationState extends SearchState {
  nextPageToken: string | null;
  pagesRetrieved: number;
}
