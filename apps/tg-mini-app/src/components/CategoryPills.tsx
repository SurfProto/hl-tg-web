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
            className={`editorial-chip flex-shrink-0 ${
              isSelected
                ? 'editorial-chip-active'
                : ''
            }`}
          >
            {labels[cat] ?? cat}
          </button>
        );
      })}
    </div>
  );
}
