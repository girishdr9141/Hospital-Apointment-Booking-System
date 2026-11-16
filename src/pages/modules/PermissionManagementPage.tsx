import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
} from 'lucide-react';
import type { ModuleDefinition, PermissionAction, RoleDefinition, RoleName } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  ALL_PERMISSION_ACTIONS,
  DEFAULT_ROLE_PERMISSION_MATRIX,
  RBAC_MODULES,
  diffPermissionSets,
  makePermKey,
} from '../../utils/rbac';
import { Modal } from '../../components/common/Modal';

interface PermissionManagementPageProps {
  initialRole?: RoleName;
}

const CATEGORY_ORDER: ModuleDefinition['category'][] = [
  'Overview',
  'Clinical',
  'Operations',
  'Analytics',
  'Administration',
];

export function PermissionManagementPage({ initialRole }: PermissionManagementPageProps) {
  const { user, refreshUser, hasModulePermission } = useAuth();
  const { notify } = useToast();

  const canUpdateMatrix =
    user?.role === 'SUPER_ADMIN' || hasModulePermission('PERMISSIONS', 'UPDATE');

  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [modules, setModules] = useState<ModuleDefinition[]>(RBAC_MODULES);
  const [defaultsMap, setDefaultsMap] =
    useState<Record<RoleName, string[]>>(DEFAULT_ROLE_PERMISSION_MATRIX);
  const [selectedRole, setSelectedRole] = useState<RoleName>(initialRole || 'DOCTOR');
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);

  useEffect(() => {
    if (initialRole) {
      setSelectedRole(initialRole);
    }
  }, [initialRole]);

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getRbacRoles();
      setRoles(res.roles || []);
      if (res.modules && res.modules.length > 0) setModules(res.modules);
      if (res.defaults) setDefaultsMap(res.defaults);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load permission matrix', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadMatrix();
  }, [loadMatrix]);

  const activeRoleDef = useMemo(
    () => roles.find((r) => r.role === selectedRole) || null,
    [roles, selectedRole],
  );

  const savedPermissions = useMemo(
    () => activeRoleDef?.permissions || defaultsMap[selectedRole] || [],
    [activeRoleDef, defaultsMap, selectedRole],
  );

  useEffect(() => {
    setDraftPermissions(savedPermissions);
  }, [savedPermissions, selectedRole]);

  const isReadOnlyRole =
    selectedRole === 'SUPER_ADMIN' ||
    !canUpdateMatrix ||
    (user?.role !== 'SUPER_ADMIN' && (selectedRole === 'ADMIN' || selectedRole === user?.role));

  const draftSet = useMemo(() => new Set(draftPermissions), [draftPermissions]);
  const pendingDiff = useMemo(
    () => diffPermissionSets(savedPermissions, draftPermissions),
    [savedPermissions, draftPermissions],
  );
  const isDirty = pendingDiff.added.length > 0 || pendingDiff.removed.length > 0;

  const groupedModules = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: modules.filter((m) => m.category === category),
    })).filter((g) => g.items.length > 0);
  }, [modules]);

  const togglePermission = (permKey: string) => {
    if (isReadOnlyRole) return;
    setDraftPermissions((prev) =>
      prev.includes(permKey) ? prev.filter((p) => p !== permKey) : [...prev, permKey],
    );
  };

  const handleSelectAll = () => {
    if (isReadOnlyRole) return;
    const all = modules.flatMap((m) => m.supportedActions.map((a) => makePermKey(m.key, a)));
    setDraftPermissions(all);
  };

  const handleDeselectAll = () => {
    if (isReadOnlyRole) return;
    setDraftPermissions([]);
  };

  const handleResetToDefaultsDraft = () => {
    if (isReadOnlyRole) return;
    setDraftPermissions([...(defaultsMap[selectedRole] || [])]);
  };

  const handleConfirmSave = async () => {
    if (isReadOnlyRole) return;
    setSaving(true);
    try {
      const res = await apiClient.updateRolePermissions(selectedRole, draftPermissions);
      setRoles(res.roles);
      setDiffModalOpen(false);
      notify(res.message || `Updated permissions for ${selectedRole}`, 'success');
      await refreshUser();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save role permissions', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFactoryResetServer = async () => {
    if (isReadOnlyRole || user?.role !== 'SUPER_ADMIN') return;
    setSaving(true);
    try {
      const res = await apiClient.resetRolePermissions(selectedRole);
      setRoles(res.roles);
      notify(res.message || `Reset ${selectedRole} to factory defaults`, 'success');
      await refreshUser();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to reset role permissions', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectableRoles: RoleName[] = ['DOCTOR', 'RECEPTIONIST', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Granular Permission Matrix</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Configure module-by-action (<span className="font-mono text-xs">MODULE:ACTION</span>) permissions per role. Changes apply immediately on backend APIs and dynamic navigation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMatrix()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Role Selector Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {selectableRoles.map((rKey) => {
            const rDef = roles.find((r) => r.role === rKey);
            const active = selectedRole === rKey;
            return (
              <button
                key={rKey}
                type="button"
                onClick={() => setSelectedRole(rKey)}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {rKey === 'SUPER_ADMIN' && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{rDef?.label || rKey}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? 'text-teal-100' : 'text-slate-500'
                  }`}
                >
                  {rDef ? rDef.permission_count : (defaultsMap[rKey] || []).length}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isReadOnlyRole && (
            <>
              <button
                type="button"
                onClick={handleSelectAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <CheckSquare className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>Select All</span>
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Square className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                <span>Deselect All</span>
              </button>
              <button
                type="button"
                onClick={handleResetToDefaultsDraft}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                <span>Load Defaults</span>
              </button>
              {user?.role === 'SUPER_ADMIN' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleFactoryResetServer()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60 whitespace-nowrap"
                >
                  <span>Reset Saved Role</span>
                </button>
              )}
              <button
                type="button"
                disabled={!isDirty || saving}
                onClick={() => setDiffModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  Save Changes{isDirty ? ` (+${pendingDiff.added.length}/-${pendingDiff.removed.length})` : ''}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {isReadOnlyRole && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
          <span>
            {selectedRole === 'SUPER_ADMIN'
              ? 'SUPER_ADMIN holds full immutable access across all 19 modules and cannot be restricted.'
              : 'Read-only preview. Only the Super Admin can alter Administrator or peer role permissions.'}
          </span>
        </div>
      )}

      {/* Module x Action Matrix Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">Module &amp; Capability</th>
              {ALL_PERMISSION_ACTIONS.map((act) => (
                <th key={act} className="px-3 py-3 text-center font-mono">
                  {act}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groupedModules.map((group) => (
              <Fragment key={group.category}>
                <tr className="bg-slate-50/70">
                  <td
                    colSpan={6}
                    className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {group.category}
                  </td>
                </tr>
                {group.items.map((mod) => (
                  <tr key={mod.key} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{mod.label}</p>
                      <p className="text-xs text-slate-500">
                        <span className="font-mono text-[11px] text-slate-600">{mod.key}</span> ·{' '}
                        {mod.description}
                      </p>
                    </td>
                    {ALL_PERMISSION_ACTIONS.map((action: PermissionAction) => {
                      const supported = mod.supportedActions.includes(action);
                      const permKey = makePermKey(mod.key, action);
                      const checked = draftSet.has(permKey);
                      const wasChecked = savedPermissions.includes(permKey);
                      const changed = checked !== wasChecked;
                      return (
                        <td key={action} className="px-3 py-3 text-center">
                          {supported ? (
                            <label
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                                isReadOnlyRole
                                  ? 'cursor-not-allowed border-slate-100 bg-slate-50'
                                  : changed
                                    ? 'cursor-pointer border-amber-300 bg-amber-50'
                                    : checked
                                      ? 'cursor-pointer border-teal-200 bg-teal-50/70'
                                      : 'cursor-pointer border-slate-200 bg-white hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                aria-label={`${mod.label} ${action}`}
                                checked={checked}
                                disabled={isReadOnlyRole}
                                onChange={() => togglePermission(permKey)}
                                className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                              />
                            </label>
                          ) : (
                            <span className="font-mono text-xs text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Diff Preview Confirmation Modal */}
      <Modal
        open={diffModalOpen}
        title={`Review Permission Changes — ${activeRoleDef?.label || selectedRole}`}
        subtitle="Inspect exact added and removed permissions before applying them live."
        onClose={() => setDiffModalOpen(false)}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3.5">
              <p className="text-xs font-semibold text-emerald-900">
                Added Permissions (+{pendingDiff.added.length})
              </p>
              {pendingDiff.added.length === 0 ? (
                <p className="mt-2 text-xs text-emerald-800/80">None</p>
              ) : (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-emerald-900">
                  {pendingDiff.added.map((p) => (
                    <li key={p}>+ {p}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-red-200 bg-red-50/60 p-3.5">
              <p className="text-xs font-semibold text-red-900">
                Removed Permissions (-{pendingDiff.removed.length})
              </p>
              {pendingDiff.removed.length === 0 ? (
                <p className="mt-2 text-xs text-red-800/80">None</p>
              ) : (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-red-900">
                  {pendingDiff.removed.map((p) => (
                    <li key={p}>- {p}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-600">
            Total active permissions after save:{' '}
            <span className="font-mono font-semibold text-slate-900">{draftPermissions.length}</span>.
            All users with the <span className="font-mono">{selectedRole}</span> role (unless overridden individually) will immediately reflect this matrix.
          </p>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDiffModalOpen(false)}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleConfirmSave()}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {saving ? 'Applying...' : 'Confirm & Save Matrix'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
