import { useState, useEffect } from 'react';

interface CallTimerProps {
  startTime: number;
  isActive: boolean;
}

export default function CallTimer({ startTime, isActive }: CallTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime, isActive]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="text-4xl font-mono font-light text-gray-900 dark:text-gray-100 tabular-nums">
      {formatTime(elapsed)}
    </div>
  );
}
