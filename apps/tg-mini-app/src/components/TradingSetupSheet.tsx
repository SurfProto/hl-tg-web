import type { UseMutationResult } from '@tanstack/react-query';

interface TradingSetupSheetProps {
  isOpen: boolean;
  setup: UseMutationResult<void, Error, void, unknown>;
}

export function TradingSetupSheet({ isOpen, setup }: TradingSetupSheetProps) {
  if (!isOpen) return null;

  const isPending = setup.isPending;
  const error = setup.error;

  const statusLabel = (() => {
    if (!isPending) return 'Enable 1-click trading';
    // Approximate step from error state; mutations run sequentially
    return 'Setting up...';
  })();

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop (non-dismissable — user must complete setup) */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Sheet panel */}
      <div className="relative mt-auto bg-white rounded-t-2xl px-4 pt-4 pb-8 animate-slide-up">
        {/* Drag handle */}
        <div className="flex justify-center mb-5">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </div>

        <h2 className="text-lg font-bold text-foreground text-center mb-2">1-click trading</h2>
        <p className="text-sm text-gray-500 text-center mb-6 leading-relaxed">
          Authorize a local trading key once. All orders will sign instantly — no confirmations on every trade.
        </p>

        {/* Steps */}
        <div className="space-y-2.5 mb-6">
          <div className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded-xl">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary">1</span>
            </div>
            <span className="text-sm text-foreground">Authorize trading key</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded-xl">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary">2</span>
            </div>
            <span className="text-sm text-foreground">Enable builder fee</span>
          </div>
        </div>

        {error && (
          <p className="text-xs text-center text-negative mb-3">
            {error.message ?? 'Setup failed. Please try again.'}
          </p>
        )}

        <button
          onPointerDown={() => setup.mutate()}
          disabled={isPending}
          className="w-full py-4 rounded-xl font-semibold text-sm bg-primary text-white disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {isPending ? statusLabel : error ? 'Retry' : 'Enable Trading'}
        </button>
      </div>
    </div>
  );
}
