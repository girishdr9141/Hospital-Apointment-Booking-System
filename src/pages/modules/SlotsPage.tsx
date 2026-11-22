import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, Search, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import type {
  Appointment,
  Department,
  Doctor,
  DoctorLeave,
  DoctorShiftConfig,
  Slot,
  SlotTemplate,
} from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { enrichAppointments, enrichSlots, formatDisplayDate, getIsoDatePart } from '../../utils/rules';
import {
  formatShiftSummary,
  getTodayIsoLocal,
  isSlotEndExpired,
} from '../../utils/calendar';
import { StatusIndicator } from '../../components/layout/StatusIndicator';
import { DoctorSlotCalendar } from '../../components/calendar/DoctorSlotCalendar';
import { DoctorShiftModal } from '../../components/modals/DoctorShiftModal';

interface SlotsPageProps {
  onDoctorSlotsChanged?: () => Promise<void> | void;
}

export function SlotsPage({ onDoctorSlotsChanged }: SlotsPageProps) {
  const { user } = useAuth();
  const { notify } = useToast();
  const isDoctor = user?.role === 'DOCTOR';
  const canManageDoctorSlots = isDoctor && hasModulePermission(user, 'SLOTS', 'CREATE');

  const [slots, setSlots] = useState<Slot[]>([]);
  const [templates, setTemplates] = useState<SlotTemplate[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [leaves, setLeaves] = useState<DoctorLeave[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<DoctorShiftConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const [docPickerSearch, setDocPickerSearch] = useState('');
  const [calendarDoctorId, setCalendarDoctorId] = useState<number>(user?.doctor_id || 0);
  const [slotListFilter, setSlotListFilter] = useState<'ALL' | 'OPEN' | 'BOOKED'>('ALL');
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const doctorDetailRef = useRef<HTMLDivElement | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rawSlots, rawTemplates, rawAppts, docs, activeDepts, rawLeaves, shiftsRes] =
        await Promise.all([
          apiClient.getSlots(),
          apiClient.getSlotTemplates(),
          apiClient.getAppointments().catch(() => [] as Appointment[]),
          apiClient.getDoctors(),
          apiClient.getDepartments(),
          apiClient.getLeaves().catch(() => [] as DoctorLeave[]),
          apiClient.getDoctorShifts().catch(() => ({ shifts: [] as DoctorShiftConfig[] })),
        ]);
      const depts = await apiClient.resolveDepartmentsForIds(
        docs.map((d) => d.department_id),
        activeDepts,
      );

      const joinedSlots = enrichSlots(rawSlots, rawTemplates, docs, depts);
      const joinedAppts = enrichAppointments(rawAppts, joinedSlots, docs);

      if (isDoctor && user?.doctor_id) {
        setSlots(joinedSlots.filter((s) => s.doctor_id === user.doctor_id));
        setTemplates(rawTemplates.filter((t) => t.doctor_id === user.doctor_id));
        setAppointments(joinedAppts.filter((a) => a.doctor_id === user.doctor_id));
        setLeaves(rawLeaves.filter((l) => l.doctor_id === user.doctor_id));
        setCalendarDoctorId(user.doctor_id);
      } else {
        setSlots(joinedSlots);
        setTemplates(rawTemplates);
        setAppointments(joinedAppts);
        setLeaves(rawLeaves);
        if (docs[0] && !calendarDoctorId) {
          setCalendarDoctorId(docs[0].doctor_id);
        }
      }
      setDoctors(docs);
      setDepartments(depts);
      setShifts(shiftsRes.shifts || []);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load slots', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, isDoctor, user?.doctor_id, calendarDoctorId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refreshAll = useCallback(async () => {
    await loadData();
    await onDoctorSlotsChanged?.();
  }, [loadData, onDoctorSlotsChanged]);

  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.department_id, d.department_name])),
    [departments],
  );

  const shiftByDoctorId = useMemo(
    () => new Map(shifts.map((s) => [s.doctor_id, s])),
    [shifts],
  );

  const apptBySlotId = useMemo(() => {
    const map = new Map<number, Appointment>();
    for (const a of appointments) {
      if (a.status !== 'CANCELLED') {
        map.set(a.slot_id, a);
      }
    }
    return map;
  }, [appointments]);

  const slotCountsByDoctor = useMemo(() => {
    const map = new Map<number, { open: number; booked: number }>();
    for (const s of slots) {
      if (!s.doctor_id || s.status === 'CANCELLED') continue;
      const cur = map.get(s.doctor_id) || { open: 0, booked: 0 };
      if (s.booked_patients > 0 || s.status === 'SOLD_OUT') {
        if (!isSlotEndExpired(s.slot_date, s.start_time, s.end_time)) {
          cur.booked += 1;
        }
      } else if (
        s.status === 'AVAILABLE' &&
        s.booked_patients < s.max_patients_per_slot &&
        !isSlotEndExpired(s.slot_date, s.start_time, s.end_time)
      ) {
        cur.open += 1;
      }
      map.set(s.doctor_id, cur);
    }
    return map;
  }, [slots]);

  const filteredDoctorCards = useMemo(() => {
    const q = docPickerSearch.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter((d) => {
      const full = `Dr. ${d.first_name} ${d.last_name}`.toLowerCase();
      const dept = (deptNameById.get(d.department_id) || '').toLowerCase();
      return (
        full.includes(q) ||
        dept.includes(q) ||
        (d.specialization || '').toLowerCase().includes(q)
      );
    });
  }, [doctors, docPickerSearch, deptNameById]);

  const activeCalendarDoctor = useMemo(
    () => doctors.find((d) => d.doctor_id === calendarDoctorId) || doctors[0] || null,
    [doctors, calendarDoctorId],
  );

  const activeDoctorShift = activeCalendarDoctor
    ? shiftByDoctorId.get(activeCalendarDoctor.doctor_id) || null
    : null;

  const calendarSlots = useMemo(
    () =>
      slots
        .filter((s) => {
          if (s.doctor_id !== activeCalendarDoctor?.doctor_id || s.status === 'CANCELLED') {
            return false;
          }
          const isBooked = s.booked_patients > 0 || s.status === 'SOLD_OUT';
          if (isBooked) {
            return !isSlotEndExpired(s.slot_date, s.start_time, s.end_time);
          }
          return !isSlotEndExpired(s.slot_date, s.start_time, s.end_time);
        })
        .sort((a, b) => {
          const dCmp = getIsoDatePart(a.slot_date).localeCompare(getIsoDatePart(b.slot_date));
          if (dCmp !== 0) return dCmp;
          return (a.start_time || '').localeCompare(b.start_time || '');
        }),
    [slots, activeCalendarDoctor],
  );

  const activeDoctorOpenSlots = useMemo(
    () =>
      calendarSlots.filter(
        (s) =>
          s.status === 'AVAILABLE' &&
          s.booked_patients < s.max_patients_per_slot &&
          !isSlotEndExpired(s.slot_date, s.start_time, s.end_time),
      ),
    [calendarSlots],
  );

  const activeDoctorBookedSlots = useMemo(
    () =>
      calendarSlots.filter(
        (s) =>
          (s.booked_patients > 0 || s.status === 'SOLD_OUT') &&
          !isSlotEndExpired(s.slot_date, s.start_time, s.end_time),
      ),
    [calendarSlots],
  );

  const displayedDoctorSlots = useMemo(() => {
    if (slotListFilter === 'OPEN') return activeDoctorOpenSlots;
    if (slotListFilter === 'BOOKED') return activeDoctorBookedSlots;
    return calendarSlots;
  }, [slotListFilter, activeDoctorOpenSlots, activeDoctorBookedSlots, calendarSlots]);

  const calendarTemplates = useMemo(
    () => templates.filter((t) => t.doctor_id === activeCalendarDoctor?.doctor_id),
    [templates, activeCalendarDoctor],
  );

  const calendarLeaves = useMemo(
    () => leaves.filter((l) => l.doctor_id === activeCalendarDoctor?.doctor_id),
    [leaves, activeCalendarDoctor],
  );

  const handleSelectDoctor = (docId: number) => {
    setCalendarDoctorId(docId);
    setSlotListFilter('ALL');
    window.setTimeout(() => {
      doctorDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const todayIso = getTodayIsoLocal();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {isDoctor ? 'My Shift Window & Daily Slot Calendar' : 'Doctor Shift Windows & Slots'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {isDoctor
              ? 'Confirm daily OPD slots within your registered shift window. Shift changes require administrator approval.'
              : 'Tap any doctor to view their registered shift window along with all open and booked slots (read-only).'}
          </p>
        </div>
        {canManageDoctorSlots && (
          <button
            type="button"
            disabled={Boolean(activeDoctorShift?.pending_change_request)}
            onClick={() => setShiftModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Clock className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <span>
              {activeDoctorShift?.pending_change_request
                ? 'Shift Change Pending Approval'
                : activeDoctorShift?.is_registered
                  ? 'Request Shift Change'
                  : 'Register Shift Window'}
            </span>
          </button>
        )}
      </div>

      {/* Doctor's Own Shift Banner */}
      {isDoctor && activeDoctorShift && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <span className="font-medium text-slate-700">Registered Shift:</span>
            <span className="font-mono font-semibold text-slate-900">
              {formatShiftSummary(activeDoctorShift.sessions, activeDoctorShift.slot_duration_mins)}
            </span>
            <span className="text-xs text-slate-500">
              · {activeDoctorShift.working_days.map((d) => d.slice(0, 3)).join(', ')}
            </span>
          </div>
          {activeDoctorShift.pending_change_request ? (
            <span className="text-xs font-medium text-amber-700">
              Pending admin review:{' '}
              {formatShiftSummary(
                activeDoctorShift.pending_change_request.requested_sessions,
                activeDoctorShift.pending_change_request.requested_slot_duration_mins,
              )}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              {activeDoctorShift.is_registered ? 'Confirmed shift' : 'First-time registration pending'}
            </span>
          )}
        </div>
      )}

      {/* Admin & Receptionist: Tap any doctor card to inspect their Shift Window, Open & Booked Slots */}
      {!isDoctor && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Select Doctor to View Shift Window &amp; Slots
              </h3>
              <p className="text-xs text-slate-500">
                Only slots explicitly opened by each doctor (plus booked appointments) are shown. Tap any doctor below to view their schedule.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Filter doctors"
                value={docPickerSearch}
                onChange={(e) => setDocPickerSearch(e.target.value)}
                placeholder="Search doctor or department..."
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          {loading && doctors.length === 0 ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDoctorCards.map((doc) => {
                const docShift = shiftByDoctorId.get(doc.doctor_id);
                const counts = slotCountsByDoctor.get(doc.doctor_id) || { open: 0, booked: 0 };
                const isSelected = activeCalendarDoctor?.doctor_id === doc.doctor_id;
                return (
                  <button
                    key={doc.doctor_id}
                    type="button"
                    onClick={() => handleSelectDoctor(doc.doctor_id)}
                    className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-teal-700 bg-teal-50/70 ring-2 ring-teal-700/20'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                        <Stethoscope className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                        <span>
                          Dr. {doc.first_name} {doc.last_name}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                        {counts.open} open · {counts.booked} booked
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {deptNameById.get(doc.department_id) || `Dept #${doc.department_id}`}
                      {doc.specialization ? ` · ${doc.specialization}` : ''}
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] font-medium text-teal-900">
                      Shift:{' '}
                      {docShift
                        ? formatShiftSummary(docShift.sessions, docShift.slot_duration_mins)
                        : 'Default 09:00–17:00'}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Selected Doctor: Open & Booked Slots Breakdown + Calendar */}
      {activeCalendarDoctor && (
        <div ref={doctorDetailRef} className="space-y-5 scroll-mt-20">
          {/* Open & Booked Slots Overview Card for the clicked doctor */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Dr. {activeCalendarDoctor.first_name} {activeCalendarDoctor.last_name} — Open &amp; Booked Slots
                </h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  {deptNameById.get(activeCalendarDoctor.department_id) || 'OPD'}
                  {activeDoctorShift
                    ? ` · Shift: ${formatShiftSummary(activeDoctorShift.sessions, activeDoctorShift.slot_duration_mins)}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-mono text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {activeDoctorOpenSlots.length} Open
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-xs font-medium text-amber-900">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {activeDoctorBookedSlots.length} Booked
                </span>
              </div>
            </div>

            {/* Filter pills */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'ALL', label: `All (${calendarSlots.length})` },
                  { key: 'OPEN', label: `Open (${activeDoctorOpenSlots.length})` },
                  { key: 'BOOKED', label: `Booked (${activeDoctorBookedSlots.length})` },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSlotListFilter(item.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    slotListFilter === item.key
                      ? 'bg-teal-700 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {displayedDoctorSlots.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
                <CalendarClock className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-slate-700">
                  No {slotListFilter === 'ALL' ? 'open or booked' : slotListFilter.toLowerCase()} slots for Dr.{' '}
                  {activeCalendarDoctor.first_name} {activeCalendarDoctor.last_name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {isDoctor
                    ? 'Click any available working-hour window on your calendar below to open slots.'
                    : 'This doctor has not opened any slots yet. Inspect their shift window on the calendar below.'}
                </p>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Time Window</th>
                      <th className="px-4 py-2.5">Booking Details</th>
                      <th className="px-4 py-2.5 text-right">Booked</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedDoctorSlots.map((slot) => {
                      const dStr = getIsoDatePart(slot.slot_date);
                      const isBooked = slot.booked_patients > 0 || slot.status === 'SOLD_OUT';
                      const appt = apptBySlotId.get(slot.slot_id);
                      return (
                        <tr key={slot.slot_id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                            {formatDisplayDate(slot.slot_date)}
                            {dStr === todayIso ? ' (Today)' : ''}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                            {slot.start_time} – {slot.end_time}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            {appt
                              ? `${appt.patient_name} (${appt.appointment_ref})`
                              : isBooked
                                ? 'Booked appointment'
                                : 'Open for patient booking'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                            {slot.booked_patients}/{slot.max_patients_per_slot}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusIndicator status={isBooked ? 'BOOKED' : slot.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <DoctorSlotCalendar
            doctorId={activeCalendarDoctor.doctor_id}
            doctorName={`Dr. ${activeCalendarDoctor.first_name} ${activeCalendarDoctor.last_name}`}
            slots={calendarSlots}
            templates={calendarTemplates}
            leaves={calendarLeaves}
            shiftConfig={activeDoctorShift}
            readOnly={!canManageDoctorSlots}
            onRequestShiftChange={canManageDoctorSlots ? () => setShiftModalOpen(true) : undefined}
            onSlotsChanged={refreshAll}
          />
        </div>
      )}

      {canManageDoctorSlots && activeCalendarDoctor && (
        <DoctorShiftModal
          open={shiftModalOpen}
          mode={activeDoctorShift?.is_registered ? 'change' : 'register'}
          doctorName={`Dr. ${activeCalendarDoctor.first_name} ${activeCalendarDoctor.last_name}`}
          shift={activeDoctorShift}
          onClose={() => setShiftModalOpen(false)}
          onCompleted={refreshAll}
        />
      )}
    </div>
  );
}
