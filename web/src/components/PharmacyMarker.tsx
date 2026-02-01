import { useState, useCallback } from 'react';
import { AdvancedMarker, useAdvancedMarkerRef } from '@vis.gl/react-google-maps';
import PharmacyInfoWindow from './PharmacyInfoWindow';
import type { SearchStatus } from '../services/api';
import type { PharmacyStatus } from './PharmacyCard';

type Pharmacy = SearchStatus['pharmacies'][number];

interface PharmacyMarkerProps {
  pharmacy: Pharmacy;
  isSelected?: boolean;
  onSelect?: () => void;
  onJoinCall?: (pharmacyId: string, callId: string) => void;
  onMarkNotFound?: (pharmacyId: string) => void;
}

// Map status to marker colors (matching PharmacyCard)
const statusColors: Record<PharmacyStatus, { bg: string; border: string; glow?: string }> = {
  pending: { bg: '#9CA3AF', border: '#6B7280' }, // gray
  calling: { bg: '#F59E0B', border: '#D97706', glow: '#FCD34D' }, // amber
  on_hold: { bg: '#3B82F6', border: '#2563EB', glow: '#93C5FD' }, // blue
  ready: { bg: '#10B981', border: '#059669', glow: '#6EE7B7' }, // green (primary)
  connected: { bg: '#10B981', border: '#059669', glow: '#6EE7B7' }, // green
  completed: { bg: '#6B7280', border: '#4B5563' }, // dark gray
  failed: { bg: '#EF4444', border: '#DC2626' }, // red
  voicemail: { bg: '#8B5CF6', border: '#7C3AED' }, // purple
};

export default function PharmacyMarker({
  pharmacy,
  isSelected,
  onSelect,
  onJoinCall,
  onMarkNotFound,
}: PharmacyMarkerProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [isInfoWindowOpen, setIsInfoWindowOpen] = useState(false);

  const status = pharmacy.status as PharmacyStatus;
  const colors = statusColors[status] || statusColors.pending;
  const isReady = status === 'ready';
  const isActive = status === 'calling' || status === 'on_hold' || status === 'ready' || status === 'connected';

  const handleClick = useCallback(() => {
    setIsInfoWindowOpen(true);
    onSelect?.();
  }, [onSelect]);

  const handleClose = useCallback(() => {
    setIsInfoWindowOpen(false);
  }, []);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: pharmacy.latitude, lng: pharmacy.longitude }}
        onClick={handleClick}
        zIndex={isSelected ? 100 : isReady ? 50 : 1}
      >
        {/* Custom marker pin */}
        <div className="relative">
          {/* Glow effect for active calls */}
          {isActive && colors.glow && (
            <div
              className="absolute inset-0 rounded-full animate-ping"
              style={{
                backgroundColor: colors.glow,
                opacity: 0.4,
                transform: 'scale(1.5)',
              }}
            />
          )}

          {/* Pin body */}
          <div
            className={`relative flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-transform ${
              isSelected ? 'scale-125' : 'hover:scale-110'
            }`}
            style={{
              backgroundColor: colors.bg,
              borderWidth: 3,
              borderColor: colors.border,
              borderStyle: 'solid',
            }}
          >
            {/* Medication found indicator */}
            {pharmacy.hasMedication === true && (
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
            {/* Not available indicator */}
            {pharmacy.hasMedication === false && (
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            )}
          </div>

          {/* Pin tail */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              top: '28px',
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: `8px solid ${colors.border}`,
            }}
          />
        </div>
      </AdvancedMarker>

      {/* Info window */}
      {isInfoWindowOpen && marker && (
        <PharmacyInfoWindow
          pharmacy={pharmacy}
          anchor={marker}
          onClose={handleClose}
          onJoinCall={onJoinCall}
          onMarkNotFound={onMarkNotFound}
        />
      )}
    </>
  );
}
