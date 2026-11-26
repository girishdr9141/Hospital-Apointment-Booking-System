import type {
  Appointment,
  AuthUser,
  DoctorLeave,
  PortalNotification,
  ShiftChangeRequest,
} from '../types/opd';
import { formatShiftSummary } from './calendar';
import { formatDisplayDate } from './rules';

export interface PatientNotificationLike {
  id: string;
  patient_id: number;
  prescription_id: string;
  event_type: 'CREATED' | 'UPDATED';
  title: string;
  message: string;
  doctor_name: string;
  appointment_ref?: string | null;
  created_at: string;
}

export function shouldIncludePendingApprovalsCount(
  user: Pick<AuthUser, 'role'>,
): boolean {
  return user.role === 'ADMIN';
}

export function canViewAllShiftChangeRequests(
  user: Pick<AuthUser, 'role'>,
): boolean {
  return user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
}

export function canDecideLeaveOrShiftRequest(
  user: Pick<AuthUser, 'role'>,
): boolean {
  return user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
}

export function scopeLeavesForUser(
  leaves: DoctorLeave[],
  user: Pick<AuthUser, 'role' | 'doctor_id'>,
): DoctorLeave[] {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    return leaves;
  }
  if (user.role === 'DOCTOR') {
    if (!user.doctor_id) return [];
    return leaves.filter((l) => l.doctor_id === user.doctor_id);
  }
  return [];
}

export function buildScopedPortalNotifications(params: {
  user: Pick<AuthUser, 'user_id' | 'role' | 'doctor_id' | 'patient_id'>;
  shiftChangeRequests: ShiftChangeRequest[];
  leaves: DoctorLeave[];
  doctorAppointments: Appointment[];
  patientNotifications: PatientNotificationLike[];
  dismissedIds: Set<string>;
}): PortalNotification[] {
  const {
    user,
    shiftChangeRequests,
    leaves,
    doctorAppointments,
    patientNotifications,
    dismissedIds,
  } = params;
  const list: PortalNotification[] = [];

  if (user.role === 'ADMIN') {
    for (const reqItem of shiftChangeRequests) {
      if (reqItem.status === 'PENDING') {
        const id = `shift-req-${reqItem.request_id}`;
        list.push({
          id,
          category: 'SHIFT_REQUEST',
          title: `Shift change request from ${reqItem.doctor_name}`,
          message: `Requested ${formatShiftSummary(reqItem.requested_sessions, reqItem.requested_slot_duration_mins)} · ${reqItem.reason}`,
          route: 'approvals',
          created_at: reqItem.requested_on,
          read: dismissedIds.has(id),
          severity: 'warning',
        });
      }
    }

    for (const lv of leaves) {
      if (lv.leave_status === 'PENDING') {
        const id = `leave-req-${lv.leave_id}`;
        list.push({
          id,
          category: 'LEAVE_REQUEST',
          title: `Leave request from ${lv.doctor_name || `Doctor #${lv.doctor_id}`}`,
          message: `${formatDisplayDate(lv.start_date)} – ${formatDisplayDate(lv.end_date)}${lv.leave_reason ? ` · ${lv.leave_reason}` : ''}`,
          route: 'doctor-leaves',
          created_at: lv.requested_on || '',
          read: dismissedIds.has(id),
          severity: 'warning',
        });
      }
    }
  } else if (user.role === 'DOCTOR' && user.doctor_id) {
    const docId = user.doctor_id;

    for (const a of doctorAppointments) {
      if (a.doctor_id === docId && (a.status === 'HELD' || a.status === 'CONFIRMED')) {
        const id = `doc-appt-${a.appointment_id}-${a.status}`;
        list.push({
          id,
          category: 'NEW_APPOINTMENT',
          title: `Appointment ${a.status.toLowerCase()}: ${a.patient_name}`,
          message: `${a.appointment_ref} · ${a.slot_date ? formatDisplayDate(a.slot_date) : ''} ${a.start_time || ''}`.trim(),
          route: 'appointments',
          created_at: a.created_on || '',
          read: dismissedIds.has(id),
          severity: 'info',
        });
      }
    }

    for (const reqItem of shiftChangeRequests) {
      if (reqItem.doctor_id === docId && reqItem.status !== 'PENDING') {
        const id = `shift-resp-${reqItem.request_id}-${reqItem.status}`;
        list.push({
          id,
          category: 'ADMIN_RESPONSE',
          title: `Shift change request ${reqItem.status.toLowerCase()}`,
          message: `${formatShiftSummary(reqItem.requested_sessions, reqItem.requested_slot_duration_mins)}${reqItem.decision_comments ? ` · Note: ${reqItem.decision_comments}` : ''}`,
          route: 'slots',
          created_at: reqItem.decided_on || reqItem.requested_on,
          read: dismissedIds.has(id),
          severity: reqItem.status === 'APPROVED' ? 'success' : 'warning',
        });
      }
    }

    for (const lv of leaves) {
      if (lv.doctor_id === docId && (lv.leave_status === 'APPROVED' || lv.leave_status === 'REJECTED')) {
        const id = `leave-resp-${lv.leave_id}-${lv.leave_status}`;
        list.push({
          id,
          category: 'ADMIN_RESPONSE',
          title: `Leave request ${lv.leave_status.toLowerCase()} by admin`,
          message: `${formatDisplayDate(lv.start_date)} – ${formatDisplayDate(lv.end_date)}${lv.leave_reason ? ` · ${lv.leave_reason}` : ''}`,
          route: 'doctor-leaves',
          created_at: lv.approved_on || lv.requested_on || '',
          read: dismissedIds.has(id),
          severity: lv.leave_status === 'APPROVED' ? 'success' : 'warning',
        });
      }
    }
  } else if (user.role === 'PATIENT' && user.patient_id) {
    const patId = user.patient_id;
    for (const n of patientNotifications) {
      if (n.patient_id !== patId) continue;
      list.push({
        id: n.id,
        category: n.event_type === 'CREATED' ? 'PRESCRIPTION_CREATED' : 'PRESCRIPTION_UPDATED',
        title: n.title,
        message: n.message,
        route: 'prescriptions',
        created_at: n.created_at,
        read: dismissedIds.has(n.id),
        severity: 'success',
        doctor_name: n.doctor_name,
        appointment_ref: n.appointment_ref,
        prescription_id: n.prescription_id,
        patient_id: n.patient_id,
      });
    }
  }

  list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return list;
}
