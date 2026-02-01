import PharmacyCard, { type PharmacyStatus, type PhoneSource } from './PharmacyCard';

export interface PharmacyItem {
  pharmacyId: string;
  pharmacyName: string;
  address: string;
  phone?: string;
  phoneSource?: PhoneSource;
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

  // Sort: ready first, then calling, then others - and by distance within each group
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
    const statusDiff = priority[a.status] - priority[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    // Within same status, sort by distance (closest first)
    return (a.distance ?? Infinity) - (b.distance ?? Infinity);
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
            phone={pharmacy.phone}
            phoneSource={pharmacy.phoneSource}
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
