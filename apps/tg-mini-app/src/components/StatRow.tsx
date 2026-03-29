interface StatRowProps {
  label: string;
  value: string;
  valueColor?: 'positive' | 'negative' | 'neutral';
}

export function StatRow({ label, value, valueColor = 'neutral' }: StatRowProps) {
  const valueClass =
    valueColor === 'positive'
      ? 'text-positive'
      : valueColor === 'negative'
        ? 'text-negative'
        : 'text-foreground';

  return (
    <div className="flex items-center justify-between py-3 border-b border-separator last:border-b-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
