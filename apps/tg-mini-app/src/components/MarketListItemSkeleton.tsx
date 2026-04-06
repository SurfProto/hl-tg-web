export function MarketListItemSkeleton() {
  return (
    <div className="w-full flex items-center gap-3 px-4 py-3 bg-white animate-pulse">
      <div className="h-9 w-9 rounded-full bg-gray-200 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-5 w-11 rounded-full bg-gray-100" />
        </div>
        <div className="mt-1.5 h-3 w-16 rounded bg-gray-100" />
      </div>

      <div className="text-right flex-shrink-0">
        <div className="h-4 w-16 rounded bg-gray-200 ml-auto" />
        <div className="mt-1.5 h-3 w-12 rounded bg-gray-100 ml-auto" />
      </div>
    </div>
  );
}
