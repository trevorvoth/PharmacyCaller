import { type ReactNode } from 'react';

export type PharmacyStatus =
  | 'pending'
  | 'calling'
  | 'on_hold'
  | 'ready'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'voicemail';

interface PharmacyCardProps {
  pharmacyName: string;
  address: string;
  status: PharmacyStatus;
  hasMedication?: boolean | null;
  isHighlighted?: boolean;
  onJoinCall?: () => void;
  onMarkNotFound?: () => void;
  children?: ReactNode;
}

const statusConfig: Record<PharmacyStatus, { label: string; color: string; bgColor: string }> = {
  pending: {
    label: 'Pending',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
  },
  calling: {
    label: 'Calling',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950',
  },
  on_hold: {
    label: 'On Hold',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
  },
  ready: {
    label: 'Ready to Talk',
    color: 'text-primary-600 dark:text-primary-400',
    bgColor: 'bg-primary-50 dark:bg-primary-950',
  },
  connected: {
    label: 'Connected',
    color: 'text-primary-600 dark:text-primary-400',
    bgColor: 'bg-primary-50 dark:bg-primary-950',
  },
  completed: {
    label: 'Completed',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
  },
  failed: {
    label: 'Failed',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950',
  },
  voicemail: {
    label: 'Voicemail',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-950',
  },
};

export default function PharmacyCard({
  pharmacyName,
  address,
  status,
  hasMedication,
  isHighlighted,
  onJoinCall,
  onMarkNotFound,
}: PharmacyCardProps) {
  const config = statusConfig[status];
  const isReady = status === 'ready';
  const showActions = isReady || status === 'connected';

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-lg p-4 transition-all duration-300 ${
        isHighlighted
          ? 'ring-2 ring-primary-500 ring-offset-2 dark:ring-offset-gray-950'
          : ''
      } ${isReady ? 'animate-pulse-subtle' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
              {pharmacyName}
            </h3>
            {hasMedication === true && (
              <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium text-primary-600 bg-primary-50 dark:bg-primary-950 dark:text-primary-400 rounded-full">
                Has Medication
              </span>
            )}
            {hasMedication === false && (
              <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-full">
                Not Available
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{address}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${config.color} ${config.bgColor}`}>
            {config.label}
          </span>
        </div>
      </div>

      {showActions && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
          {isReady && onJoinCall && (
            <button
              onClick={onJoinCall}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-primary-500 rounded-md hover:bg-primary-600 transition-colors"
            >
              Join Call
            </button>
          )}
          {status === 'connected' && onMarkNotFound && (
            <button
              onClick={onMarkNotFound}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Not Available
            </button>
          )}
        </div>
      )}
    </div>
  );
}
