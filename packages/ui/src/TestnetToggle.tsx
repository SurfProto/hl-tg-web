import React from 'react';

interface TestnetToggleProps {
  isTestnet: boolean;
  onToggle: (isTestnet: boolean) => void;
}

export function TestnetToggle({ isTestnet, onToggle }: TestnetToggleProps) {
  return (
    <div className="flex items-center space-x-3">
      <span className="text-sm text-gray-400">Network:</span>
      <button
        onClick={() => onToggle(false)}
        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
          !isTestnet
            ? 'bg-green-600 text-white'
            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
        }`}
      >
        Mainnet
      </button>
      <button
        onClick={() => onToggle(true)}
        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
          isTestnet
            ? 'bg-yellow-600 text-white'
            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
        }`}
      >
        Testnet
      </button>
      {isTestnet && (
        <span className="text-xs text-yellow-500 animate-pulse">
          ⚠️ Test funds only
        </span>
      )}
    </div>
  );
}
