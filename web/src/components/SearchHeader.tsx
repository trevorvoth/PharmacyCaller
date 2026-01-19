import Button from './Button';

type SearchStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

interface SearchHeaderProps {
  medicationQuery: string;
  status: SearchStatus;
  activeCalls: number;
  readyCalls: number;
  totalPharmacies: number;
  onCancel?: () => void;
  onMarkFound?: () => void;
}

export default function SearchHeader({
  medicationQuery,
  status,
  activeCalls,
  readyCalls,
  totalPharmacies,
  onCancel,
  onMarkFound,
}: SearchHeaderProps) {
  const isActive = status === 'ACTIVE';

  const statusConfig = {
    ACTIVE: {
      label: 'In Progress',
      color: 'text-primary-600 dark:text-primary-400',
      bgColor: 'bg-primary-50 dark:bg-primary-950',
    },
    COMPLETED: {
      label: 'Completed',
      color: 'text-gray-600 dark:text-gray-400',
      bgColor: 'bg-gray-100 dark:bg-gray-800',
    },
    CANCELLED: {
      label: 'Cancelled',
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-950',
    },
  };

  const config = statusConfig[status];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {medicationQuery}
            </h1>
            <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${config.color} ${config.bgColor}`}>
              {config.label}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
            <span>{totalPharmacies} pharmacies</span>
            {isActive && (
              <>
                <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                <span>{activeCalls} calling</span>
                {readyCalls > 0 && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                    <span className="text-primary-500 font-medium">{readyCalls} ready</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {isActive && (
          <div className="flex items-center gap-2">
            {onMarkFound && (
              <Button variant="primary" onClick={onMarkFound}>
                Mark Found
              </Button>
            )}
            {onCancel && (
              <Button variant="secondary" onClick={onCancel}>
                Cancel Search
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
