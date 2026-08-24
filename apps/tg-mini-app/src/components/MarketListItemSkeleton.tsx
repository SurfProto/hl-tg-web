/**
 * Placeholder for one MarketListItem.
 *
 * The shapes below mirror that row's geometry rather than approximating it,
 * because any difference is multiplied by however many rows are on screen. The
 * row's height comes from its right-hand column — price at 24px, change at
 * 16px, 2px between them — so that column is matched exactly. The 56x24
 * sparkline was missing here altogether, which is most of why the two differed.
 */
export function MarketListItemSkeleton() {
  return (
    <div className="w-full flex items-center gap-3 px-4 py-3.5 bg-white animate-pulse">
      <div className="h-9 w-9 rounded-full bg-surface flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="h-5 w-24 rounded bg-surface" />
          <div className="h-5 w-9 rounded-full bg-surface/60" />
        </div>
        <div className="mt-1 h-3 w-16 rounded bg-surface/60" />
      </div>

      <div className="h-6 w-14 rounded bg-surface/60 flex-shrink-0" />

      <div className="text-right flex-shrink-0 min-w-[72px]">
        <div className="h-6 w-20 rounded bg-surface ml-auto" />
        <div className="mt-0.5 h-4 w-12 rounded bg-surface/60 ml-auto" />
      </div>
    </div>
  );
}
