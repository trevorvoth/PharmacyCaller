import Button from './Button';

interface CallSummaryProps {
  pharmacyName: string;
  duration: number;
  onMarkFound: () => void;
  onMarkNotAvailable: () => void;
  onSkip: () => void;
  isLoading?: boolean;
}

export default function CallSummary({
  pharmacyName,
  duration,
  onMarkFound,
  onMarkNotAvailable,
  onSkip,
  isLoading,
}: CallSummaryProps) {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-8 max-w-md mx-auto text-center">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Call Ended
        </h2>
        <p className="text-lg text-gray-700 dark:text-gray-300">{pharmacyName}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Duration: {formatDuration(duration)}
        </p>
      </div>

      <div className="mb-6">
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Did they have the medication?
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="primary"
            onClick={onMarkFound}
            disabled={isLoading}
            className="flex-1 sm:flex-initial"
          >
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Yes, Mark Found
          </Button>
          <Button
            variant="secondary"
            onClick={onMarkNotAvailable}
            disabled={isLoading}
            className="flex-1 sm:flex-initial"
          >
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Not Available
          </Button>
        </div>
      </div>

      <button
        onClick={onSkip}
        disabled={isLoading}
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        Skip - Return to Search
      </button>
    </div>
  );
}
