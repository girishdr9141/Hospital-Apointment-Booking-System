import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Building2,
  Calendar,
  CalendarPlus,
  Check,
  CheckCheck,
  Clock,
  CreditCard,
  ListOrdered,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type {
  Appointment,
  AuthUser,
  DashboardSummaryResponse,
  PortalNotification,
  RouteKey,
} from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { canAccessRoute, hasModulePermission } from '../../utils/permissions';
import {
  canCancelAppointment,
  canConfirmHeldAppointment,
  formatCurrencyInr,
  formatDisplayDate,
  formatDisplayDateTime,
  formatHoldRemaining,
  isHoldExpired,
  wasAppointmentHoldExpired,
} from '../../utils/rules';
import { ConsultationModeBadge, StatusIndicator } from '../../components/layout/StatusIndicator';

interface PatientDashboardProps {
  user: AuthUser;
  data: DashboardSummaryResponse;
  onRefresh: () => void;
  refreshing: boolean;
  onNavigate: (route: RouteKey) => void;
  notifications?: PortalNotification[];
  onMarkNotificationRead?: (ids: string[]) => Promise<void> | void;
  onMarkAllNotificationsRead?: () => Promise<void> | void;
}

export function PatientDashboard({
  user,
  data,
  onRefresh,
  refreshing,
  onNavigate,
  notifications = [],
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}: PatientDashboardProps) {
  const { notify } = useToast();
  const { metrics, patient_profile } = data;
  const canBook = canAccessRoute(user, 'book-appointment');
  const showAppointments = canAccessRoute(user, 'appointments');
  const canConfirm = hasModulePermission(user, 'APPOINTMENTS', 'UPDATE');
  const canCancel = hasModulePermission(user, 'APPOINTMENTS', 'DELETE');
  const showPayments = hasModulePermission(user, 'PAYMENTS', 'VIEW');
  const showPrescriptions = canAccessRoute(user, 'prescriptions');
  const unreadNotifications = notifications.filter((n) => !n.read);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyApptId, setBusyApptId] = useState<number | null>(null);
  const autoSweptRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!data.recent_appointments.some((a) => a.status === 'HELD')) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data.recent_appointments]);

  useEffect(() => {
    const newlyExpired = data.recent_appointments.filter(
      (a) =>
        a.status === 'HELD' &&
        isHoldExpired(a.hold_expires_at, nowMs) &&
        !autoSweptRef.current.has(a.appointment_id),
    );
    if (newlyExpired.length === 0) return;
    for (const a of newlyExpired) autoSweptRef.current.add(a.appointment_id);
    onRefresh();
  }, [data.recent_appointments, nowMs, onRefresh]);

  const handleQuickHoldAction = async (appt: Appointment, action: 'confirm' | 'cancel') => {
    setBusyApptId(appt.appointment_id);
    try {
      if (action === 'confirm') {
        await apiClient.confirmAppointment(appt.appointment_id);
        notify(`Appointment ${appt.appointment_ref} confirmed`, 'success');
      } else {
        await apiClient.cancelAppointment(appt.appointment_id);
        notify(`Appointment ${appt.appointment_ref} cancelled and slot released`, 'success');
      }
      onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : `Unable to ${action} appointment`, 'error');
      onRefresh();
    } finally {
      setBusyApptId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Welcome, {patient_profile ? `${patient_profile.first_name} ${patient_profile.last_name}` : user.full_name}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {patient_profile?.phone_number ? `Phone ${patient_profile.phone_number}` : user.email}
            {patient_profile?.blood_group ? ` · Blood Group ${patient_profile.blood_group}` : ''}
            {patient_profile?.gender ? ` · ${patient_profile.gender}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canBook && (
            <button
              type="button"
              onClick={() => onNavigate('book-appointment')}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              <span>Book Appointment</span>
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
            {metrics.confirmed_appointments} confirmed · {metrics.held_appointments} held
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Departments</span>
            <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_departments}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {metrics.total_doctors} specialists available
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>My Tokens</span>
            <ListOrdered className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.waiting_tokens + metrics.in_consultation_tokens}
          </p>
          <p className="mt-1 text-xs text-slate-500">Active queue tokens</p>
        </div>

        {showPayments && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Payments</span>
              <CreditCard className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCurrencyInr(metrics.total_payments_amount)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {metrics.payments_count} receipts
            </p>
          </div>
        )}
      </div>

      {/* Prescription Notifications */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <h3 className="text-base font-semibold text-slate-900">Prescription Notifications</h3>
            <span
              className={`rounded px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                unreadNotifications.length > 0
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {unreadNotifications.length} unread
            </span>
          </div>
          <div className="flex items-center gap-3">
            {unreadNotifications.length > 0 && onMarkAllNotificationsRead && (
              <button
                type="button"
                onClick={() => void onMarkAllNotificationsRead()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mark all read</span>
              </button>
            )}
            {showPrescriptions && (
              <button
                type="button"
                onClick={() => onNavigate('prescriptions')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                Open Prescriptions
              </button>
            )}
          </div>
        </div>
        {notifications.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">
            No prescription notifications yet. You will be notified here whenever a doctor issues or updates a prescription.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.slice(0, 8).map((n) => (
              <div
                key={n.id}
                className={`flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between ${
                  n.read ? 'bg-white opacity-75' : 'bg-teal-50/40'
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.read && <span className="h-2 w-2 rounded-full bg-teal-600" />}
                    <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                    {n.appointment_ref && (
                      <span className="font-mono text-xs text-slate-500">
                        Ref: {n.appointment_ref}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-700">{n.message}</p>
                  <p className="text-xs text-slate-500">
                    {n.doctor_name ? `Doctor: ${n.doctor_name} · ` : ''}
                    <span className="font-mono text-[11px]">
                      {formatDisplayDateTime(n.created_at)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {showPrescriptions && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!n.read && onMarkNotificationRead) {
                          void onMarkNotificationRead([n.id]);
                        }
                        onNavigate('prescriptions');
                      }}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                    >
                      Check Prescription
                    </button>
                  )}
                  {!n.read && onMarkNotificationRead && (
                    <button
                      type="button"
                      onClick={() => void onMarkNotificationRead([n.id])}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Mark read</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">My Appointments</h3>
            {showAppointments && (
              <button
                type="button"
                onClick={() => onNavigate('appointments')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                View All
              </button>
            )}
          </div>
          {data.recent_appointments.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-600">You have no appointments booked yet.</p>
              {canBook && (
                <button
                  type="button"
                  onClick={() => onNavigate('book-appointment')}
                  className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
                >
                  Book your first appointment
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Reference</th>
                    <th className="px-4 py-2.5">Doctor</th>
                    <th className="px-4 py-2.5">Date &amp; Time</th>
                    <th className="px-4 py-2.5">Mode</th>
                    <th className="px-4 py-2.5">Status</th>
                    {(canConfirm || canCancel) && <th className="px-4 py-2.5 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recent_appointments.map((appt) => {
                    const expired = wasAppointmentHoldExpired(appt, nowMs);
                    const confirmAllowed = canConfirm && canConfirmHeldAppointment(appt, nowMs);
                    const cancelAllowed =
                      appt.status === 'HELD' && canCancel && canCancelAppointment(appt, nowMs);
                    const isBusy = busyApptId === appt.appointment_id;
                    return (
                      <tr key={appt.appointment_id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-xs text-slate-700 tabular-nums">
                            {appt.appointment_ref}
                          </div>
                          {appt.status === 'HELD' && appt.hold_expires_at && (
                            <div
                              className={`mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] tabular-nums ${
                                expired ? 'text-red-700' : 'text-amber-700'
                              }`}
                            >
                              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span>Hold: {formatHoldRemaining(appt.hold_expires_at, nowMs)}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-900">
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
                          <StatusIndicator
                            status={expired ? 'EXPIRED' : appt.status}
                            label={expired ? 'HOLD EXPIRED' : undefined}
                          />
                        </td>
                        {(canConfirm || canCancel) && (
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {(confirmAllowed || cancelAllowed) ? (
                              <div className="inline-flex items-center gap-1.5">
                                {confirmAllowed && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => void handleQuickHoldAction(appt, 'confirm')}
                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                                  >
                                    <Check className="h-3 w-3" aria-hidden="true" />
                                    <span>Confirm</span>
                                  </button>
                                )}
                                {cancelAllowed && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => void handleQuickHoldAction(appt, 'cancel')}
                                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    <XCircle className="h-3 w-3" aria-hidden="true" />
                                    <span>Cancel</span>
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Hospital Departments</h3>
            {canBook && (
              <button
                type="button"
                onClick={() => onNavigate('book-appointment')}
                className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                Open Booking Calendar
              </button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {data.departments.map((dept) => {
              const docCount = data.doctors.filter(
                (doc) => doc.department_id === dept.department_id,
              ).length;
              return (
                <div
                  key={dept.department_id}
                  className="flex items-center justify-between px-5 py-3"
                >
                  <span className="text-sm font-medium text-slate-900">{dept.department_name}</span>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {docCount} {docCount === 1 ? 'doctor' : 'doctors'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
