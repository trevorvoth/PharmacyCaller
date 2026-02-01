import { PHARMACY_CHAINS } from '../services/api';

interface ChainFilterProps {
  selectedChains: string[];
  onChange: (chains: string[]) => void;
}

export default function ChainFilter({ selectedChains, onChange }: ChainFilterProps) {
  const handleToggle = (chain: string) => {
    if (selectedChains.includes(chain)) {
      onChange(selectedChains.filter((c) => c !== chain));
    } else {
      onChange([...selectedChains, chain]);
    }
  };

  const handleSelectAll = () => {
    if (selectedChains.length === PHARMACY_CHAINS.length) {
      onChange([]);
    } else {
      onChange([...PHARMACY_CHAINS]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Filter by Chain
        </label>
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-xs text-primary-500 hover:text-primary-600"
        >
          {selectedChains.length === PHARMACY_CHAINS.length ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {PHARMACY_CHAINS.map((chain) => (
          <button
            key={chain}
            type="button"
            onClick={() => handleToggle(chain)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              selectedChains.includes(chain)
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-primary-500'
            }`}
          >
            {chain}
          </button>
        ))}
      </div>
      {selectedChains.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Showing only: {selectedChains.join(', ')}
        </p>
      )}
    </div>
  );
}
