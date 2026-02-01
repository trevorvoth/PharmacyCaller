/**
 * Frontend environment configuration
 * Environment variables must be prefixed with VITE_ to be exposed to the client
 */

export const env = {
  // Google Maps configuration
  googleMaps: {
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
    mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined,
  },
} as const;

/**
 * Check if Google Maps is properly configured
 */
export function isGoogleMapsConfigured(): boolean {
  return Boolean(env.googleMaps.apiKey && env.googleMaps.mapId);
}
