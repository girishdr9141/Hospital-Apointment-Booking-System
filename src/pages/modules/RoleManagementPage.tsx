import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Lock, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type { RoleDefinition, RoleName, RouteKey } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface RoleManagementPageProps {
  onNavigate: (route: RouteKey) => void;
  onSelectRoleForMatrix?: (role: RoleName) => void;
}

export function RoleManagementPage({ onNavigate, onSelectRoleForMatrix }: RoleManagementPageProps) {
  const { hasModulePermission } = useAuth();
  const { notify } = useToast();

  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const canConfigureMatrix =
    hasModulePermission('PERMISSIONS', 'VIEW') || hasModulePermission('PERMISSIONS', 'UPDATE');

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getRbacRoles();
      setRoles(res.roles || []);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load role definitions', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const handleOpenMatrix = (role: RoleName) => {
    onSelectRoleForMatrix?.(role);
    onNavigate('permission-management');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Role Management</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Inspect protected system roles, live account counts, registration constraints, and assigned default permissions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRoles()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {/* System Protection Policy Notice */}
      <div className="flex items-start gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
        <div className="space-y-0.5 text-xs sm:text-sm">
          <p className="font-semibold">Protected 5-Role Governance Policy</p>
          <p className="text-teal-900">
            The five core roles (<span className="font-mono">SUPER_ADMIN</span>,{' '}
            <span className="font-mono">ADMIN</span>, <span className="font-mono">DOCTOR</span>,{' '}
            <span className="font-mono">RECEPTIONIST</span>, <span className="font-mono">PATIENT</span>) cannot be deleted or duplicated. Nobody can self-assign{' '}
            <span className="font-mono">SUPER_ADMIN</span> privileges or create additional privileged Super Admin accounts.
          </p>
        </div>
      </div>

      {loading && roles.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {roles.map((role) => (
            <section
              key={role.role}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{role.label}</h3>
                      <span className="font-mono text-xs font-medium text-teal-800">
                        {role.role}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{role.description}</p>
                  </div>
                  {role.is_immutable ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-teal-800 whitespace-nowrap shrink-0">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      IMMUTABLE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-slate-600 whitespace-nowrap shrink-0">
                      <ShieldCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      PROTECTED CORE
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div>
                    <p className="text-[11px] text-slate-500">Assigned Users</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {role.user_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Active Accounts</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-emerald-700 tabular-nums">
                      {role.active_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Permissions</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-teal-800 tabular-nums">
                      {role.permission_count}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5 text-xs">
                <div className="text-slate-600">
                  <span>Public registration: </span>
                  <span className="font-semibold text-slate-900">
                    {role.allow_public_registration ? 'Enabled' : 'Disabled'}
                  </span>
                  {role.max_accounts ? (
                    <span className="ml-2 font-mono text-slate-500">
                      · Max {role.max_accounts} account
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('users-roles')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>View Users</span>
                  </button>
                  {canConfigureMatrix && (
                    <button
                      type="button"
                      onClick={() => handleOpenMatrix(role.role)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{role.is_immutable ? 'Inspect Matrix' : 'Configure Matrix'}</span>
                    </button>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
