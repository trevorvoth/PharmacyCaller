import { InfoWindow } from '@vis.gl/react-google-maps';
import type { SearchStatus } from '../services/api';
import type { PharmacyStatus } from './PharmacyCard';

type Pharmacy = SearchStatus['pharmacies'][number];

interface PharmacyInfoWindowProps {
  pharmacy: Pharmacy;
  anchor: google.maps.marker.AdvancedMarkerElement;
  onClose: () => void;
  onJoinCall?: (pharmacyId: string, callId: string) => void;
  onMarkNotFound?: (pharmacyId: string) => void;
}

const statusLabels: Record<PharmacyStatus, string> = {
  pending: 'Pending',
  dialing: 'Dialing...',
  calling: 'Calling...',
  ivr: 'Navigating Menu...',
  on_hold: 'On Hold',
  ready: 'Ready to Talk',
  connected: 'Connected',
  completed: 'Completed',
  failed: 'Failed',
  voicemail: 'Voicemail',
};

const statusColors: Record<PharmacyStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  dialing: 'bg-amber-100 text-amber-700',
  calling: 'bg-amber-100 text-amber-700',
  ivr: 'bg-cyan-100 text-cyan-700',
  on_hold: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  connected: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-700',
  voicemail: 'bg-purple-100 text-purple-700',
};

export default function PharmacyInfoWindow({
  pharmacy,
  anchor,
  onClose,
  onJoinCall,
  onMarkNotFound,
}: PharmacyInfoWindowProps) {
  const status = pharmacy.status as PharmacyStatus;
  const isReady = status === 'ready';
  const isConnected = status === 'connected';
  const showActions = (isReady || isConnected) && pharmacy.hasMedication !== false;

  return (
    <InfoWindow anchor={anchor} onCloseClick={onClose}>
      <div className="p-1 min-w-[200px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight">
            {pharmacy.pharmacyName}
          </h3>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${statusColors[status]}`}>
            {statusLabels[status]}
          </span>
        </div>

        {/* Address */}
        <p className="text-xs text-gray-500 mb-2">{pharmacy.address}</p>

        {/* Medication status */}
        {pharmacy.hasMedication === true && (
          <div className="flex items-center gap-1 text-xs text-green-600 mb-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Has medication</span>
          </div>
        )}
        {pharmacy.hasMedication === false && (
          <div className="flex items-center gap-1 text-xs text-red-600 mb-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Not available</span>
          </div>
        )}

        {/* Action buttons */}
        {showActions && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
            {isReady && pharmacy.callId && onJoinCall && (
              <button
                onClick={() => onJoinCall(pharmacy.pharmacyId, pharmacy.callId!)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-green-500 rounded hover:bg-green-600 transition-colors"
              >
                Join Call
              </button>
            )}
            {isConnected && onMarkNotFound && (
              <button
                onClick={() => onMarkNotFound(pharmacy.pharmacyId)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
              >
                Not Available
              </button>
            )}
          </div>
        )}
      </div>
    </InfoWindow>
  );
}
