import { BarChart3, Calendar, CreditCard, RefreshCw, Stethoscope, Users } from 'lucide-react';
import type { DashboardSummaryResponse, RouteKey } from '../../types/opd';
import { useAuth } from '../../context/AuthContext';
import { canAccessRoute, hasModulePermission } from '../../utils/permissions';
import { formatCurrencyInr, formatDisplayDate } from '../../utils/rules';
import { ConsultationModeBadge, StatusIndicator } from '../../components/layout/StatusIndicator';

interface DashboardProps {
  data: DashboardSummaryResponse;
  onRefresh: () => void;
  refreshing: boolean;
  onNavigate: (route: RouteKey) => void;
}

export function AdminDashboard({ data, onRefresh, refreshing, onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const { metrics } = data;
  const showAnalytics = canAccessRoute(user, 'analytics');
  const showSlots = canAccessRoute(user, 'slots');
  const showApprovals = canAccessRoute(user, 'approvals');
  const showAppointments = canAccessRoute(user, 'appointments');
  const showPayments = hasModulePermission(user, 'PAYMENTS', 'VIEW');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Hospital Operations Overview</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Live metrics from Oracle APEX ORDS across departments, appointments, slots, and payments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {showAnalytics && (
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              <span>Analytics &amp; Insights</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{refreshing ? 'Refreshing...' : 'Refresh data'}</span>
          </button>
        </div>
      </div>

      {/* 4-column KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Patients</span>
            <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_patients}
          </p>
          <p className="mt-1 text-xs text-slate-500">Registered in GIRISH_PATIENTS</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Doctors</span>
            <Stethoscope className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_doctors}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Across {metrics.total_departments} active departments
          </p>
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
            {metrics.confirmed_appointments} confirmed · {metrics.online_consultations ?? 0} online ·{' '}
            {metrics.face_to_face_consultations ?? 0} face-to-face
          </p>
        </div>

        {showPayments ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Payments Collected</span>
              <CreditCard className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCurrencyInr(metrics.total_payments_amount)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {metrics.payments_count} recorded transactions
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Pending Approvals</span>
              <CreditCard className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {metrics.pending_approvals ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              Awaiting review
            </p>
          </div>
        )}
      </div>

      {/* Operational breakdown strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Slot Availability</p>
            {showSlots && (
              <button
                type="button"
                onClick={() => onNavigate('slots')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                View doctor shifts
              </button>
            )}
          </div>
          <p className="mt-1.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {metrics.available_slots_today} / {metrics.total_slots_today}
          </p>
          <p className="mt-1 text-xs text-slate-500">Doctor-confirmed slots in active schedule</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Token Queue Status</p>
          <p className="mt-1.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {metrics.waiting_tokens} waiting · {metrics.in_consultation_tokens} in consultation
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">{metrics.done_tokens} completed</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Cancellations &amp; Approvals</p>
            {showApprovals && (
              <button
                type="button"
                onClick={() => onNavigate('approvals')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                Review
              </button>
            )}
          </div>
          <p className="mt-1.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {metrics.pending_approvals ?? 0} pending · {metrics.cancelled_appointments} cancelled
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {metrics.held_appointments} held online bookings awaiting payment
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Appointments */}
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Recent Appointments</h3>
            {showAppointments && (
              <button
                type="button"
                onClick={() => onNavigate('appointments')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                Open Appointments
              </button>
            )}
          </div>
          {data.recent_appointments.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No appointments found in GIRISH_APPOINTMENTS.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Reference</th>
                    <th className="px-4 py-2.5">Patient</th>
                    <th className="px-4 py-2.5">Doctor</th>
                    <th className="px-4 py-2.5">Schedule</th>
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
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {appt.patient_name}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {appt.doctor_name || `Slot #${appt.slot_id}`}
                      </td>
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

        {/* Doctor Utilisation */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Doctor Slot Utilisation</h3>
            {showSlots && (
              <button
                type="button"
                onClick={() => onNavigate('slots')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                View Slots
              </button>
            )}
          </div>
          {data.utilisation.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No future slot utilisation metrics available.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.utilisation.slice(0, 6).map((row, idx) => (
                <div
                  key={`${row.department_name}-${row.doctor_name}-${idx}`}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{row.doctor_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {row.department_name} · {row.total_slots} slots
                    </p>
                  </div>
                  <div className="text-right font-mono text-xs tabular-nums shrink-0">
                    <p className="font-semibold text-slate-900">{row.avg_utilisation_pct}%</p>
                    <p className="text-slate-500">
                      {row.total_booked}/{row.total_capacity}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
