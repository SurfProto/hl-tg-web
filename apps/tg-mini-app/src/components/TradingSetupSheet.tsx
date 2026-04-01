import { useEffect } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';

interface TradingSetupSheetProps {
  isOpen: boolean;
  onClose: () => void;
  setup: UseMutationResult<void, Error, void, unknown>;
  isExpired?: boolean;
}

export function TradingSetupSheet({ isOpen, onClose, setup, isExpired = false }: TradingSetupSheetProps) {
  const isPending = setup.isPending;
  const isSuccess = setup.isSuccess;
  const error = setup.error;

  useEffect(() => {
    if (!isOpen || !isSuccess) return;

    const timeout = window.setTimeout(() => {
      onClose();
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [isOpen, isSuccess, onClose]);

  if (!isOpen) return null;

  const statusLabel = (() => {
    if (isSuccess) return 'Starting trading...';
    if (!isPending) return 'Enable 1-click trading';
    return 'Setting up...';
  })();

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative mt-auto bg-white rounded-t-2xl px-4 pt-4 pb-8 animate-slide-up">
        <div className="flex justify-center mb-5">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </div>

        <h2 className="text-lg font-bold text-foreground text-center mb-2">
          {isExpired ? 'Reauthorize trading' : '1-click trading'}
        </h2>
        <p className="text-sm text-gray-500 text-center mb-6 leading-relaxed">
          {isExpired
            ? 'Your trading key has expired. Reauthorize to continue trading instantly.'
            : 'Authorize a local trading key once. All orders will sign instantly - no confirmations on every trade.'}
        </p>

        {isSuccess ? (
          <div className="flex flex-col items-center py-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-base font-bold text-foreground">All set!</p>
            <p className="text-sm text-gray-500 mt-1">You can now trade anything instantly.</p>
          </div>
        ) : (
          <div className="space-y-2.5 mb-6">
            <div className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded-xl">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-primary">1</span>
              </div>
              <span className="text-sm text-foreground">
                {isExpired ? 'Reauthorize trading key' : 'Authorize trading key'}
              </span>
            </div>
            {!isExpired && (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded-xl">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <span className="text-sm text-foreground">Enable builder fee</span>
              </div>
            )}
          </div>
        )}

        {error && !isSuccess && (
          <p className="text-xs text-center text-negative mb-3">
            {error.message ?? 'Setup failed. Please try again.'}
          </p>
        )}

        <button
          onPointerDown={() => {
            if (!isSuccess) setup.mutate();
          }}
          disabled={isPending || isSuccess}
          className="w-full py-4 rounded-xl font-semibold text-sm bg-primary text-white disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {isPending ? statusLabel : isSuccess ? statusLabel : error ? 'Retry' : isExpired ? 'Reauthorize' : 'Enable Trading'}
        </button>
      </div>
    </div>
  );
}
