import { useContext } from 'react';
import { ToastContext } from '../components/Toast';

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return {
    success: (message: string) => ctx.add(message, 'success'),
    error: (message: string) => ctx.add(message, 'error'),
    info: (message: string) => ctx.add(message, 'info'),
  };
}
