interface StatRowProps {
  label: string;
  value: string;
  valueColor?: 'positive' | 'negative' | 'neutral';
  mono?: boolean;
  noBorder?: boolean;
}

export function StatRow({ label, value, valueColor = 'neutral', mono = false, noBorder = false }: StatRowProps) {
  const valueClass =
    valueColor === 'positive'
      ? 'text-positive'
      : valueColor === 'negative'
        ? 'text-negative'
        : 'text-foreground';

  const fontClass = mono ? 'font-mono tabular-nums' : '';
  const borderClass = noBorder ? '' : 'border-b border-separator';

  return (
    <div className={`flex items-center justify-between py-3.5 ${borderClass}`}>
      <span className="min-w-0 truncate mr-2 text-sm text-muted">{label}</span>
      <span className={`flex-shrink-0 text-right text-sm font-semibold ${valueClass} ${fontClass}`}>{value}</span>
    </div>
  );
}
