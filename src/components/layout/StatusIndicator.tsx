import { CheckCircle2, Clock, UserCheck, Video, XCircle } from 'lucide-react';
import type { ConsultationMode } from '../../types/opd';

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

export function ConsultationModeBadge({ mode }: { mode?: ConsultationMode | string | null }) {
  const normalized = String(mode || 'FACE_TO_FACE').trim().toUpperCase();
  if (normalized === 'ONLINE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-sky-200 bg-sky-50 text-sky-800 text-xs font-semibold rounded-sm whitespace-nowrap">
        <Video className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden="true" />
        <span>Online Consultation</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-teal-200 bg-teal-50 text-teal-800 text-xs font-semibold rounded-sm whitespace-nowrap">
      <UserCheck className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
      <span>Face-to-Face</span>
    </span>
  );
}
