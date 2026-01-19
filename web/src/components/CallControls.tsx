import Button from './Button';

interface CallControlsProps {
  isMuted: boolean;
  onMuteToggle: () => void;
  onEndCall: () => void;
  isEnding?: boolean;
}

export default function CallControls({
  isMuted,
  onMuteToggle,
  onEndCall,
  isEnding,
}: CallControlsProps) {
  return (
    <div className="flex items-center justify-center gap-4">
      <button
        onClick={onMuteToggle}
        className={`p-4 rounded-full transition-colors ${
          isMuted
            ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
        } hover:opacity-80`}
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
            />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
          </svg>
        )}
      </button>

      <Button
        variant="danger"
        size="lg"
        onClick={onEndCall}
        disabled={isEnding}
        className="px-8"
      >
        {isEnding ? 'Ending...' : 'End Call'}
      </Button>
    </div>
  );
}
