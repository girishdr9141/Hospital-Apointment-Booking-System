import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UserX,
  Video,
} from 'lucide-react';
import type { RouteKey, SuperAdminOverviewResponse } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { ROLE_LABELS } from '../../utils/permissions';
import { formatDisplayDate, formatDisplayDateTime } from '../../utils/rules';
import { ConsultationModeBadge, StatusIndicator } from '../../components/layout/StatusIndicator';
import { DashboardSkeleton } from '../../components/layout/SkeletonBlock';

interface SuperAdminDashboardProps {
  onNavigate: (route: RouteKey) => void;
}

export function SuperAdminDashboard({ onNavigate }: SuperAdminDashboardProps) {
  const { notify } = useToast();
  const [overview, setOverview] = useState<SuperAdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getRbacOverview();
      setOverview(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load Super Admin overview';
      setErrorMsg(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (loading && !overview) {
    return <DashboardSkeleton />;
  }

  if (errorMsg && !overview) {
    return (
      <div className="rounded-xl border border-red-200 bg-white p-6">
        <h2 className="text-base font-semibold text-red-900">Unable to load Governance Overview</h2>
        <p className="mt-1 text-sm text-red-700">{errorMsg}</p>
        <button
          type="button"
          onClick={() => void loadOverview()}
          className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!overview) return null;

  const {
    metrics,
    recent_registrations,
    recent_permission_changes,
    recent_security_activities,
    roles,
    consultation_metrics,
    recent_appointments = [],
  } = overview;

  return (
    <div className="space-y-6">
      {/* Header & Governance Quick Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Super Admin Governance Overview
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Centralized identity directory, protected 5-role hierarchy, granular RBAC permissions, and security telemetry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('permission-management')}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            <span>Permission Matrix</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('users-roles')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <UserCog className="h-4 w-4" aria-hidden="true" />
            <span>User Management</span>
          </button>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 8 Requested Governance KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Users</span>
            <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_users}
          </p>
          <p className="mt-1 text-xs text-slate-500">1 immutable Super Admin + managed directory</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Administrators</span>
            <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_admins}
          </p>
          <p className="mt-1 text-xs text-slate-500">Provisioned exclusively by Super Admin</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Doctors</span>
            <Stethoscope className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_doctors}
          </p>
          <p className="mt-1 text-xs text-slate-500">Clinical practitioners across OPD</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Receptionists</span>
            <UserPlus className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_receptionists}
          </p>
          <p className="mt-1 text-xs text-slate-500">Front-desk booking &amp; check-in staff</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Patients</span>
            <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total_patients}
          </p>
          <p className="mt-1 text-xs text-slate-500">Registered outpatient portal accounts</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Accounts</span>
            <UserCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {metrics.active_accounts}
          </p>
          <p className="mt-1 text-xs text-slate-500">Permitted to authenticate &amp; access APIs</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Inactive Accounts</span>
            <UserX className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.inactive_accounts}
          </p>
          <p className="mt-1 text-xs text-slate-500">Deactivated accounts blocked at login</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Suspended Accounts</span>
            <ShieldAlert className="h-4 w-4 text-red-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-red-700 tabular-nums">
            {metrics.suspended_accounts}
          </p>
          <p className="mt-1 text-xs text-slate-500">Suspended sessions immediately revoked</p>
        </div>
      </div>

      {/* Role Hierarchy Snapshot & Quick Links */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Protected 5-Role Hierarchy</h3>
            <p className="text-xs text-slate-500">
              All five core system roles remain protected against deletion or unauthorized privilege escalation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
            <button
              type="button"
              onClick={() => onNavigate('role-management')}
              className="text-teal-700 hover:underline whitespace-nowrap"
            >
              Open Role Management
            </button>
            <button
              type="button"
              onClick={() => onNavigate('security-settings')}
              className="text-teal-700 hover:underline whitespace-nowrap"
            >
              Security Settings
            </button>
            <button
              type="button"
              onClick={() => onNavigate('audit-logs')}
              className="text-teal-700 hover:underline whitespace-nowrap"
            >
              Full Audit Trail
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
          {roles.map((r) => (
            <div key={r.role} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-slate-900">{r.role}</span>
                {r.is_immutable ? (
                  <Lock className="h-3.5 w-3.5 text-teal-700" aria-label="Immutable core role" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">{r.label}</p>
              <div className="mt-3 flex items-center justify-between font-mono text-xs tabular-nums text-slate-700">
                <span>
                  {r.active_count}/{r.user_count} active
                </span>
                <span className="text-teal-800 font-semibold">{r.permission_count} perms</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* OPD Consultation Mode Summary & Recent Appointments */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              OPD Consultation Mode Overview
            </h3>
            <p className="text-xs text-slate-500">
              Active appointments segmented by Online vs Face-to-Face consultation mode.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-medium text-sky-800">
              <Video className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
              <span>
                Online: <strong>{consultation_metrics?.online_consultations ?? 0}</strong>
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-teal-800">
              <UserCheck className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
              <span>
                Face-to-Face: <strong>{consultation_metrics?.face_to_face_consultations ?? 0}</strong>
              </span>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('appointments')}
              className="font-medium text-teal-700 hover:underline whitespace-nowrap"
            >
              Open Appointments
            </button>
          </div>
        </div>
        {recent_appointments.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No live OPD appointments recorded yet.
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
                {recent_appointments.slice(0, 6).map((appt) => (
                  <tr key={appt.appointment_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700 tabular-nums">
                      {appt.appointment_ref}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {appt.patient_name || `Patient #${appt.patient_id}`}
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

      {/* 3 Live Governance Activity Panels */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent User Registrations */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Recent User Registrations</h3>
            <button
              type="button"
              onClick={() => onNavigate('users-roles')}
              className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
            >
              Manage Users
            </button>
          </div>
          {recent_registrations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No user accounts found.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recent_registrations.map((u) => (
                <div key={u.user_key} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{u.full_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {ROLE_LABELS[u.role]} · {u.email}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusIndicator status={u.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Permission Changes */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Recent Permission Changes</h3>
            <button
              type="button"
              onClick={() => onNavigate('permission-management')}
              className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
            >
              Edit Matrix
            </button>
          </div>
          {recent_permission_changes.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No permission or role modifications recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recent_permission_changes.map((log) => (
                <div key={log.id} className="px-5 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {log.action}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {formatDisplayDateTime(log.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">{log.details}</p>
                  <p className="text-[11px] text-slate-500">
                    Actor: {log.actor_name} · Target: {log.target_label || 'System'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Security Activities */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">Recent Security Activities</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('audit-logs')}
              className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
            >
              Audit Logs
            </button>
          </div>
          {recent_security_activities.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No recent security events logged.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recent_security_activities.map((log) => (
                <div key={log.id} className="px-5 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono text-xs font-semibold ${
                        log.severity === 'critical'
                          ? 'text-red-700'
                          : log.severity === 'warning'
                            ? 'text-amber-800'
                            : 'text-slate-900'
                      }`}
                    >
                      {log.action}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {formatDisplayDateTime(log.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">{log.details}</p>
                  <p className="text-[11px] text-slate-500">
                    {log.actor_name} ({log.actor_role})
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
