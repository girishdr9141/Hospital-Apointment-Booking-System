import type { DoctorLeave, DoctorShiftConfig, ShiftSession, Slot, SlotTemplate } from '../types/opd.ts';
import { getIsoDatePart } from './rules.ts';

export const WEEKDAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export const DEFAULT_WORKING_DAYS: WeekdayName[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
];

export interface CalendarCell {
  isoDate: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  weekday: WeekdayName;
}

export interface WorkingHourWindow {
  start_time: string;
  end_time: string;
  template_id?: number;
  source: 'template' | 'working_hours';
}

export interface DayWorkingSlotItem {
  key: string;
  start_time: string;
  end_time: string;
  template_id?: number;
  source: 'template' | 'working_hours' | 'existing';
  existingSlot: Slot | null;
  status: 'UNCONFIRMED' | 'AVAILABLE' | 'BOOKED' | 'CANCELLED';
}

export function getTodayIsoLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekdayName(isoDate: string): WeekdayName {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAY_NAMES[dt.getUTCDay()];
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function getMonthGridDates(
  year: number,
  monthIndex: number,
  todayIso = getTodayIsoLocal(),
): CalendarCell[] {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const startOffset = firstOfMonth.getUTCDay(); // Sunday = 0
  const cells: CalendarCell[] = [];

  for (let i = 0; i < 42; i++) {
    const dt = new Date(Date.UTC(year, monthIndex, 1 - startOffset + i));
    const isoDate = dt.toISOString().slice(0, 10);
    cells.push({
      isoDate,
      dayNumber: dt.getUTCDate(),
      inCurrentMonth: dt.getUTCMonth() === monthIndex,
      isToday: isoDate === todayIso,
      isPast: isoDate < todayIso,
      weekday: WEEKDAY_NAMES[dt.getUTCDay()],
    });
  }
  return cells;
}

export function parseHHMMToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isDateCoveredByApprovedLeave(
  isoDate: string,
  leaves: DoctorLeave[],
  doctorId?: number | null,
): boolean {
  return leaves.some((leave) => {
    if (doctorId && leave.doctor_id !== doctorId) return false;
    if (leave.leave_status !== 'APPROVED') return false;
    const start = getIsoDatePart(leave.start_date);
    const end = getIsoDatePart(leave.end_date);
    return Boolean(start && end && isoDate >= start && isoDate <= end);
  });
}

export function formatShiftSummary(
  sessions: ShiftSession[],
  durationMins?: number,
): string {
  if (!sessions || sessions.length === 0) return 'Shift not registered';
  const parts = sessions.map((s) => `${s.start_time}–${s.end_time}`);
  return durationMins ? `${parts.join(' · ')} (${durationMins} min)` : parts.join(' · ');
}

export function deriveShiftDefaultsFromTemplates(
  doctorId: number,
  doctorTemplates: SlotTemplate[],
  doctorName?: string,
): DoctorShiftConfig {
  const active = doctorTemplates.filter((t) => t.doctor_id === doctorId && t.is_active === 'Y');
  if (active.length === 0) {
    return {
      doctor_id: doctorId,
      doctor_name: doctorName,
      sessions: [
        { start_time: '09:00', end_time: '13:00' },
        { start_time: '14:00', end_time: '17:00' },
      ],
      slot_duration_mins: 30,
      working_days: [...DEFAULT_WORKING_DAYS],
      is_registered: false,
      registered_at: null,
      updated_at: null,
    };
  }

  const workingDays = Array.from(
    new Set(active.map((t) => (t.day_of_week || '').toUpperCase()).filter(Boolean)),
  );
  const sampleDay = workingDays[0];
  const daySessions = active
    .filter((t) => (t.day_of_week || '').toUpperCase() === sampleDay)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
    .map((t) => ({ start_time: t.start_time, end_time: t.end_time }));

  return {
    doctor_id: doctorId,
    doctor_name: doctorName,
    sessions: daySessions.length > 0 ? daySessions : [{ start_time: '09:00', end_time: '17:00' }],
    slot_duration_mins: active[0]?.slot_duration_mins || 30,
    working_days: workingDays.length > 0 ? workingDays : [...DEFAULT_WORKING_DAYS],
    is_registered: false,
    registered_at: null,
    updated_at: null,
  };
}

export function buildWorkingHourWindows(
  isoDate: string,
  doctorTemplates: SlotTemplate[],
  options?: {
    durationMins?: number;
    workStart?: string;
    workEnd?: string;
    includeLunchBreak?: boolean;
    shiftConfig?: DoctorShiftConfig | null;
  },
): WorkingHourWindow[] {
  const weekday = getWeekdayName(isoDate);
  const activeTemplates = doctorTemplates.filter((t) => t.is_active === 'Y');
  const dayTemplates = activeTemplates
    .filter((t) => (t.day_of_week || '').toUpperCase() === weekday)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

  const durationOverride = options?.durationMins;

  const sliceRange = (
    startStr: string,
    endStr: string,
    stepMins: number,
    templateId: number | undefined,
    source: 'template' | 'working_hours',
  ): WorkingHourWindow[] => {
    const startMin = parseHHMMToMinutes(startStr);
    const endMin = parseHHMMToMinutes(endStr);
    const step = Math.max(10, stepMins);
    const out: WorkingHourWindow[] = [];
    for (let cur = startMin; cur + step <= endMin; cur += step) {
      out.push({
        start_time: formatMinutesToHHMM(cur),
        end_time: formatMinutesToHHMM(cur + step),
        template_id: templateId,
        source,
      });
    }
    return out;
  };

  // Prefer registered per-doctor ShiftConfig when provided
  if (options?.shiftConfig && options.shiftConfig.sessions.length > 0) {
    const shift = options.shiftConfig;
    const step = durationOverride || shift.slot_duration_mins || 30;
    const windows: WorkingHourWindow[] = [];
    const seen = new Set<string>();
    for (const sess of shift.sessions) {
      const matchingTmpl = dayTemplates.find(
        (t) => t.start_time === sess.start_time && t.end_time === sess.end_time,
      ) || dayTemplates[0];
      for (const w of sliceRange(
        sess.start_time,
        sess.end_time,
        step,
        matchingTmpl?.template_id,
        'working_hours',
      )) {
        const key = `${w.start_time}-${w.end_time}`;
        if (!seen.has(key)) {
          seen.add(key);
          windows.push(w);
        }
      }
    }
    return windows.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  if (!options?.workStart && !options?.workEnd && dayTemplates.length > 0) {
    const windows: WorkingHourWindow[] = [];
    const seen = new Set<string>();
    for (const tmpl of dayTemplates) {
      const step = durationOverride || tmpl.slot_duration_mins || 30;
      for (const w of sliceRange(tmpl.start_time, tmpl.end_time, step, tmpl.template_id, 'template')) {
        const key = `${w.start_time}-${w.end_time}`;
        if (!seen.has(key)) {
          seen.add(key);
          windows.push(w);
        }
      }
    }
    return windows.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  // Fallback or explicit working-hours override (ensures every day has working-hour slots!)
  const defaultDuration =
    durationOverride || activeTemplates[0]?.slot_duration_mins || 30;

  if (options?.workStart && options?.workEnd) {
    return sliceRange(
      options.workStart,
      options.workEnd,
      defaultDuration,
      dayTemplates[0]?.template_id,
      'working_hours',
    );
  }

  // Derive representative working hours from doctor's active templates if available, else 09:00-13:00 & 14:00-17:00
  if (activeTemplates.length > 0) {
    const firstDay = activeTemplates[0].day_of_week;
    const sampleSessions = activeTemplates
      .filter((t) => t.day_of_week === firstDay)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const windows: WorkingHourWindow[] = [];
    const seen = new Set<string>();
    for (const sess of sampleSessions) {
      for (const w of sliceRange(
        sess.start_time,
        sess.end_time,
        defaultDuration,
        undefined,
        'working_hours',
      )) {
        const key = `${w.start_time}-${w.end_time}`;
        if (!seen.has(key)) {
          seen.add(key);
          windows.push(w);
        }
      }
    }
    if (windows.length > 0) return windows;
  }

  const morning = sliceRange('09:00', '13:00', defaultDuration, undefined, 'working_hours');
  const afternoon = sliceRange('14:00', '17:00', defaultDuration, undefined, 'working_hours');
  return [...morning, ...afternoon];
}

export function mergeDayWorkingSlots(
  isoDate: string,
  windows: WorkingHourWindow[],
  doctorSlots: Slot[],
): DayWorkingSlotItem[] {
  const slotsOnDay = doctorSlots.filter((s) => getIsoDatePart(s.slot_date) === isoDate);
  const byKey = new Map<string, Slot>();
  for (const s of slotsOnDay) {
    const key = `${s.start_time}-${s.end_time}`;
    // Prefer active/non-cancelled slot if multiple exist for same window
    const existing = byKey.get(key);
    if (!existing || (existing.status === 'CANCELLED' && s.status !== 'CANCELLED')) {
      byKey.set(key, s);
    }
  }

  const items: DayWorkingSlotItem[] = [];
  const usedKeys = new Set<string>();

  for (const w of windows) {
    const key = `${w.start_time}-${w.end_time}`;
    usedKeys.add(key);
    const match = byKey.get(key) ?? null;
    let status: DayWorkingSlotItem['status'] = 'UNCONFIRMED';
    if (match) {
      if (match.status === 'CANCELLED') {
        status = 'CANCELLED';
      } else if (match.booked_patients > 0 || match.status === 'SOLD_OUT') {
        status = 'BOOKED';
      } else {
        status = 'AVAILABLE';
      }
    }
    items.push({
      key,
      start_time: w.start_time,
      end_time: w.end_time,
      template_id: w.template_id ?? match?.template_id,
      source: w.source,
      existingSlot: match,
      status,
    });
  }

  // Include any custom slots created on this day that are outside standard windows
  for (const s of slotsOnDay) {
    const key = `${s.start_time}-${s.end_time}`;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    items.push({
      key,
      start_time: s.start_time,
      end_time: s.end_time,
      template_id: s.template_id,
      source: 'existing',
      existingSlot: s,
      status:
        s.status === 'CANCELLED'
          ? 'CANCELLED'
          : s.booked_patients > 0 || s.status === 'SOLD_OUT'
            ? 'BOOKED'
            : 'AVAILABLE',
    });
  }

  return items.sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export function doesDoctorNeedDailySlotsPrompt(
  doctorSlots: Slot[],
  doctorLeaves: DoctorLeave[],
  doctorId?: number | null,
  todayIso = getTodayIsoLocal(),
): boolean {
  if (!doctorId) return false;
  if (isDateCoveredByApprovedLeave(todayIso, doctorLeaves, doctorId)) {
    return false;
  }
  const activeTodayCount = doctorSlots.filter(
    (s) =>
      getIsoDatePart(s.slot_date) === todayIso &&
      s.status !== 'CANCELLED' &&
      (!s.doctor_id || s.doctor_id === doctorId),
  ).length;
  return activeTodayCount === 0;
}
