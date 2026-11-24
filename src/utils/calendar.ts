import type {
  Appointment,
  DoctorLeave,
  DoctorShiftConfig,
  ShiftSession,
  Slot,
  SlotTemplate,
} from '../types/opd.ts';
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
  slot_date?: string;
  dayOffset?: 0 | 1;
  start_time: string;
  end_time: string;
  template_id?: number | null;
  source: 'template' | 'working_hours';
}

export interface DayWorkingSlotItem {
  key: string;
  slot_date: string;
  dayOffset: 0 | 1;
  start_time: string;
  end_time: string;
  template_id?: number | null;
  source: 'template' | 'working_hours' | 'existing';
  existingSlot: Slot | null;
  status: 'UNCONFIRMED' | 'AVAILABLE' | 'BOOKED' | 'CANCELLED';
}

export interface ComputedShiftSession {
  start_time: string;
  end_time: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  crossesMidnight: boolean;
}

export const DEFAULT_HOSPITAL_TIMEZONE = 'Asia/Kolkata';
const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface HospitalNowParts {
  isoDate: string;
  timeHHMM: string;
  minutesOfDay: number;
  year: number;
  monthIndex: number;
  day: number;
  timeZone: string;
}

export function getHospitalNowParts(
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): HospitalNowParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const partsMap: Record<string, string> = {};
  for (const p of formatter.formatToParts(now)) {
    if (p.type !== 'literal') partsMap[p.type] = p.value;
  }
  const year = Number(partsMap.year || now.getUTCFullYear());
  const monthNum = Number(partsMap.month || now.getUTCMonth() + 1);
  const day = Number(partsMap.day || now.getUTCDate());
  let hourNum = Number(partsMap.hour || 0);
  if (hourNum === 24) hourNum = 0;
  const minuteNum = Number(partsMap.minute || 0);
  const isoDate = `${String(year).padStart(4, '0')}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeHHMM = `${String(hourNum).padStart(2, '0')}:${String(minuteNum).padStart(2, '0')}`;
  return {
    isoDate,
    timeHHMM,
    minutesOfDay: hourNum * 60 + minuteNum,
    year,
    monthIndex: monthNum - 1,
    day,
    timeZone,
  };
}

export function getTodayIsoLocal(
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): string {
  return getHospitalNowParts(now, timeZone).isoDate;
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

export function isValidHHMM(value?: string | null): boolean {
  return Boolean(value && HHMM_REGEX.test(value.trim()));
}

export function parseHHMMToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeShiftSession(
  startTime?: string | null,
  endTime?: string | null,
): ComputedShiftSession | null {
  const start = String(startTime || '').trim();
  const end = String(endTime || '').trim();
  if (!isValidHHMM(start) || !isValidHHMM(end)) return null;
  const startMinutes = parseHHMMToMinutes(start);
  const rawEndMinutes = parseHHMMToMinutes(end);
  if (startMinutes === rawEndMinutes) return null;
  const crossesMidnight = rawEndMinutes < startMinutes;
  const endMinutes = crossesMidnight ? rawEndMinutes + 1440 : rawEndMinutes;
  return {
    start_time: start,
    end_time: end,
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes,
    crossesMidnight,
  };
}

export function doesSessionCrossMidnight(
  startTime?: string | null,
  endTime?: string | null,
): boolean {
  return Boolean(computeShiftSession(startTime, endTime)?.crossesMidnight);
}

export function isValidSlotTimeRange(
  startTime?: string | null,
  endTime?: string | null,
  maxDurationMins = 720,
): boolean {
  const parsed = computeShiftSession(startTime, endTime);
  return Boolean(parsed && parsed.durationMinutes > 0 && parsed.durationMinutes <= maxDurationMins);
}

export function validateShiftSessions(
  rawSessions: Array<{ start_time?: string | null; end_time?: string | null }>,
): { valid: true; sessions: ShiftSession[] } | { valid: false; message: string } {
  if (!Array.isArray(rawSessions) || rawSessions.length === 0) {
    return { valid: false, message: 'At least one valid shift window is required' };
  }

  const firstRaw = rawSessions[0];
  const s1Start = String(firstRaw?.start_time || '').trim();
  const s1End = String(firstRaw?.end_time || '').trim();
  if (!isValidHHMM(s1Start) || !isValidHHMM(s1End)) {
    return { valid: false, message: 'Primary shift start and end times are required' };
  }
  const s1 = computeShiftSession(s1Start, s1End);
  if (!s1) {
    return { valid: false, message: 'Primary shift end time must be different from start time' };
  }

  const timeline: Array<{ start: number; end: number; session: ShiftSession }> = [
    {
      start: s1.startMinutes,
      end: s1.endMinutes,
      session: { start_time: s1.start_time, end_time: s1.end_time },
    },
  ];

  for (let i = 1; i < rawSessions.length; i++) {
    const item = rawSessions[i];
    const startStr = String(item?.start_time || '').trim();
    const endStr = String(item?.end_time || '').trim();
    const label = i === 1 ? 'Second shift' : `Shift session #${i + 1}`;
    if (!isValidHHMM(startStr) || !isValidHHMM(endStr)) {
      return { valid: false, message: `${label} start and end times are required` };
    }
    const parsed = computeShiftSession(startStr, endStr);
    if (!parsed) {
      return { valid: false, message: `${label} end time must be different from start time` };
    }

    const dayOffset = parsed.startMinutes < s1.startMinutes ? 1440 : 0;
    const adjStart = parsed.startMinutes + dayOffset;
    const adjEnd = parsed.endMinutes + dayOffset;

    if (adjEnd - s1.startMinutes > 1440) {
      return {
        valid: false,
        message: 'Combined shift sessions cannot span more than 24 hours',
      };
    }

    const overlaps = timeline.some(
      (existing) => adjStart < existing.end && existing.start < adjEnd,
    );
    if (overlaps) {
      return {
        valid: false,
        message: 'Second session cannot overlap with primary shift window',
      };
    }

    timeline.push({
      start: adjStart,
      end: adjEnd,
      session: { start_time: parsed.start_time, end_time: parsed.end_time },
    });
  }

  timeline.sort((a, b) => a.start - b.start);
  return { valid: true, sessions: timeline.map((entry) => entry.session) };
}

export function isSlotStartExpired(
  slotDate?: string | null,
  startTime?: string | null,
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): boolean {
  const datePart = getIsoDatePart(slotDate);
  if (!datePart) return false;
  const cur = getHospitalNowParts(now, timeZone);
  if (datePart < cur.isoDate) return true;
  if (datePart > cur.isoDate) return false;
  if (!startTime || !/^\d{1,2}:\d{2}/.test(startTime.trim())) return false;
  return parseHHMMToMinutes(startTime.trim()) <= cur.minutesOfDay;
}

export function isSlotEndExpired(
  slotDate?: string | null,
  startTime?: string | null,
  endTime?: string | null,
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): boolean {
  const datePart = getIsoDatePart(slotDate);
  if (!datePart) return false;
  const cur = getHospitalNowParts(now, timeZone);

  const hasValidEnd = Boolean(endTime && /^\d{1,2}:\d{2}/.test(endTime.trim()));
  if (!hasValidEnd) {
    if (datePart < cur.isoDate) return true;
    if (datePart > cur.isoDate) return false;
    return isSlotStartExpired(datePart, startTime, now, timeZone);
  }

  const endMins = parseHHMMToMinutes(endTime!.trim());
  const hasValidStart = Boolean(startTime && /^\d{1,2}:\d{2}/.test(startTime.trim()));
  const crossesMidnight =
    hasValidStart && endMins <= parseHHMMToMinutes(startTime!.trim());
  const effectiveEndDate = crossesMidnight ? addDaysIso(datePart, 1) : datePart;

  if (effectiveEndDate < cur.isoDate) return true;
  if (effectiveEndDate > cur.isoDate) return false;
  return cur.minutesOfDay >= endMins;
}

export function isSlotFutureOrActive(
  slot: Pick<Slot, 'slot_date' | 'start_time' | 'end_time' | 'status' | 'booked_patients'>,
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): boolean {
  if (slot.status === 'CANCELLED') return false;
  const isBooked = slot.booked_patients > 0 || slot.status === 'SOLD_OUT';
  if (isBooked) {
    return !isSlotEndExpired(slot.slot_date, slot.start_time, slot.end_time, now, timeZone);
  }
  return (
    slot.status === 'AVAILABLE' &&
    slot.booked_patients < 1_000_000 &&
    !isSlotEndExpired(slot.slot_date, slot.start_time, slot.end_time, now, timeZone)
  );
}

export function getAppointmentsAwaitingOutcome<
  T extends Pick<
    Appointment,
    'appointment_id' | 'status' | 'slot_date' | 'start_time' | 'end_time' | 'doctor_id'
  >,
>(
  appointments: T[],
  doctorId?: number | null,
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): T[] {
  return appointments
    .filter((appt) => {
      if (appt.status !== 'CONFIRMED') return false;
      if (doctorId && appt.doctor_id !== doctorId) return false;
      if (!appt.slot_date) return false;
      return isSlotEndExpired(appt.slot_date, appt.start_time, appt.end_time, now, timeZone);
    })
    .sort((a, b) => {
      const da = getIsoDatePart(a.slot_date);
      const db = getIsoDatePart(b.slot_date);
      if (da !== db) return da.localeCompare(db);
      const ta = a.start_time || '';
      const tb = b.start_time || '';
      if (ta !== tb) return ta.localeCompare(tb);
      return a.appointment_id - b.appointment_id;
    });
}

export function isAppointmentTimeReached(
  slotDate?: string | null,
  startTime?: string | null,
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): boolean {
  const datePart = getIsoDatePart(slotDate);
  if (!datePart || !startTime || !/^\d{1,2}:\d{2}/.test(startTime.trim())) return false;
  const cur = getHospitalNowParts(now, timeZone);
  if (datePart < cur.isoDate) return true;
  if (datePart > cur.isoDate) return false;
  return cur.minutesOfDay >= parseHHMMToMinutes(startTime.trim());
}

export function filterBookableSlots(
  slots: Slot[],
  now = new Date(),
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): Slot[] {
  return slots.filter(
    (s) =>
      s.status === 'AVAILABLE' &&
      s.booked_patients < s.max_patients_per_slot &&
      !isSlotEndExpired(s.slot_date, s.start_time, s.end_time, now, timeZone),
  );
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
  const parts = sessions.map((s) => {
    const overnight = doesSessionCrossMidnight(s.start_time, s.end_time);
    return `${s.start_time}–${s.end_time}${overnight ? ' (+1d)' : ''}`;
  });
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
    .filter((t) => (t.day_of_week || '').toUpperCase() === weekday);

  const durationOverride = options?.durationMins;

  const sliceRange = (
    startStr: string,
    endStr: string,
    stepMins: number,
    templateId: number | undefined,
    source: 'template' | 'working_hours',
  ): WorkingHourWindow[] => {
    const parsed = computeShiftSession(startStr, endStr);
    if (!parsed) return [];
    const step = Math.max(10, stepMins);
    const out: WorkingHourWindow[] = [];
    for (let cur = parsed.startMinutes; cur + step <= parsed.endMinutes; cur += step) {
      const dayOffset: 0 | 1 = cur >= 1440 ? 1 : 0;
      const slotDate = dayOffset === 1 ? addDaysIso(isoDate, 1) : isoDate;
      out.push({
        slot_date: slotDate,
        dayOffset,
        start_time: formatMinutesToHHMM(cur),
        end_time: formatMinutesToHHMM(cur + step),
        template_id: templateId,
        source,
      });
    }
    return out;
  };

  const sortChronologically = (list: WorkingHourWindow[]): WorkingHourWindow[] =>
    list.sort((a, b) => {
      const dCmp = (a.slot_date || isoDate).localeCompare(b.slot_date || isoDate);
      if (dCmp !== 0) return dCmp;
      return a.start_time.localeCompare(b.start_time);
    });

  // Prefer registered per-doctor ShiftConfig when provided
  if (options?.shiftConfig && options.shiftConfig.sessions.length > 0) {
    const shift = options.shiftConfig;
    const step = durationOverride || shift.slot_duration_mins || 30;
    const windows: WorkingHourWindow[] = [];
    const seen = new Set<string>();
    for (const sess of shift.sessions) {
      const matchingTmpl =
        dayTemplates.find(
          (t) => t.start_time === sess.start_time && t.end_time === sess.end_time,
        ) || dayTemplates[0];
      for (const w of sliceRange(
        sess.start_time,
        sess.end_time,
        step,
        matchingTmpl?.template_id,
        'working_hours',
      )) {
        const wDate = w.slot_date || isoDate;
        const key = `${wDate}|${w.start_time}-${w.end_time}`;
        if (!seen.has(key)) {
          seen.add(key);
          windows.push(w);
        }
      }
    }
    return sortChronologically(windows);
  }

  if (!options?.workStart && !options?.workEnd && dayTemplates.length > 0) {
    const windows: WorkingHourWindow[] = [];
    const seen = new Set<string>();
    for (const tmpl of dayTemplates) {
      const step = durationOverride || tmpl.slot_duration_mins || 30;
      for (const w of sliceRange(tmpl.start_time, tmpl.end_time, step, tmpl.template_id, 'template')) {
        const wDate = w.slot_date || isoDate;
        const key = `${wDate}|${w.start_time}-${w.end_time}`;
        if (!seen.has(key)) {
          seen.add(key);
          windows.push(w);
        }
      }
    }
    return sortChronologically(windows);
  }

  // Fallback or explicit working-hours override (ensures every day has working-hour slots!)
  const defaultDuration =
    durationOverride || activeTemplates[0]?.slot_duration_mins || 30;

  if (options?.workStart && options?.workEnd) {
    return sortChronologically(
      sliceRange(
        options.workStart,
        options.workEnd,
        defaultDuration,
        dayTemplates[0]?.template_id,
        'working_hours',
      ),
    );
  }

  // Derive representative working hours from doctor's active templates if available, else 09:00-13:00 & 14:00-17:00
  if (activeTemplates.length > 0) {
    const firstDay = activeTemplates[0].day_of_week;
    const sampleSessions = activeTemplates.filter((t) => t.day_of_week === firstDay);
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
        const wDate = w.slot_date || isoDate;
        const key = `${wDate}|${w.start_time}-${w.end_time}`;
        if (!seen.has(key)) {
          seen.add(key);
          windows.push(w);
        }
      }
    }
    if (windows.length > 0) return sortChronologically(windows);
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
  const byDateTimeKey = new Map<string, Slot>();
  const slotsOnDay: Slot[] = [];
  for (const s of doctorSlots) {
    const sDate = getIsoDatePart(s.slot_date);
    if (!sDate) continue;
    if (sDate === isoDate) slotsOnDay.push(s);
    const lookupKey = `${sDate}|${s.start_time}-${s.end_time}`;
    // Prefer active/non-cancelled slot if multiple exist for same window
    const existing = byDateTimeKey.get(lookupKey);
    if (!existing || (existing.status === 'CANCELLED' && s.status !== 'CANCELLED')) {
      byDateTimeKey.set(lookupKey, s);
    }
  }

  const items: DayWorkingSlotItem[] = [];
  const usedKeys = new Set<string>();

  for (const w of windows) {
    const wDate = w.slot_date || isoDate;
    const dayOffset: 0 | 1 = w.dayOffset ?? (wDate > isoDate ? 1 : 0);
    const lookupKey = `${wDate}|${w.start_time}-${w.end_time}`;
    usedKeys.add(lookupKey);
    const match = byDateTimeKey.get(lookupKey) ?? null;
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
      key: lookupKey,
      slot_date: wDate,
      dayOffset,
      start_time: w.start_time,
      end_time: w.end_time,
      template_id: w.template_id ?? match?.template_id,
      source: w.source,
      existingSlot: match,
      status,
    });
  }

  // Include any custom or prior-shift slots present on isoDate that are outside this day's windows
  for (const s of slotsOnDay) {
    const lookupKey = `${isoDate}|${s.start_time}-${s.end_time}`;
    if (usedKeys.has(lookupKey)) continue;
    usedKeys.add(lookupKey);
    items.push({
      key: lookupKey,
      slot_date: isoDate,
      dayOffset: 0,
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

  return items.sort((a, b) => {
    const aTime = a.dayOffset * 1440 + parseHHMMToMinutes(a.start_time);
    const bTime = b.dayOffset * 1440 + parseHHMMToMinutes(b.start_time);
    return aTime - bTime;
  });
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
