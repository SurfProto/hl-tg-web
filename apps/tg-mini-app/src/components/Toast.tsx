import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  add: (message: string, type: ToastType) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const DISMISS_DELAY: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  error: 5000,
};

const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((message: string, type: ToastType) => {
    const id = String(++counterRef.current);
    setToasts((prev) => {
      const next = [...prev, { id, message, type }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    setTimeout(() => dismiss(id), DISMISS_DELAY[type]);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ add }}>
      {children}
      <div
        className="fixed toast-above-bottom-nav left-0 right-0 z-50 flex flex-col gap-2 px-4 pointer-events-none"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const borderColor = toast.type === 'success'
    ? 'border-positive'
    : toast.type === 'error'
      ? 'border-negative'
      : 'border-primary';

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      onClick={() => onDismiss(toast.id)}
      style={{
        transition: 'opacity 200ms ease, transform 200ms ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
      }}
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border-l-4 bg-white px-4 py-3 shadow-lg ${borderColor}`}
    >
      <ToastIcon type={toast.type} />
      <p className="flex-1 text-sm font-medium text-foreground">{toast.message}</p>
    </div>
  );
}

function ToastIcon({ type }: { type: ToastType }) {
  if (type === 'success') {
    return (
      <svg className="mt-0.5 h-4 w-4 flex-none text-positive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg className="mt-0.5 h-4 w-4 flex-none text-negative" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return (
    <svg className="mt-0.5 h-4 w-4 flex-none text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return {
    success: (message: string) => context.add(message, 'success'),
    error: (message: string) => context.add(message, 'error'),
    info: (message: string) => context.add(message, 'info'),
  };
}
