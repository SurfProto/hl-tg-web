import { useHaptics } from '../hooks/useHaptics';

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}

/**
 * One control for choosing between a small, fixed set of views.
 *
 * Positions and the order screen were doing the same thing two ways —
 * scrollable pills on one, a segmented track on the other — so the same kind
 * of choice looked like two different kinds of control. Home keeps its pills:
 * filtering an open-ended, horizontally scrollable list is a different job,
 * and pills say "there may be more" where a segmented track says "these are
 * all of them".
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  const haptics = useHaptics();

  return (
    <div role="tablist" aria-label={label} className="flex rounded-xl bg-surface p-1">
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) {
                haptics.selection();
              }

              onChange(option.value);
            }}
            // capitalize compensates for lowercase source strings: the order-type
            // labels are "market" and "limit" in both locales, and the markup this
            // replaced carried the same class. Sentence-case values would be the
            // real fix.
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold capitalize transition-colors ${
              selected ? 'bg-white text-primary' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
