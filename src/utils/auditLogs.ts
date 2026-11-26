import type {
  AuditLogCategory,
  AuditLogRecord,
  ConsultationMode,
  RbacAuditLogEntry,
} from '../types/opd';

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

export interface OracleAuditLogPayload {
  user_id: number | null;
  action_name: string;
  table_name: string;
  record_id: string | null;
  action_description: string;
}

export function inferOracleAuditTableName(entry: Pick<RbacAuditLogEntry, 'action' | 'category'>): string {
  const action = String(entry.action || '').toUpperCase();
  if (action.startsWith('SHIFT_WINDOW')) return 'GIRISH_DOCTOR_SHIFT_WINDOWS';
  if (action.startsWith('SHIFT_CHANGE')) return 'GIRISH_SHIFT_CHANGE_REQUESTS';
  if (action.startsWith('LEAVE_REQUEST')) return 'GIRISH_DOCTOR_LEAVES';
  if (action.startsWith('SLOT')) return 'GIRISH_SLOTS';
  if (action.startsWith('MEDICAL_RECORD')) return 'GIRISH_MEDICAL_RECORDS';
  if (action.startsWith('PRESCRIPTION')) return 'GIRISH_PRESCRIPTIONS';
  if (action.startsWith('TOKEN_')) return 'GIRISH_TOKEN_QUEUE';
  if (action.startsWith('CANCELLATION_RULE')) return 'GIRISH_CANCELLATION_RULES';
  if (action.startsWith('PAYMENT_') || action.startsWith('REFUND_') || action.includes('PAID')) {
    return 'GIRISH_PAYMENTS';
  }
  if (action.startsWith('APPOINTMENT_')) return 'GIRISH_APPOINTMENTS';
  if (action.startsWith('PATIENT_')) return 'GIRISH_PATIENTS';
  if (action.startsWith('DOCTOR_')) return 'GIRISH_DOCTORS';
  if (action.startsWith('DEPARTMENT_')) return 'GIRISH_DEPARTMENTS';
  if (action.startsWith('CONSULTATION_TYPE')) return 'GIRISH_CONSULTATION_TYPES';
  if (action.startsWith('ROLE_')) return 'GIRISH_ROLES';
  if (action.startsWith('PERMISSION_') || action.startsWith('RBAC_')) return 'GIRISH_PERMISSIONS';

  switch (entry.category) {
    case 'APPOINTMENTS':
      return 'GIRISH_APPOINTMENTS';
    case 'BILLING':
      return 'GIRISH_PAYMENTS';
    case 'SHIFTS_LEAVES':
      return 'GIRISH_DOCTOR_LEAVES';
    case 'CLINICAL':
      return 'GIRISH_MEDICAL_RECORDS';
    case 'ROLE':
      return 'GIRISH_ROLES';
    case 'PERMISSION':
      return 'GIRISH_PERMISSIONS';
    default:
      return 'GIRISH_USERS';
  }
}

export function buildOracleAuditPayload(entry: RbacAuditLogEntry): OracleAuditLogPayload {
  const userId =
    typeof entry.actor_user_id === 'number' && entry.actor_user_id > 0
      ? entry.actor_user_id
      : null;
  const actionName = String(entry.action || 'SYSTEM_EVENT').trim().toUpperCase().slice(0, 100);
  const tableName = inferOracleAuditTableName(entry).slice(0, 100);

  const rawRecordId =
    entry.target_label ||
    (entry.target_user_id != null ? String(entry.target_user_id) : '') ||
    entry.id;
  const recordId = rawRecordId ? String(rawRecordId).trim().slice(0, 100) : null;

  const actorEmailPart = entry.actor_email ? `, ${entry.actor_email}` : '';
  const actorPrefix = `[${entry.actor_name} (${entry.actor_role}${actorEmailPart})]`;
  const diffPart =
    entry.previous_value || entry.new_value
      ? ` [${entry.previous_value ? `${entry.previous_value} -> ` : ''}${entry.new_value || ''}]`
      : '';
  const fullDesc = `${actorPrefix} ${entry.details}${diffPart}`.replace(/\s+/g, ' ').trim();

  return {
    user_id: userId,
    action_name: actionName,
    table_name: tableName,
    record_id: recordId,
    action_description: fullDesc.slice(0, 1000),
  };
}

export function extractOracleAuditActor(
  row: Pick<AuditLogRecord, 'username' | 'user_id' | 'action_description'>,
): string {
  if (row.username) return row.username;
  const desc = String(row.action_description || '').trim();
  const match = desc.match(/^\[([^\]]+)\]/);
  if (match?.[1]) {
    return match[1];
  }
  if (row.user_id) return `User #${row.user_id}`;
  return 'SYSTEM';
}

