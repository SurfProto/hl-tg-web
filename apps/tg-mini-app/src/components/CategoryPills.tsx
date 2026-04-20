interface CategoryPillsProps {
  categories: readonly string[];
  labels: Record<string, string>;
  selected: string;
  onChange: (category: string) => void;
}

export function CategoryPills({ categories, labels, selected, onChange }: CategoryPillsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
      {categories.map((cat) => {
        const isSelected = selected === cat;
        return (
          <button
            key={cat}
            onClick={() => onChange(cat)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              isSelected
                ? 'bg-secondary text-white'
                : 'bg-surface text-muted'
            }`}
          >
            {labels[cat] ?? cat}
          </button>
        );
      })}
    </div>
  );
}
