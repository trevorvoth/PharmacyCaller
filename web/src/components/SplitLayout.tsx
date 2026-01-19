import { type ReactNode } from 'react';

interface SplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
  leftWidth?: string;
}

export default function SplitLayout({
  left,
  right,
  leftWidth = '40%',
}: SplitLayoutProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-12rem)]">
      <div
        className="flex-shrink-0 lg:sticky lg:top-24 lg:self-start"
        style={{ width: `min(${leftWidth}, 100%)` }}
      >
        {left}
      </div>
      <div className="flex-1 min-w-0">{right}</div>
    </div>
  );
}
