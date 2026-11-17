import React, { useEffect, useState } from 'react';
import { Clock, ShieldAlert } from 'lucide-react';
import type { DoctorShiftConfig } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import {
  computeShiftSession,
  DEFAULT_WORKING_DAYS,
  formatShiftSummary,
  validateShiftSessions,
} from '../../utils/calendar';
import { Modal } from '../common/Modal';

interface DoctorShiftModalProps {
  open: boolean;
  mode: 'register' | 'change';
  doctorName: string;
  shift: DoctorShiftConfig | null;
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}

const WEEKDAY_LIST = [
  { key: 'MONDAY', short: 'Mon' },
  { key: 'TUESDAY', short: 'Tue' },
  { key: 'WEDNESDAY', short: 'Wed' },
  { key: 'THURSDAY', short: 'Thu' },
  { key: 'FRIDAY', short: 'Fri' },
  { key: 'SATURDAY', short: 'Sat' },
  { key: 'SUNDAY', short: 'Sun' },
];

export function DoctorShiftModal({
  open,
  mode,
  doctorName,
  shift,
  onClose,
  onCompleted,
}: DoctorShiftModalProps) {
  const { notify } = useToast();

  const [session1Start, setSession1Start] = useState('09:00');
  const [session1End, setSession1End] = useState('13:00');
  const [hasSecondSession, setHasSecondSession] = useState(true);
  const [session2Start, setSession2Start] = useState('14:00');
  const [session2End, setSession2End] = useState('17:00');
  const [durationMins, setDurationMins] = useState<number>(30);
  const [workingDays, setWorkingDays] = useState<string[]>([...DEFAULT_WORKING_DAYS]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const s1 = shift?.sessions?.[0] || { start_time: '09:00', end_time: '13:00' };
    const s2 = shift?.sessions?.[1];
    setSession1Start(s1.start_time);
    setSession1End(s1.end_time);
    if (s2) {
      setHasSecondSession(true);
      setSession2Start(s2.start_time);
      setSession2End(s2.end_time);
    } else {
      setHasSecondSession(false);
      setSession2Start('14:00');
      setSession2End('17:00');
    }
    setDurationMins(shift?.slot_duration_mins || 30);
    setWorkingDays(
      shift?.working_days && shift.working_days.length > 0
        ? [...shift.working_days]
        : [...DEFAULT_WORKING_DAYS],
    );
    setReason('');
  }, [open, shift]);

  const toggleDay = (day: string) => {
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawSessions = [{ start_time: session1Start, end_time: session1End }];
    if (hasSecondSession) {
      rawSessions.push({ start_time: session2Start, end_time: session2End });
    }
    const validation = validateShiftSessions(rawSessions);
    if (!validation.valid) {
      notify(validation.message, 'error');
      return;
    }
    const sessions = validation.sessions;

    if (workingDays.length === 0) {
      notify('Select at least one working day', 'error');
      return;
    }

    if (mode === 'change' && !reason.trim()) {
      notify('Please enter a reason for requesting this shift change', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'register') {
        const res = await apiClient.registerDoctorShift({
          sessions,
          slot_duration_mins: durationMins,
          working_days: workingDays,
        });
        notify(res.message || 'Shift window registered successfully', 'success');
      } else {
        const res = await apiClient.requestShiftChange({
          sessions,
          slot_duration_mins: durationMins,
          working_days: workingDays,
          reason: reason.trim(),
        });
        notify(res.message || 'Shift change request sent to administrator', 'success');
      }
      await onCompleted();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save shift configuration', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        mode === 'register'
          ? 'Register Your OPD Shift Window'
          : 'Request Shift Window Change'
      }
      subtitle={`${doctorName} · ${
        mode === 'register'
          ? 'One-time setup on first login. Future changes require administrator approval.'
          : 'Submitted to administrator Girish DR for approval.'
      }`}
      onClose={onClose}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-teal-200 bg-teal-50/70 p-3 text-xs text-teal-950">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
            <span>
              Set your regular OPD shift window once now. You will not be asked to register it on future logins; if you ever need to change your shift later, you can request a change for admin approval.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              Current registered shift:{' '}
              <span className="font-mono font-semibold">
                {shift ? formatShiftSummary(shift.sessions, shift.slot_duration_mins) : 'Not set'}
              </span>
              . Changes take effect after Girish DR approves the request.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-xs font-semibold text-slate-800">Primary Shift Window *</p>
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="shift-s1-start" className="block text-[11px] font-medium text-slate-600">
                  Start Time
                </label>
                <input
                  id="shift-s1-start"
                  type="time"
                  value={session1Start}
                  onChange={(e) => setSession1Start(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="shift-s1-end" className="block text-[11px] font-medium text-slate-600">
                  End Time
                </label>
                <input
                  id="shift-s1-end"
                  type="time"
                  value={session1End}
                  onChange={(e) => setSession1End(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs sm:text-sm"
                />
              </div>
            </div>
            {computeShiftSession(session1Start, session1End)?.crossesMidnight && (
              <p className="mt-2 text-[11px] font-medium text-teal-800">
                Overnight shift · ends {session1End} next day (+1d)
              </p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <label className="flex items-center justify-between text-xs font-semibold text-slate-800">
              <span>Afternoon / Second Session</span>
              <input
                type="checkbox"
                checked={hasSecondSession}
                onChange={(e) => setHasSecondSession(e.target.checked)}
                className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
              />
            </label>
            {hasSecondSession ? (
              <>
                <div className="mt-2.5 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="shift-s2-start" className="block text-[11px] font-medium text-slate-600">
                      Start Time
                    </label>
                    <input
                      id="shift-s2-start"
                      type="time"
                      value={session2Start}
                      onChange={(e) => setSession2Start(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs sm:text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="shift-s2-end" className="block text-[11px] font-medium text-slate-600">
                      End Time
                    </label>
                    <input
                      id="shift-s2-end"
                      type="time"
                      value={session2End}
                      onChange={(e) => setSession2End(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs sm:text-sm"
                    />
                  </div>
                </div>
                {computeShiftSession(session2Start, session2End)?.crossesMidnight && (
                  <p className="mt-2 text-[11px] font-medium text-teal-800">
                    Overnight session · ends {session2End} next day (+1d)
                  </p>
                )}
              </>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Single continuous shift enabled (no afternoon split).
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="shift-duration" className="block text-sm font-medium text-slate-700">
              Consultation Slot Length
            </label>
            <select
              id="shift-duration"
              value={durationMins}
              onChange={(e) => setDurationMins(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
            >
              <option value={15}>15 minutes</option>
              <option value={20}>20 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <span className="block text-sm font-medium text-slate-700">Working Days</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {WEEKDAY_LIST.map((day) => {
                const active = workingDays.includes(day.key);
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => toggleDay(day.key)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-teal-700 bg-teal-700 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {mode === 'change' && (
          <div>
            <label htmlFor="shift-change-reason" className="block text-sm font-medium text-slate-700">
              Reason for Shift Change *
            </label>
            <textarea
              id="shift-change-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Moving morning OPD hours to 08:30–12:30 for surgical rounds."
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-3">
          {mode === 'change' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting
              ? 'Saving...'
              : mode === 'register'
                ? 'Confirm & Register Shift Window'
                : 'Submit Shift Change Request'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
