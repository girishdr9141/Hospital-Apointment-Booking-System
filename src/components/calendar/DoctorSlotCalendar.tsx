import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Lock,
  Plus,
} from 'lucide-react';
import type { DoctorLeave, DoctorShiftConfig, Slot, SlotTemplate } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import {
  buildWorkingHourWindows,
  doesSessionCrossMidnight,
  formatShiftSummary,
  getHospitalNowParts,
  getMonthGridDates,
  getWeekdayName,
  isDateCoveredByApprovedLeave,
  isSlotEndExpired,
  isValidSlotTimeRange,
  mergeDayWorkingSlots,
  type DayWorkingSlotItem,
} from '../../utils/calendar';
import { formatDisplayDate, getIsoDatePart } from '../../utils/rules';
import { Modal } from '../common/Modal';

interface DoctorSlotCalendarProps {
  doctorId: number;
  doctorName: string;
  slots: Slot[];
  templates: SlotTemplate[];
  leaves: DoctorLeave[];
  shiftConfig?: DoctorShiftConfig | null;
  readOnly?: boolean;
  onRequestShiftChange?: () => void;
  onSlotsChanged: () => Promise<void> | void;
  compact?: boolean;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DoctorSlotCalendar({
  doctorId,
  doctorName,
  slots,
  templates,
  leaves,
  shiftConfig,
  readOnly = false,
  onRequestShiftChange,
  onSlotsChanged,
  compact = false,
}: DoctorSlotCalendarProps) {
  const { notify } = useToast();
  const initialNow = getHospitalNowParts();
  const todayIso = initialNow.isoDate;

  const [viewYear, setViewYear] = useState(initialNow.year);
  const [viewMonth, setViewMonth] = useState(initialNow.monthIndex);
  const [selectedDate, setSelectedDate] = useState(todayIso);

  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // Single-slot click confirmation dialog
  const [confirmTarget, setConfirmTarget] = useState<DayWorkingSlotItem | null>(null);
  const [confirmEndTime, setConfirmEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Custom single slot form (for this single selected date only)
  const [customStart, setCustomStart] = useState('17:00');
  const [customEnd, setCustomEnd] = useState('17:30');

  const gridCells = useMemo(
    () => getMonthGridDates(viewYear, viewMonth, todayIso),
    [viewYear, viewMonth, todayIso],
  );

  const slotStatsByDate = useMemo(() => {
    const map = new Map<string, { total: number; available: number; booked: number }>();
    for (const s of slots) {
      if (s.status === 'CANCELLED') continue;
      const d = getIsoDatePart(s.slot_date);
      if (!d) continue;
      const isBooked = s.booked_patients > 0 || s.status === 'SOLD_OUT';
      const isExpired = isSlotEndExpired(d, s.start_time, s.end_time);
      if (isExpired) continue;
      const cur = map.get(d) || { total: 0, available: 0, booked: 0 };
      cur.total += 1;
      if (isBooked) {
        cur.booked += 1;
      } else if (s.status === 'AVAILABLE') {
        cur.available += 1;
      }
      map.set(d, cur);
    }
    return map;
  }, [slots]);

  const selectedDateIsPast = selectedDate < todayIso;
  const selectedDateOnLeave = useMemo(
    () => isDateCoveredByApprovedLeave(selectedDate, leaves, doctorId),
    [selectedDate, leaves, doctorId],
  );

  const activeDuration = shiftConfig?.slot_duration_mins || 30;

  const dayWindows = useMemo(
    () =>
      buildWorkingHourWindows(selectedDate, templates, {
        durationMins: activeDuration,
        shiftConfig,
      }),
    [selectedDate, templates, activeDuration, shiftConfig],
  );

  const daySlotItems = useMemo(
    () => mergeDayWorkingSlots(selectedDate, dayWindows, slots),
    [selectedDate, dayWindows, slots],
  );

  const unconfirmedOpenItems = useMemo(
    () =>
      daySlotItems.filter((item) => {
        const targetDate = item.slot_date || selectedDate;
        return (
          item.status === 'UNCONFIRMED' &&
          !isSlotEndExpired(targetDate, item.start_time, item.end_time) &&
          !isDateCoveredByApprovedLeave(targetDate, leaves, doctorId)
        );
      }),
    [daySlotItems, selectedDate, leaves, doctorId],
  );

  const selectedDayCounts = useMemo(() => {
    return {
      open: daySlotItems.filter(
        (i) =>
          i.status === 'AVAILABLE' &&
          !isSlotEndExpired(i.slot_date || selectedDate, i.start_time, i.end_time),
      ).length,
      booked: daySlotItems.filter(
        (i) =>
          i.status === 'BOOKED' &&
          !isSlotEndExpired(i.slot_date || selectedDate, i.start_time, i.end_time),
      ).length,
      unconfirmed: unconfirmedOpenItems.length,
    };
  }, [daySlotItems, selectedDate, unconfirmedOpenItems.length]);

  const todayStats = slotStatsByDate.get(todayIso) || { total: 0, available: 0, booked: 0 };

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  };

  const handleSlotTileClick = (item: DayWorkingSlotItem) => {
    if (readOnly || selectedDateIsPast || selectedDateOnLeave) return;
    if (item.status !== 'UNCONFIRMED') return;
    const targetDate = item.slot_date || selectedDate;
    if (isDateCoveredByApprovedLeave(targetDate, leaves, doctorId)) {
      notify(
        `Cannot generate slot on ${formatDisplayDate(targetDate)}: approved leave active on that date.`,
        'error',
      );
      return;
    }
    if (isSlotEndExpired(targetDate, item.start_time, item.end_time)) {
      const nowParts = getHospitalNowParts();
      notify(
        `Cannot generate expired slot ending at ${item.end_time} (current hospital time ${nowParts.timeHHMM} IST).`,
        'error',
      );
      return;
    }

    if (multiSelectMode) {
      setSelectedKeys((prev) =>
        prev.includes(item.key) ? prev.filter((k) => k !== item.key) : [...prev, item.key],
      );
      return;
    }

    setConfirmTarget(item);
    setConfirmEndTime(item.end_time);
  };

  const handleConfirmSingleSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !confirmTarget) return;
    if (!confirmEndTime || !isValidSlotTimeRange(confirmTarget.start_time, confirmEndTime)) {
      notify('End time must be after start time (midnight rollover supported)', 'error');
      return;
    }
    const targetDate = confirmTarget.slot_date || selectedDate;
    setSubmitting(true);
    try {
      const res = await apiClient.confirmDoctorSlots({
        doctor_id: doctorId,
        slots: [
          {
            slot_date: targetDate,
            start_time: confirmTarget.start_time,
            end_time: confirmEndTime,
            max_patients_per_slot: 1,
          },
        ],
      });
      notify(res.message || 'Availability confirmed and slot generated', 'success');
      setConfirmTarget(null);
      await onSlotsChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to confirm slot', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSelectedBatch = async () => {
    if (readOnly) return;
    const targets = unconfirmedOpenItems.filter((item) => selectedKeys.includes(item.key));
    if (targets.length === 0) {
      notify('Select one or more open working-hour slots first', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.confirmDoctorSlots({
        doctor_id: doctorId,
        slots: targets.map((t) => ({
          slot_date: t.slot_date || selectedDate,
          start_time: t.start_time,
          end_time: t.end_time,
          max_patients_per_slot: 1,
        })),
      });
      notify(res.message || `Confirmed ${targets.length} slots`, 'success');
      setSelectedKeys([]);
      setMultiSelectMode(false);
      await onSlotsChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to confirm selected slots', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmAllDaySlots = async () => {
    if (readOnly || selectedDateIsPast || selectedDateOnLeave) return;
    if (unconfirmedOpenItems.length === 0) {
      notify('All working-hour slots for this date are already generated', 'info');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.confirmDoctorSlots({
        doctor_id: doctorId,
        slots: unconfirmedOpenItems.map((t) => ({
          slot_date: t.slot_date || selectedDate,
          start_time: t.start_time,
          end_time: t.end_time,
          max_patients_per_slot: 1,
        })),
      });
      notify(res.message || 'Day slots generated successfully', 'success');
      setSelectedKeys([]);
      await onSlotsChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to generate slots for day', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCustomSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || selectedDateIsPast || selectedDateOnLeave) return;
    if (!customStart || !customEnd || !isValidSlotTimeRange(customStart, customEnd)) {
      notify('Custom slot end time must be after start time (midnight rollover supported)', 'error');
      return;
    }
    if (isSlotEndExpired(selectedDate, customStart, customEnd)) {
      const nowParts = getHospitalNowParts();
      notify(
        `Cannot generate a slot ending at ${customEnd} on ${selectedDate}: end time must be after ${nowParts.timeHHMM} IST.`,
        'error',
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.confirmDoctorSlots({
        doctor_id: doctorId,
        slots: [
          {
            slot_date: selectedDate,
            start_time: customStart,
            end_time: customEnd,
            max_patients_per_slot: 1,
          },
        ],
      });
      notify(res.message || `Custom slot ${customStart}–${customEnd} added`, 'success');
      await onSlotsChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to add custom slot', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Monthly Calendar */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <CalendarIcon className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span>{readOnly ? `${doctorName} · Calendar` : 'Daily Availability Calendar'}</span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {readOnly
                  ? 'Select a date to view open, booked, and unopened shift slots.'
                  : 'Select a day to confirm individual or full-day slots within your shift.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const cur = getHospitalNowParts();
                setViewYear(cur.year);
                setViewMonth(cur.monthIndex);
                setSelectedDate(cur.isoDate);
                setSelectedKeys([]);
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Today
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold text-slate-900">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500">
            {WEEKDAY_SHORT.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {gridCells.map((cell) => {
              const stats = slotStatsByDate.get(cell.isoDate);
              const onLeave = isDateCoveredByApprovedLeave(cell.isoDate, leaves, doctorId);
              const isSelected = cell.isoDate === selectedDate;
              return (
                <button
                  key={cell.isoDate}
                  type="button"
                  onClick={() => {
                    setSelectedDate(cell.isoDate);
                    setSelectedKeys([]);
                  }}
                  aria-label={`Select ${cell.isoDate}`}
                  className={`flex min-h-[54px] flex-col items-center justify-between rounded-lg border p-1.5 text-xs transition-colors ${
                    isSelected
                      ? 'border-teal-700 bg-teal-50 text-teal-950 ring-2 ring-teal-700/20'
                      : cell.isToday
                        ? 'border-teal-300 bg-white text-slate-900 hover:bg-slate-50'
                        : cell.inCurrentMonth
                          ? 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                          : 'border-slate-100 bg-slate-50/50 text-slate-400 hover:bg-slate-50'
                  } ${cell.isPast ? 'opacity-60' : ''}`}
                >
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      cell.isToday ? 'font-bold text-teal-700' : 'font-medium'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>
                  {onLeave ? (
                    <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">
                      Leave
                    </span>
                  ) : stats && stats.total > 0 ? (
                    <span
                      className={`rounded px-1 font-mono text-[10px] font-medium tabular-nums ${
                        stats.available > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {stats.total}s
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-300">·</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
            <span className="font-medium text-slate-600">Today ({formatDisplayDate(todayIso)})</span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                todayStats.total > 0 ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {todayStats.total > 0
                ? `${todayStats.available} open · ${todayStats.booked} booked`
                : '0 slots generated'}
            </span>
          </div>
        </section>

        {/* Right: Shift Window & Slots for Selected Date */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-7">
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {formatDisplayDate(selectedDate)} · {getWeekdayName(selectedDate)}
                </h3>
                {selectedDate === todayIso && (
                  <span className="text-xs font-medium text-teal-700">· Today</span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {readOnly
                  ? `Read-only slot overview: ${selectedDayCounts.open} open · ${selectedDayCounts.booked} booked · ${selectedDayCounts.unconfirmed} not opened.`
                  : 'Click any open time window below to confirm availability and generate that slot for patients.'}
              </p>
            </div>

            {!readOnly && !selectedDateIsPast && !selectedDateOnLeave && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setMultiSelectMode((prev) => !prev);
                    setSelectedKeys([]);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    multiSelectMode
                      ? 'border-teal-700 bg-teal-50 text-teal-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{multiSelectMode ? 'Multi-select On' : 'Multi-select'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAllDaySlots}
                  disabled={submitting || unconfirmedOpenItems.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Confirm All Day ({unconfirmedOpenItems.length})</span>
                </button>
              </div>
            )}

            {readOnly && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 shrink-0">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Admin Read-Only</span>
              </span>
            )}
          </div>

          {/* Registered Shift Window Summary Bar */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-700">
              <Clock className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
              <span className="font-medium">Shift Window:</span>
              <span className="font-mono font-semibold text-slate-900">
                {shiftConfig
                  ? formatShiftSummary(shiftConfig.sessions, shiftConfig.slot_duration_mins)
                  : '09:00–13:00 · 14:00–17:00 (30 min)'}
              </span>
            </div>
            {!readOnly && onRequestShiftChange && (
              <button
                type="button"
                onClick={onRequestShiftChange}
                className="font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                {shiftConfig?.pending_change_request
                  ? 'Shift Change Pending Approval'
                  : 'Request Shift Change'}
              </button>
            )}
          </div>

          {selectedDateIsPast && !readOnly ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Past date selected. Choose today or an upcoming date on the calendar to confirm slots.
            </div>
          ) : selectedDateOnLeave ? (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span>
                {readOnly ? `${doctorName} has` : 'You have'} an approved leave on{' '}
                {formatDisplayDate(selectedDate)}.
              </span>
            </div>
          ) : (
            <>
              {!readOnly && multiSelectMode && selectedKeys.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-xs text-teal-950">
                  <span className="font-medium">
                    {selectedKeys.length} working-hour slot{selectedKeys.length === 1 ? '' : 's'} selected
                  </span>
                  <button
                    type="button"
                    onClick={handleConfirmSelectedBatch}
                    disabled={submitting}
                    className="rounded-lg bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                  >
                    {submitting ? 'Generating...' : 'Confirm & Generate Selected'}
                  </button>
                </div>
              )}

              <div
                className={`mt-4 grid gap-2.5 ${
                  compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
                }`}
              >
                {daySlotItems.map((item) => {
                  const isPicked = selectedKeys.includes(item.key);
                  const itemDate = item.slot_date || selectedDate;
                  const isNextDay = item.dayOffset === 1 || itemDate > selectedDate;
                  const endsAtNextDayMidnight =
                    !isNextDay && doesSessionCrossMidnight(item.start_time, item.end_time);

                  if (item.status === 'UNCONFIRMED') {
                    const expiredNow = isSlotEndExpired(itemDate, item.start_time, item.end_time);
                    const leaveOnTarget = isDateCoveredByApprovedLeave(itemDate, leaves, doctorId);
                    if (readOnly || expiredNow || leaveOnTarget) {
                      return (
                        <div
                          key={item.key}
                          className="flex flex-col items-start rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-2.5 text-left opacity-70"
                        >
                          <span className="font-mono text-xs font-medium text-slate-500 tabular-nums">
                            {item.start_time}–{item.end_time}
                            {isNextDay ? ' (+1d)' : ''}
                          </span>
                          <span className="mt-1 text-[11px] text-slate-400">
                            {leaveOnTarget
                              ? 'Leave active'
                              : expiredNow
                                ? 'Expired (Past time)'
                                : 'Not Opened'}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleSlotTileClick(item)}
                        className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors ${
                          isPicked
                            ? 'border-teal-700 bg-teal-50 ring-2 ring-teal-700/20'
                            : 'border-dashed border-slate-300 bg-white hover:border-teal-600 hover:bg-teal-50/40'
                        }`}
                      >
                        <span className="flex items-center gap-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
                          <span>
                            {item.start_time}–{item.end_time}
                          </span>
                        </span>
                        <span className="mt-1 text-[11px] font-medium text-teal-700">
                          {isPicked
                            ? 'Selected'
                            : isNextDay
                              ? `Next day (${formatDisplayDate(itemDate)})`
                              : endsAtNextDayMidnight
                                ? 'Ends midnight · Click to confirm'
                                : 'Click to confirm'}
                        </span>
                      </button>
                    );
                  }

                  if (item.status === 'AVAILABLE') {
                    return (
                      <div
                        key={item.key}
                        className="flex flex-col items-start rounded-lg border border-emerald-200 bg-emerald-50/80 p-2.5 text-left"
                      >
                        <span className="font-mono text-xs font-semibold text-emerald-950 tabular-nums">
                          {item.start_time}–{item.end_time}
                          {isNextDay ? ' (+1d)' : ''}
                        </span>
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          <span>
                            Open{isNextDay ? ` · ${formatDisplayDate(itemDate)}` : ' · Available'}
                          </span>
                        </span>
                      </div>
                    );
                  }

                  if (item.status === 'BOOKED') {
                    return (
                      <div
                        key={item.key}
                        className="flex flex-col items-start rounded-lg border border-indigo-200 bg-indigo-50/80 p-2.5 text-left"
                      >
                        <span className="font-mono text-xs font-semibold text-indigo-950 tabular-nums">
                          {item.start_time}–{item.end_time}
                          {isNextDay ? ' (+1d)' : ''}
                        </span>
                        <span className="mt-1 text-[11px] font-medium text-indigo-800">
                          Booked ({item.existingSlot?.booked_patients}/
                          {item.existingSlot?.max_patients_per_slot})
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.key}
                      className="flex flex-col items-start rounded-lg border border-slate-200 bg-slate-100 p-2.5 text-left opacity-70"
                    >
                      <span className="font-mono text-xs font-medium text-slate-600 line-through tabular-nums">
                        {item.start_time}–{item.end_time}
                        {isNextDay ? ' (+1d)' : ''}
                      </span>
                      <span className="mt-1 text-[11px] text-slate-500">Cancelled</span>
                    </div>
                  );
                })}
              </div>

              {/* Doctor-only extra custom slot for this single day */}
              {!readOnly && !selectedDateIsPast && (
                <form
                  onSubmit={handleAddCustomSlot}
                  className="mt-5 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div>
                    <label
                      htmlFor="custom-slot-start"
                      className="block text-[11px] font-medium text-slate-600"
                    >
                      Extra Slot Start
                    </label>
                    <input
                      id="custom-slot-start"
                      type="time"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="custom-slot-end"
                      className="block text-[11px] font-medium text-slate-600"
                    >
                      Extra Slot End
                    </label>
                    <input
                      id="custom-slot-end"
                      type="time"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Add &amp; Confirm Custom Slot</span>
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>

      {/* Single Slot Click Confirmation Modal (Doctors only) */}
      <Modal
        open={!readOnly && Boolean(confirmTarget)}
        title="Confirm Doctor Availability & Generate Slot"
        subtitle={
          confirmTarget
            ? `${doctorName} · ${formatDisplayDate(confirmTarget.slot_date || selectedDate)} (${getWeekdayName(confirmTarget.slot_date || selectedDate)})`
            : ''
        }
        onClose={() => setConfirmTarget(null)}
        maxWidth="md"
      >
        {confirmTarget && (
          <form onSubmit={handleConfirmSingleSlot} className="space-y-4">
            <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3.5 text-sm text-teal-950">
              Confirm your availability for{' '}
              <span className="font-mono font-semibold">
                {confirmTarget.start_time} – {confirmEndTime}
              </span>{' '}
              on{' '}
              <span className="font-semibold">
                {formatDisplayDate(confirmTarget.slot_date || selectedDate)}
              </span>
              ? This will generate an active OPD appointment slot in Oracle so patients can book it.
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600">Start Time</label>
                <input
                  type="time"
                  value={confirmTarget.start_time}
                  disabled
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-mono text-sm text-slate-700"
                />
              </div>
              <div>
                <label htmlFor="confirm-slot-end" className="block text-xs font-medium text-slate-600">
                  End Time
                </label>
                <input
                  id="confirm-slot-end"
                  type="time"
                  value={confirmEndTime}
                  onChange={(e) => setConfirmEndTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {submitting ? 'Confirming...' : 'Confirm Availability & Generate Slot'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
