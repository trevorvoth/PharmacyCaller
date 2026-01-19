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
}

export interface SearchNearbyRequest {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  maxResults?: number;
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
  }>;
}

const DEFAULT_RADIUS_METERS = 16093; // 10 miles
const DEFAULT_MAX_RESULTS = 10;

export const googlePlacesService = {
  async searchPharmaciesNearby(request: SearchNearbyRequest): Promise<PlaceResult[]> {
    const {
      latitude,
      longitude,
      radiusMeters = DEFAULT_RADIUS_METERS,
      maxResults = DEFAULT_MAX_RESULTS,
    } = request;

    logger.debug({
      latitude,
      longitude,
      radiusMeters,
      maxResults,
    }, 'Searching for pharmacies');

    try {
      const response = await axios.post<GooglePlacesResponse>(
        googleConfig.placesBaseUrl,
        {
          includedTypes: ['pharmacy'],
          maxResultCount: maxResults,
          locationRestriction: {
            circle: {
              center: { latitude, longitude },
              radius: radiusMeters,
            },
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': googleConfig.placesApiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.location,places.types',
          },
        }
      );

      const places = response.data.places ?? [];

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
        }));

      logger.info({
        found: results.length,
        latitude,
        longitude,
      }, 'Pharmacy search completed');

      return results;
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
