import { useState, type ReactNode } from 'react';

interface MapListLayoutProps {
  map: ReactNode;
  list: ReactNode;
  defaultCollapsed?: boolean;
}

export default function MapListLayout({
  map,
  list,
  defaultCollapsed = false,
}: MapListLayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className="relative flex h-[calc(100vh-16rem)] min-h-[400px] gap-0 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
      {/* Map section */}
      <div
        className={`relative transition-all duration-300 ease-in-out ${
          isCollapsed ? 'flex-1' : 'flex-1 lg:flex-[2]'
        }`}
      >
        {map}

        {/* Collapse/expand button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute top-4 right-4 z-10 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          title={isCollapsed ? 'Show list' : 'Hide list'}
        >
          {isCollapsed ? (
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          )}
        </button>
      </div>

      {/* List panel */}
      <div
        className={`bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 ease-in-out overflow-hidden ${
          isCollapsed
            ? 'w-0 opacity-0'
            : 'w-full lg:w-[350px] xl:w-[400px] opacity-100'
        }`}
      >
        <div className="h-full overflow-y-auto p-4">
          {list}
        </div>
      </div>
    </div>
  );
}
