import { useState, useEffect } from 'react';

export type CallPhase = 'ringing' | 'dialing' | 'connected' | 'ended' | 'error';

interface CallOverlayProps {
  pharmacyName: string;
  callPhase: CallPhase;
  callStartTime: number;
  isMuted: boolean;
  error?: string | null;
  onToggleMute: () => void;
  onHangUp: () => void;
  onMarkFound: () => void;
  onMarkNotFound: () => void;
  onAnswer?: () => void;
  onSendDigits?: (digits: string) => void;
}

const KEYPAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

export default function CallOverlay({
  pharmacyName,
  callPhase,
  callStartTime,
  isMuted,
  error,
  onToggleMute,
  onHangUp,
  onMarkFound,
  onMarkNotFound,
  onAnswer,
  onSendDigits,
}: CallOverlayProps) {
  const [elapsed, setElapsed] = useState(0);
  const [showKeypad, setShowKeypad] = useState(false);

  // Timer
  useEffect(() => {
    if (callPhase !== 'connected') return;

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - callStartTime) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [callPhase, callStartTime]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              callPhase === 'connected'
                ? 'bg-green-500 animate-pulse'
                : callPhase === 'dialing'
                  ? 'bg-yellow-500 animate-pulse'
                  : callPhase === 'ringing'
                    ? 'bg-blue-500 animate-pulse'
                    : callPhase === 'ended'
                      ? 'bg-gray-400'
                      : 'bg-red-500'
            }`}
          />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {pharmacyName}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 ml-4.5">
          {callPhase === 'ringing' && 'Ready to call'}
          {callPhase === 'dialing' && 'Connecting...'}
          {callPhase === 'connected' && formatTime(elapsed)}
          {callPhase === 'ended' && 'Call Ended'}
          {callPhase === 'error' && (error || 'Connection Error')}
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 py-3">
        {callPhase === 'ringing' && onAnswer && (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={onAnswer}
              className="px-6 py-2.5 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors text-sm font-medium animate-pulse"
            >
              Call
            </button>
            <button
              onClick={onMarkNotFound}
              className="px-4 py-2.5 bg-gray-500 text-white rounded-full hover:bg-gray-600 transition-colors text-sm font-medium"
            >
              Skip
            </button>
          </div>
        )}

        {(callPhase === 'dialing' || callPhase === 'connected') && (
          <>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onToggleMute}
                className={`p-3 rounded-full transition-colors ${
                  isMuted
                    ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                } hover:opacity-80`}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => setShowKeypad((prev) => !prev)}
                className={`p-3 rounded-full transition-colors ${
                  showKeypad
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                } hover:opacity-80`}
                aria-label="Keypad"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>

              <button
                onClick={onHangUp}
                className="px-6 py-2.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors text-sm font-medium"
              >
                Hang Up
              </button>
            </div>

            {/* DTMF Keypad */}
            {showKeypad && (
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {KEYPAD_KEYS.map((row) =>
                  row.map((key) => (
                    <button
                      key={key}
                      onClick={() => onSendDigits?.(key)}
                      className="py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-lg font-medium"
                    >
                      {key}
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {callPhase === 'ended' && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-3">
              Did they have the medication?
            </p>
            <div className="flex gap-2">
              <button
                onClick={onMarkFound}
                className="flex-1 px-3 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
              >
                Yes, Found
              </button>
              <button
                onClick={onMarkNotFound}
                className="flex-1 px-3 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                Not Available
              </button>
            </div>
          </div>
        )}

        {callPhase === 'error' && (
          <div className="text-center">
            <p className="text-sm text-red-600 dark:text-red-400 mb-2">
              {error || 'Failed to connect'}
            </p>
            <button
              onClick={onMarkNotFound}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              Skip Pharmacy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
