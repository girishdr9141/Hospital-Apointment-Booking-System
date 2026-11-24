import type { AuditLogCategory, ConsultationMode, RbacAuditLogEntry } from '../types/opd';

export type AuditLogCategoryFilter = 'ALL' | AuditLogCategory;

export const ALL_AUDIT_CATEGORIES: AuditLogCategoryFilter[] = [
  'ALL',
  'AUTH',
  'APPOINTMENTS',
  'SHIFTS_LEAVES',
  'BILLING',
  'CLINICAL',
  'OPERATIONS',
  'USER',
  'ROLE',
  'PERMISSION',
  'SECURITY',
];

const AUDIT_CATEGORY_LABELS: Record<AuditLogCategoryFilter, string> = {
  ALL: 'All Categories',
  AUTH: 'Auth & Sessions',
  APPOINTMENTS: 'Appointments & Holds',
  SHIFTS_LEAVES: 'Shifts & Leaves',
  BILLING: 'Payments & Refunds',
  CLINICAL: 'Clinical & Outcomes',
  OPERATIONS: 'Queue & Directory',
  USER: 'User Accounts',
  ROLE: 'Roles',
  PERMISSION: 'Permissions',
  SECURITY: 'Security & Blocks',
};

export function getAuditCategoryLabel(category: AuditLogCategoryFilter): string {
  return AUDIT_CATEGORY_LABELS[category] || category;
}

export function filterAuditLogs(
  logs: RbacAuditLogEntry[],
  categoryFilter: AuditLogCategoryFilter,
  searchQuery: string,
): RbacAuditLogEntry[] {
  const q = searchQuery.trim().toLowerCase();
  return logs.filter((entry) => {
    if (categoryFilter !== 'ALL' && entry.category !== categoryFilter) {
      return false;
    }
    if (!q) return true;
    return (
      entry.action.toLowerCase().includes(q) ||
      entry.actor_name.toLowerCase().includes(q) ||
      (entry.actor_email || '').toLowerCase().includes(q) ||
      entry.actor_role.toLowerCase().includes(q) ||
      (entry.target_label || '').toLowerCase().includes(q) ||
      (entry.previous_value || '').toLowerCase().includes(q) ||
      (entry.new_value || '').toLowerCase().includes(q) ||
      entry.details.toLowerCase().includes(q)
    );
  });
}

export function formatAuditActorLabel(entry: Pick<RbacAuditLogEntry, 'actor_name' | 'actor_role' | 'actor_email'>): string {
  const emailPart = entry.actor_email ? ` · ${entry.actor_email}` : '';
  return `${entry.actor_name} (${entry.actor_role})${emailPart}`;
}

export function describeBookingAuditDetails(params: {
  actorName: string;
  actorRole: string;
  appointmentRef: string;
  patientName: string;
  doctorName?: string | null;
  slotDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  bookingSource: string;
  consultationMode: ConsultationMode;
  initialStatus: string;
  rescheduledFromId?: number | null;
}): string {
  const slotWindow = [params.slotDate, params.startTime && params.endTime ? `${params.startTime}-${params.endTime}` : params.startTime]
    .filter(Boolean)
    .join(' ');
  const doctorSegment = params.doctorName ? ` with ${params.doctorName}` : '';
  const windowSegment = slotWindow ? ` for ${slotWindow}` : '';
  const reschedSegment = params.rescheduledFromId ? ` (rescheduled from #${params.rescheduledFromId})` : '';
  const holdSegment =
    params.initialStatus === 'HELD'
      ? 'Status: HELD (10-min unpaid hold awaiting payment/confirmation).'
      : `Status: ${params.initialStatus}.`;

  return `${params.actorName} (${params.actorRole}) booked ${params.appointmentRef} for ${params.patientName}${doctorSegment}${windowSegment} [${params.bookingSource}, ${params.consultationMode}]${reschedSegment}. ${holdSegment}`;
}

export function describeCancellationAuditDetails(params: {
  actorName: string;
  actorRole: string;
  appointmentRef: string;
  patientName?: string | null;
  doctorName?: string | null;
  slotDate?: string | null;
  startTime?: string | null;
  previousStatus: string;
  paidAmount: number;
  refundStatus?: 'REFUND_PENDING' | 'REFUNDED' | 'NO_REFUND' | null;
  refundAmount?: number;
  refundPercentage?: number;
  ruleName?: string | null;
}): string {
  const whoCancelled = `Cancelled by ${params.actorName} (${params.actorRole})`;
  const patientPart = params.patientName ? ` · Patient: ${params.patientName}` : '';
  const docPart = params.doctorName ? ` · ${params.doctorName}` : '';
  const slotPart = [params.slotDate, params.startTime].filter(Boolean).join(' ');
  const whenPart = slotPart ? ` (${slotPart})` : '';

  if (params.paidAmount > 0) {
    const refundSummary =
      params.refundStatus === 'REFUND_PENDING'
        ? `Paid ₹${params.paidAmount.toFixed(2)}; refund ₹${Number(params.refundAmount || 0).toFixed(2)} (${params.refundPercentage ?? 0}% via ${params.ruleName || 'policy'}) scheduled within 2 hours.`
        : `Paid ₹${params.paidAmount.toFixed(2)}; 0% refund per ${params.ruleName || 'cancellation policy'}.`;
    return `${whoCancelled}: ${params.appointmentRef}${patientPart}${docPart}${whenPart} [was ${params.previousStatus}]. ${refundSummary}`;
  }

  return `${whoCancelled}: ${params.appointmentRef}${patientPart}${docPart}${whenPart} [was ${params.previousStatus}]. Unpaid booking cancelled and slot released.`;
}
