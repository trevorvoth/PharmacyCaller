interface AiMenuAssistantToggleProps {
  isEnabled: boolean;
  onChange: (enabled: boolean) => void;
}

export default function AiMenuAssistantToggle({ isEnabled, onChange }: AiMenuAssistantToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          AI Menu Assistant
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Let AI navigate phone menus and wait on hold for you
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isEnabled}
        onClick={() => onChange(!isEnabled)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          isEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            isEnabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
