import { useTranslation } from 'react-i18next';
import { useHaptics } from '../hooks/useHaptics';

interface NumPadProps {
  value: string;
  onChange: (value: string) => void;
  maxDecimals?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '\u232b'] as const;

export function NumPad({ value, onChange, maxDecimals = 2 }: NumPadProps) {
  const haptics = useHaptics();
  const { t } = useTranslation();

  const handleKey = (key: string) => {
    haptics.selection();

    if (key === '\u232b') {
      onChange(value.slice(0, -1));
      return;
    }

    if (key === '.' && value.includes('.')) return;

    if (value.includes('.')) {
      const decimals = value.split('.')[1] ?? '';
      if (decimals.length >= maxDecimals) return;
    }

    if (key !== '.' && value === '0') {
      onChange(key);
      return;
    }

    onChange(value + key);
  };

  return (
    <div className="grid grid-cols-3 gap-1 px-2">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => handleKey(key)}
          aria-label={
            key === '\u232b'
              ? t('numPad.delete')
              : t('numPad.enterKey', { key })
          }
          className="flex items-center justify-center min-h-[56px] rounded-xl bg-gray-50 active:bg-gray-200 transition-colors select-none"
        >
          {key === '\u232b' ? (
            <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
            </svg>
          ) : (
            <span className="text-2xl font-bold text-foreground">{key}</span>
          )}
        </button>
      ))}
    </div>
  );
}
