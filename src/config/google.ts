import { env } from './env.js';

export const googleConfig = {
  placesApiKey: env.GOOGLE_PLACES_API_KEY,
  placesBaseUrl: 'https://places.googleapis.com/v1/places:searchNearby',
  placesDetailsUrl: 'https://places.googleapis.com/v1/places',
};
