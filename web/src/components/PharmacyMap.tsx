import { APIProvider, Map } from '@vis.gl/react-google-maps';
import { env, isGoogleMapsConfigured } from '../config/env';
import PharmacyMarker from './PharmacyMarker';
import UserLocationMarker from './UserLocationMarker';
import type { SearchStatus } from '../services/api';

interface PharmacyMapProps {
  pharmacies: SearchStatus['pharmacies'];
  searchLocation: { latitude: number; longitude: number };
  userLocation?: { latitude: number; longitude: number } | null;
  selectedPharmacyId?: string | null;
  onPharmacySelect?: (pharmacyId: string) => void;
  onJoinCall?: (pharmacyId: string, callId: string) => void;
  onMarkNotFound?: (pharmacyId: string) => void;
}

export default function PharmacyMap({
  pharmacies,
  searchLocation,
  userLocation,
  selectedPharmacyId,
  onPharmacySelect,
  onJoinCall,
  onMarkNotFound,
}: PharmacyMapProps) {
  if (!isGoogleMapsConfigured()) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 rounded-lg">
        <div className="text-center p-6">
          <div className="text-gray-400 dark:text-gray-500 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Map not configured. Add Google Maps API key to enable.
          </p>
        </div>
      </div>
    );
  }

  const center = userLocation
    ? { lat: userLocation.latitude, lng: userLocation.longitude }
    : { lat: searchLocation.latitude, lng: searchLocation.longitude };

  return (
    <APIProvider apiKey={env.googleMaps.apiKey!}>
      <Map
        mapId={env.googleMaps.mapId}
        defaultCenter={center}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="w-full h-full rounded-lg"
      >
        {/* User location marker */}
        {userLocation && (
          <UserLocationMarker
            position={{ lat: userLocation.latitude, lng: userLocation.longitude }}
          />
        )}

        {/* Pharmacy markers */}
        {pharmacies.map((pharmacy) => (
          <PharmacyMarker
            key={pharmacy.pharmacyId}
            pharmacy={pharmacy}
            isSelected={selectedPharmacyId === pharmacy.pharmacyId}
            onSelect={() => onPharmacySelect?.(pharmacy.pharmacyId)}
            onJoinCall={onJoinCall}
            onMarkNotFound={onMarkNotFound}
          />
        ))}
      </Map>
    </APIProvider>
  );
}
