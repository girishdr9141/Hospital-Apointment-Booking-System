import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  notify: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, type, message }]);
      window.setTimeout(() => {
        dismiss(id);
      }, 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2"
      >
        {toasts.map((toast) => {
          const styles =
            toast.type === 'success'
              ? 'border-emerald-200 bg-white text-slate-900'
              : toast.type === 'error'
                ? 'border-red-200 bg-white text-slate-900'
                : 'border-slate-200 bg-white text-slate-900';

          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error'
                ? AlertCircle
                : Info;

          const iconColor =
            toast.type === 'success'
              ? 'text-emerald-600'
              : toast.type === 'error'
                ? 'text-red-600'
                : 'text-teal-700';

          return (
            <div
              key={toast.id}
              role="status"
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-sm ${styles}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} aria-hidden="true" />
              <p className="flex-1 text-sm leading-snug text-slate-800">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-slate-400 transition-colors hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
