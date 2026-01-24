import PharmacyCard, { type PharmacyStatus } from './PharmacyCard';

export interface PharmacyItem {
  pharmacyId: string;
  pharmacyName: string;
  address: string;
  status: PharmacyStatus;
  hasMedication: boolean | null;
  callId?: string;
  distance?: number | null;
}

interface PharmacyListProps {
  pharmacies: PharmacyItem[];
  highlightedPharmacyId?: string | null;
  selectedPharmacyId?: string | null;
  onJoinCall?: (callId: string, pharmacyId: string) => void;
  onMarkNotFound?: (pharmacyId: string) => void;
  onPharmacyClick?: (pharmacyId: string) => void;
  registerRef?: (pharmacyId: string, ref: HTMLDivElement | null) => void;
}

export default function PharmacyList({
  pharmacies,
  highlightedPharmacyId,
  selectedPharmacyId,
  onJoinCall,
  onMarkNotFound,
  onPharmacyClick,
  registerRef,
}: PharmacyListProps) {
  if (pharmacies.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">No pharmacies found.</p>
      </div>
    );
  }

  // Sort: ready first, then calling, then others
  const sortedPharmacies = [...pharmacies].sort((a, b) => {
    const priority: Record<PharmacyStatus, number> = {
      ready: 0,
      connected: 1,
      calling: 2,
      on_hold: 3,
      voicemail: 4,
      pending: 5,
      completed: 6,
      failed: 7,
    };
    return priority[a.status] - priority[b.status];
  });

  return (
    <div className="space-y-3">
      {sortedPharmacies.map((pharmacy) => (
        <div
          key={pharmacy.pharmacyId}
          ref={(ref) => registerRef?.(pharmacy.pharmacyId, ref)}
          onClick={() => onPharmacyClick?.(pharmacy.pharmacyId)}
          className={`cursor-pointer transition-all duration-200 rounded-lg ${
            selectedPharmacyId === pharmacy.pharmacyId
              ? 'ring-2 ring-primary-400 ring-offset-1 dark:ring-offset-gray-900'
              : ''
          }`}
        >
          <PharmacyCard
            pharmacyName={pharmacy.pharmacyName}
            address={pharmacy.address}
            status={pharmacy.status}
            hasMedication={pharmacy.hasMedication}
            isHighlighted={pharmacy.pharmacyId === highlightedPharmacyId}
            distance={pharmacy.distance}
            onJoinCall={
              pharmacy.callId && onJoinCall
                ? () => onJoinCall(pharmacy.callId!, pharmacy.pharmacyId)
                : undefined
            }
            onMarkNotFound={
              onMarkNotFound ? () => onMarkNotFound(pharmacy.pharmacyId) : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
