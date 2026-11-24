import type { Appointment, Department, Doctor, Slot, SlotTemplate } from '../types/opd.ts';

export function getIsoDatePart(isoOrDate?: string | null): string {
  if (!isoOrDate) return '';
  return isoOrDate.slice(0, 10);
}

export function formatDisplayDate(isoOrDate?: string | null): string {
  const part = getIsoDatePart(isoOrDate);
  if (!part) return '—';
  const [y, m, d] = part.split('-').map(Number);
  if (!y || !m || !d) return part;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDisplayDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCurrencyInr(amount?: number | null): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return '₹0.00';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

export function formatHoldRemaining(holdExpiresAt?: string | null, nowMs = Date.now()): string | null {
  if (!holdExpiresAt) return null;
  const expiryMs = new Date(holdExpiresAt).getTime();
  if (Number.isNaN(expiryMs)) return null;
  const diffSec = Math.floor((expiryMs - nowMs) / 1000);
  if (diffSec <= 0) return 'Expired';
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function isAppointmentHoldExpired(
  appointment: Pick<Appointment, 'status' | 'hold_expires_at'>,
  nowMs = Date.now(),
): boolean {
  if (appointment.status !== 'HELD' || !appointment.hold_expires_at) return false;
  const expiryMs = new Date(appointment.hold_expires_at).getTime();
  if (Number.isNaN(expiryMs)) return false;
  return expiryMs <= nowMs;
}

export function getNextHoldExpiryMs(
  appointments: Array<Pick<Appointment, 'status' | 'hold_expires_at'>>,
): number | null {
  let minMs: number | null = null;
  for (const appt of appointments) {
    if (appt.status !== 'HELD' || !appt.hold_expires_at) continue;
    const expiryMs = new Date(appt.hold_expires_at).getTime();
    if (Number.isNaN(expiryMs)) continue;
    if (minMs === null || expiryMs < minMs) {
      minMs = expiryMs;
    }
  }
  return minMs;
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): { pageItems: T[]; totalPages: number; currentPage: number } {
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safeSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * safeSize;
  return {
    pageItems: items.slice(start, start + safeSize),
    totalPages,
    currentPage,
  };
}

export function enrichSlots(
  slots: Slot[],
  templates: SlotTemplate[],
  doctors: Doctor[],
  departments: Department[],
): Slot[] {
  const templateById = new Map(templates.map((t) => [t.template_id, t]));
  const doctorById = new Map(doctors.map((d) => [d.doctor_id, d]));
  const deptById = new Map(departments.map((d) => [d.department_id, d]));

  return slots.map((slot) => {
    const tmpl = slot.template_id != null ? templateById.get(slot.template_id) : undefined;
    const resolvedDoctorId = slot.doctor_id ?? tmpl?.doctor_id ?? undefined;
    const doc = resolvedDoctorId ? doctorById.get(resolvedDoctorId) : undefined;
    const dept = doc ? deptById.get(doc.department_id) : undefined;
    return {
      ...slot,
      doctor_id: doc?.doctor_id ?? resolvedDoctorId ?? slot.doctor_id ?? null,
      doctor_name: doc ? `Dr. ${doc.first_name} ${doc.last_name}` : slot.doctor_name,
      department_id: doc?.department_id ?? slot.department_id,
      department_name: dept?.department_name ?? slot.department_name,
    };
  });
}

export function enrichAppointments(
  appointments: Appointment[],
  enrichedSlots: Slot[],
  doctors: Doctor[],
): Appointment[] {
  const slotById = new Map(enrichedSlots.map((s) => [s.slot_id, s]));
  const doctorById = new Map(doctors.map((d) => [d.doctor_id, d]));

  return appointments.map((appt) => {
    const slot = slotById.get(appt.slot_id);
    const doc = slot?.doctor_id ? doctorById.get(slot.doctor_id) : undefined;
    return {
      ...appt,
      consultation_mode: appt.consultation_mode === 'ONLINE' ? 'ONLINE' : 'FACE_TO_FACE',
      rescheduled_from_id: appt.rescheduled_from_id ?? null,
      slot_date: slot?.slot_date ?? appt.slot_date ?? null,
      start_time: slot?.start_time ?? appt.start_time ?? null,
      end_time: slot?.end_time ?? appt.end_time ?? null,
      doctor_id: slot?.doctor_id ?? appt.doctor_id ?? null,
      doctor_name: slot?.doctor_name ?? appt.doctor_name ?? null,
      department_id: slot?.department_id ?? appt.department_id ?? null,
      department_name: slot?.department_name ?? appt.department_name ?? null,
      consultation_fee: doc?.consultation_fee ?? appt.consultation_fee ?? null,
    };
  });
}

export function normalizeOrdsError(payload: unknown, fallback = 'Request failed'): string {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const raw =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      '';
    if (raw) {
      return raw.replace(/^ORA-\d+:\s*/i, '').trim();
    }
  }
  return fallback;
}

const WEEKDAY_ORDER: Record<string, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

export function sortSlotTemplates(templates: SlotTemplate[]): SlotTemplate[] {
  return [...templates].sort((a, b) => {
    const dayDiff =
      (WEEKDAY_ORDER[(a.day_of_week || '').toUpperCase()] ?? 99) -
      (WEEKDAY_ORDER[(b.day_of_week || '').toUpperCase()] ?? 99);
    if (dayDiff !== 0) return dayDiff;
    return (a.start_time || '').localeCompare(b.start_time || '');
  });
}

export function normalizePersonName(name?: string | null, stripDoctorPrefix = false): string {
  const collapsed = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!stripDoctorPrefix) return collapsed;
  return collapsed.replace(/^dr\.?\s+/, '').trim();
}

export function doesLoginNameMatch(
  enteredName?: string | null,
  accountFullName?: string | null,
  role?: string | null,
): boolean {
  const a = normalizePersonName(enteredName, false);
  const b = normalizePersonName(accountFullName, false);
  if (!a || !b) return false;
  if (a === b) return true;
  if (role === 'DOCTOR') {
    return normalizePersonName(enteredName, true) === normalizePersonName(accountFullName, true);
  }
  return false;
}
