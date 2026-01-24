import axios from 'axios';
import { googleConfig } from '../config/google.js';
import { logger } from '../utils/logger.js';

export interface PlaceLocation {
  latitude: number;
  longitude: number;
}

export interface PlaceResult {
  id: string;
  displayName: string;
  formattedAddress: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  location: PlaceLocation;
  types: string[];
  openNow?: boolean;
}

export interface SearchNearbyResponse {
  places: PlaceResult[];
  nextPageToken?: string;
}

export interface SearchNearbyRequest {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  maxResults?: number;
  chainFilter?: string[];  // Filter by pharmacy chains (e.g., ['CVS', 'Walgreens'])
  openNow?: boolean;       // Only return currently open pharmacies
  pageToken?: string;      // For pagination - fetch next page of results
}

interface GooglePlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    location?: { latitude: number; longitude: number };
    types?: string[];
    currentOpeningHours?: {
      openNow?: boolean;
    };
    regularOpeningHours?: {
      openNow?: boolean;
    };
  }>;
  nextPageToken?: string;
}

const DEFAULT_RADIUS_METERS = 24140; // 15 miles
const DEFAULT_MAX_RESULTS = 20; // Google Places API max per page

export const googlePlacesService = {
  async searchPharmaciesNearby(request: SearchNearbyRequest): Promise<SearchNearbyResponse> {
    const {
      latitude,
      longitude,
      radiusMeters = DEFAULT_RADIUS_METERS,
      maxResults = DEFAULT_MAX_RESULTS,
      chainFilter,
      openNow,
      pageToken,
    } = request;

    logger.debug({
      latitude,
      longitude,
      radiusMeters,
      maxResults,
      chainFilter,
      openNow,
      pageToken: pageToken ? 'present' : 'none',
    }, 'Searching for pharmacies');

    try {
      // Build request body
      // Note: We don't use rankPreference: 'DISTANCE' as it limits results
      // Instead, we sort by distance ourselves in pharmacySearch.ts after fetching
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const requestBody: Record<string, any> = {
        includedTypes: ['pharmacy'],
        maxResultCount: maxResults,
      };

      // If we have a page token, we only need the token (not location/filters)
      if (pageToken) {
        requestBody.pageToken = pageToken;
      } else {
        // Only include location restriction for initial search
        requestBody.locationRestriction = {
          circle: {
            center: { latitude, longitude },
            radius: radiusMeters,
          },
        };
      }

      // Build field mask - include opening hours if filtering by open status
      // Note: nextPageToken is returned automatically at the response level, not in the field mask
      const fieldMask = [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.location',
        'places.types',
        'places.currentOpeningHours',
      ].join(',');

      const response = await axios.post<GooglePlacesResponse>(
        googleConfig.placesBaseUrl,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': googleConfig.placesApiKey,
            'X-Goog-FieldMask': fieldMask,
          },
        }
      );

      let places = response.data.places ?? [];

      // Filter by chain name if specified (post-fetch filtering since Nearby Search doesn't support textQuery)
      if (chainFilter && chainFilter.length > 0) {
        const chainPatterns = chainFilter.map((chain) => chain.toLowerCase());
        places = places.filter((place) => {
          const name = place.displayName?.text?.toLowerCase() ?? '';
          return chainPatterns.some((chain) => name.includes(chain));
        });
      }

      // Filter by open status if requested (server-side filtering as backup)
      if (openNow) {
        places = places.filter((place) => {
          const isOpen = place.currentOpeningHours?.openNow ?? place.regularOpeningHours?.openNow;
          // Include places that are open OR where we don't have hours data (don't exclude unknowns)
          return isOpen !== false;
        });
      }

      const results: PlaceResult[] = places
        .filter((place) => place.nationalPhoneNumber || place.internationalPhoneNumber)
        .map((place) => ({
          id: place.id,
          displayName: place.displayName?.text ?? 'Unknown Pharmacy',
          formattedAddress: place.formattedAddress ?? '',
          nationalPhoneNumber: place.nationalPhoneNumber,
          internationalPhoneNumber: place.internationalPhoneNumber,
          location: {
            latitude: place.location?.latitude ?? latitude,
            longitude: place.location?.longitude ?? longitude,
          },
          types: place.types ?? [],
          openNow: place.currentOpeningHours?.openNow ?? place.regularOpeningHours?.openNow,
        }));

      logger.info({
        found: results.length,
        latitude,
        longitude,
        hasNextPage: !!response.data.nextPageToken,
      }, 'Pharmacy search completed');

      return {
        places: results,
        nextPageToken: response.data.nextPageToken,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          status: error.response?.status,
          data: error.response?.data,
        }, 'Google Places API error');

        if (error.response?.status === 403) {
          throw new Error('Google Places API key is invalid or quota exceeded');
        }
      }
      throw error;
    }
  },

  async getPlaceDetails(placeId: string): Promise<PlaceResult | null> {
    try {
      const response = await axios.get<{
        id: string;
        displayName?: { text: string };
        formattedAddress?: string;
        nationalPhoneNumber?: string;
        internationalPhoneNumber?: string;
        location?: { latitude: number; longitude: number };
        types?: string[];
      }>(
        `${googleConfig.placesDetailsUrl}/${placeId}`,
        {
          headers: {
            'X-Goog-Api-Key': googleConfig.placesApiKey,
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,location,types',
          },
        }
      );

      const place = response.data;

      return {
        id: place.id,
        displayName: place.displayName?.text ?? 'Unknown Pharmacy',
        formattedAddress: place.formattedAddress ?? '',
        nationalPhoneNumber: place.nationalPhoneNumber,
        internationalPhoneNumber: place.internationalPhoneNumber,
        location: {
          latitude: place.location?.latitude ?? 0,
          longitude: place.location?.longitude ?? 0,
        },
        types: place.types ?? [],
      };
    } catch (error) {
      logger.error({ err: error, placeId }, 'Failed to get place details');
      return null;
    }
  },
};
