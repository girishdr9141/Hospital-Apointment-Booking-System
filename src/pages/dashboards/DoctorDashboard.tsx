import { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  ListOrdered,
  RefreshCw,
} from 'lucide-react';
import type { AuthUser, DashboardSummaryResponse, RouteKey } from '../../types/opd';
import { canAccessRoute, hasModulePermission } from '../../utils/permissions';
import { formatCurrencyInr, formatDisplayDate } from '../../utils/rules';
import {
  doesDoctorNeedDailySlotsPrompt,
  formatShiftSummary,
  getTodayIsoLocal,
} from '../../utils/calendar';
import { ConsultationModeBadge, StatusIndicator } from '../../components/layout/StatusIndicator';
import { DoctorSlotCalendar } from '../../components/calendar/DoctorSlotCalendar';
import { DoctorShiftModal } from '../../components/modals/DoctorShiftModal';

interface DoctorDashboardProps {
  user: AuthUser;
  data: DashboardSummaryResponse;
  onRefresh: () => Promise<void> | void;
  refreshing: boolean;
  onNavigate: (route: RouteKey) => void;
}

export function DoctorDashboard({
  user,
  data,
  onRefresh,
  refreshing,
  onNavigate,
}: DoctorDashboardProps) {
  const {
    metrics,
    doctor_profile,
    doctor_templates = [],
    doctor_shift = null,
    doctor_all_slots,
    doctor_leaves = [],
  } = data;

  const [shiftChangeOpen, setShiftChangeOpen] = useState(false);

  const todayIso = getTodayIsoLocal();
  const doctorId = user.doctor_id ?? doctor_profile?.doctor_id ?? 0;
  const doctorDisplayName = doctor_profile
    ? `Dr. ${doctor_profile.first_name} ${doctor_profile.last_name}`
    : user.full_name;
  const allDoctorSlots = doctor_all_slots ?? data.upcoming_slots;
  const needsDailySlots = doesDoctorNeedDailySlotsPrompt(
    allDoctorSlots,
    doctor_leaves,
    doctorId,
    todayIso,
  );

  const showLeaves = canAccessRoute(user, 'doctor-leaves');
  const showSlots = canAccessRoute(user, 'slots');
  const showAppointments = canAccessRoute(user, 'appointments');
  const canManageSlots = hasModulePermission(user, 'SLOTS', 'CREATE');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{doctorDisplayName}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {user.department_name || 'Clinical Department'}
            {doctor_profile?.specialization ? ` · ${doctor_profile.specialization}` : ''}
            {doctor_profile ? ` · Fee ${formatCurrencyInr(doctor_profile.consultation_fee)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showLeaves && canManageSlots && (
            <button
              type="button"
              onClick={() => onNavigate('doctor-leaves')}
              className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap"
            >
              Request Leave
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Daily Slot Confirmation Status */}
      {needsDailySlots ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                Mandatory Daily Slot Confirmation Required ({formatDisplayDate(todayIso)})
              </p>
              <p className="mt-0.5 text-xs text-amber-900">
                You have not generated any working-hours slots for today yet. Click any slot on your calendar below to confirm your availability for today.
              </p>
            </div>
          </div>
          {showSlots && (
            <button
              type="button"
              onClick={() => onNavigate('slots')}
              className="rounded-lg bg-amber-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-amber-900 whitespace-nowrap shrink-0"
            >
              Open Full Schedule
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span>
            {data.doctor_on_leave_today
              ? `Approved leave active for today (${formatDisplayDate(todayIso)}).`
              : `Today's availability confirmed (${data.doctor_slots_today_count ?? metrics.total_slots_today} slot(s) active for ${formatDisplayDate(todayIso)}).`}
          </span>
        </div>
      )}

      {/* Personal Doctor KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>My Appointments</span>
            <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_appointments}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {metrics.confirmed_appointments} confirmed · {metrics.online_consultations ?? 0} online ·{' '}
            {metrics.face_to_face_consultations ?? 0} face-to-face
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Today&apos;s Slots</span>
            <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {data.doctor_slots_today_count ?? metrics.total_slots_today}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {metrics.available_slots_today} open for booking
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>My Shift Window</span>
            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-sm font-semibold text-slate-900 tabular-nums">
            {doctor_shift
              ? formatShiftSummary(doctor_shift.sessions, doctor_shift.slot_duration_mins)
              : '09:00–13:00 · 14:00–17:00'}
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">
              {doctor_shift?.pending_change_request
                ? 'Change pending admin approval'
                : doctor_shift?.is_registered
                  ? 'Registered shift'
                  : 'Registration required'}
            </span>
            {!doctor_shift?.pending_change_request && canManageSlots && (
              <button
                type="button"
                onClick={() => setShiftChangeOpen(true)}
                className="font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                {doctor_shift?.is_registered ? 'Request Change' : 'Register'}
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Patient Queue</span>
            <ListOrdered className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.waiting_tokens}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {metrics.in_consultation_tokens} in consultation · {metrics.done_tokens} done
          </p>
        </div>
      </div>

      {/* Interactive Doctor Working-Hours Slot Calendar */}
      {doctorId > 0 && showSlots && (
        <DoctorSlotCalendar
          doctorId={doctorId}
          doctorName={doctorDisplayName}
          slots={allDoctorSlots}
          templates={doctor_templates}
          leaves={doctor_leaves}
          shiftConfig={doctor_shift}
          readOnly={!canManageSlots}
          onRequestShiftChange={canManageSlots ? () => setShiftChangeOpen(true) : undefined}
          onSlotsChanged={onRefresh}
          compact
        />
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">My Appointments</h3>
          {showAppointments && (
            <button
              type="button"
              onClick={() => onNavigate('appointments')}
              className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
            >
              View All Appointments
            </button>
          )}
        </div>
        {data.recent_appointments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No patient appointments are currently scheduled for your profile.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Reference</th>
                  <th className="px-4 py-2.5">Patient</th>
                  <th className="px-4 py-2.5">Date &amp; Time</th>
                  <th className="px-4 py-2.5">Mode</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent_appointments.map((appt) => (
                  <tr key={appt.appointment_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700 tabular-nums">
                      {appt.appointment_ref}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{appt.patient_name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">
                      {appt.slot_date
                        ? `${formatDisplayDate(appt.slot_date)} ${appt.start_time || ''}`
                        : formatDisplayDate(appt.created_on)}
                    </td>
                    <td className="px-4 py-2.5">
                      <ConsultationModeBadge mode={appt.consultation_mode} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusIndicator status={appt.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DoctorShiftModal
        open={shiftChangeOpen}
        mode={doctor_shift?.is_registered ? 'change' : 'register'}
        doctorName={doctorDisplayName}
        shift={doctor_shift}
        onClose={() => setShiftChangeOpen(false)}
        onCompleted={onRefresh}
      />
    </div>
  );
}
