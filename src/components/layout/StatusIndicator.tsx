import { CheckCircle2, Clock, XCircle } from 'lucide-react';

interface StatusIndicatorProps {
  status?: string | null;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const normalized = (status || 'UNKNOWN').toUpperCase();

  if (
    normalized === 'CONFIRMED' ||
    normalized === 'AVAILABLE' ||
    normalized === 'COMPLETED' ||
    normalized === 'SUCCESS' ||
    normalized === 'APPROVED' ||
    normalized === 'DONE' ||
    normalized === 'ACTIVE'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{normalized.replaceAll('_', ' ')}</span>
      </span>
    );
  }

  if (
    normalized === 'HELD' ||
    normalized === 'PENDING' ||
    normalized === 'WAITING' ||
    normalized === 'IN_CONSULTATION' ||
    normalized === 'SUBMITTED'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{normalized.replaceAll('_', ' ')}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
      <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{normalized.replaceAll('_', ' ')}</span>
    </span>
  );
}
