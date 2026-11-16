import { Calendar, CalendarPlus, ListOrdered, RefreshCw, UserPlus, Users } from 'lucide-react';
import type { DashboardSummaryResponse, RouteKey } from '../../types/opd';
import { useAuth } from '../../context/AuthContext';
import { canAccessRoute, hasModulePermission } from '../../utils/permissions';
import { formatCurrencyInr, formatDisplayDate } from '../../utils/rules';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

interface ReceptionistDashboardProps {
  data: DashboardSummaryResponse;
  onRefresh: () => void;
  refreshing: boolean;
  onNavigate: (route: RouteKey) => void;
}

export function ReceptionistDashboard({
  data,
  onRefresh,
  refreshing,
  onNavigate,
}: ReceptionistDashboardProps) {
  const { user } = useAuth();
  const { metrics } = data;
  const canRegisterPatient = canAccessRoute(user, 'register-patient');
  const canBookAppointment = canAccessRoute(user, 'book-appointment');
  const showSlots = canAccessRoute(user, 'slots');
  const showAppointments = canAccessRoute(user, 'appointments');
  const showPayments = hasModulePermission(user, 'PAYMENTS', 'VIEW');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Front-Desk Operations</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Manage patient registrations, walk-in bookings, slot availability, and daily token queues.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canRegisterPatient && (
            <button
              type="button"
              onClick={() => onNavigate('register-patient')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              <span>Register Patient</span>
            </button>
          )}
          {canBookAppointment && (
            <button
              type="button"
              onClick={() => onNavigate('book-appointment')}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              <span>Book Walk-in / OPD</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh dashboard data"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Registered Patients</span>
            <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_patients}
          </p>
          <p className="mt-1 text-xs text-slate-500">Searchable at front desk</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Appointments</span>
            <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_appointments}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {metrics.held_appointments} held · {metrics.confirmed_appointments} confirmed
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Open Slots</span>
            <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.available_slots_today}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Out of {metrics.total_slots_today} active slots
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Token Queue</span>
            <ListOrdered className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.waiting_tokens}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {showPayments
              ? `Waiting · ${formatCurrencyInr(metrics.total_payments_amount)} collected`
              : `${metrics.in_consultation_tokens} in consultation · ${metrics.done_tokens} done`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Upcoming Available Slots</h3>
            {showSlots && (
              <button
                type="button"
                onClick={() => onNavigate('slots')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                All Slots
              </button>
            )}
          </div>
          {data.upcoming_slots.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No upcoming slots returned from Oracle ORDS.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Time</th>
                    <th className="px-4 py-2.5">Doctor</th>
                    <th className="px-4 py-2.5">Department</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.upcoming_slots.slice(0, 8).map((slot) => (
                    <tr key={slot.slot_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700 tabular-nums">
                        {formatDisplayDate(slot.slot_date)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-900 tabular-nums">
                        {slot.start_time} – {slot.end_time}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {slot.doctor_name || `Template #${slot.template_id}`}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{slot.department_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <StatusIndicator status={slot.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Recent Bookings</h3>
            {showAppointments && (
              <button
                type="button"
                onClick={() => onNavigate('appointments')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                Manage
              </button>
            )}
          </div>
          {data.recent_appointments.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No bookings yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recent_appointments.slice(0, 6).map((appt) => (
                <div key={appt.appointment_id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {appt.patient_name}
                    </span>
                    <StatusIndicator status={appt.status} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                    {appt.appointment_ref} · {appt.doctor_name || `Slot #${appt.slot_id}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
