import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: 'md' | 'lg' | 'xl' | '2xl';
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  maxWidth = 'lg',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass =
    maxWidth === 'md'
      ? 'max-w-md'
      : maxWidth === 'xl'
        ? 'max-w-2xl'
        : maxWidth === '2xl'
          ? 'max-w-5xl'
          : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className={`max-h-[90vh] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl ${widthClass}`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
