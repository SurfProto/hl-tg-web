export function MarketListItemSkeleton() {
  return (
    <div className="w-full flex items-center gap-3 px-4 py-3 bg-white animate-pulse">
      <div className="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3.5 w-20 rounded bg-gray-200" />
        <div className="h-3 w-14 rounded bg-gray-100" />
      </div>
      <div className="text-right flex-shrink-0 space-y-1.5">
        <div className="h-3.5 w-16 rounded bg-gray-200 ml-auto" />
        <div className="h-3 w-10 rounded bg-gray-100 ml-auto" />
      </div>
    </div>
  );
}
