interface CategoryPillsProps {
  categories: readonly string[];
  labels: Record<string, string>;
  selected: string;
  onChange: (category: string) => void;
}

export function CategoryPills({ categories, labels, selected, onChange }: CategoryPillsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onChange(cat)}
          className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selected === cat
              ? 'bg-primary text-white'
              : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          {labels[cat] ?? cat}
        </button>
      ))}
    </div>
  );
}
