import PharmacyCard, { type PharmacyStatus } from './PharmacyCard';

export interface PharmacyItem {
  pharmacyId: string;
  pharmacyName: string;
  address: string;
  status: PharmacyStatus;
  hasMedication: boolean | null;
  callId?: string;
}

interface PharmacyListProps {
  pharmacies: PharmacyItem[];
  highlightedPharmacyId?: string | null;
  onJoinCall?: (callId: string, pharmacyId: string) => void;
  onMarkNotFound?: (pharmacyId: string) => void;
}

export default function PharmacyList({
  pharmacies,
  highlightedPharmacyId,
  onJoinCall,
  onMarkNotFound,
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
        <PharmacyCard
          key={pharmacy.pharmacyId}
          pharmacyName={pharmacy.pharmacyName}
          address={pharmacy.address}
          status={pharmacy.status}
          hasMedication={pharmacy.hasMedication}
          isHighlighted={pharmacy.pharmacyId === highlightedPharmacyId}
          onJoinCall={
            pharmacy.callId && onJoinCall
              ? () => onJoinCall(pharmacy.callId!, pharmacy.pharmacyId)
              : undefined
          }
          onMarkNotFound={
            onMarkNotFound ? () => onMarkNotFound(pharmacy.pharmacyId) : undefined
          }
        />
      ))}
    </div>
  );
}
