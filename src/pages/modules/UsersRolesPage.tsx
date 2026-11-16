import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  KeyRound,
  Lock,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserPlus,
} from 'lucide-react';
import type {
  AccountStatus,
  Department,
  Doctor,
  ManagedUserRecord,
  PermissionAction,
  RoleName,
} from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import { formatDisplayDate } from '../../utils/rules';
import { ROLE_LABELS, hasModulePermission } from '../../utils/permissions';
import {
  ALL_PERMISSION_ACTIONS,
  RBAC_MODULES,
  canActorModifyTargetUser,
  makePermKey,
} from '../../utils/rbac';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

const ALL_ROLES: RoleName[] = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'];

export function UsersRolesPage() {
  const { user: actor, refreshUser } = useAuth();
  const { notify } = useToast();

  const [users, setUsers] = useState<ManagedUserRecord[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [minPasswordLength, setMinPasswordLength] = useState(6);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | RoleName>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AccountStatus>('ALL');

  // Create Staff Account Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createRole, setCreateRole] = useState<'ADMIN' | 'DOCTOR' | 'RECEPTIONIST'>('RECEPTIONIST');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [createNewDoctorProfile, setCreateNewDoctorProfile] = useState(false);
  const [docDeptId, setDocDeptId] = useState('');
  const [docSpec, setDocSpec] = useState('');
  const [docFee, setDocFee] = useState('500');
  const [creating, setCreating] = useState(false);

  // Individual Permission Overrides Modal
  const [permTarget, setPermTarget] = useState<ManagedUserRecord | null>(null);
  const [draftEffectivePerms, setDraftEffectivePerms] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState('');
  const [savingPerms, setSavingPerms] = useState(false);

  // Status Change Modal
  const [statusTarget, setStatusTarget] = useState<ManagedUserRecord | null>(null);
  const [nextStatus, setNextStatus] = useState<AccountStatus>('ACTIVE');
  const [savingStatus, setSavingStatus] = useState(false);

  // Role Change Modal
  const [roleTarget, setRoleTarget] = useState<ManagedUserRecord | null>(null);
  const [nextRole, setNextRole] = useState<RoleName>('RECEPTIONIST');
  const [savingRole, setSavingRole] = useState(false);

  // Reset Password Modal
  const [pwTarget, setPwTarget] = useState<ManagedUserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const canCreate = hasModulePermission(actor, 'USERS', 'CREATE');
  const canUpdateUser = hasModulePermission(actor, 'USERS', 'UPDATE');
  const canExport = hasModulePermission(actor, 'USERS', 'EXPORT');
  const canUpdatePerms =
    actor?.role === 'SUPER_ADMIN' && hasModulePermission(actor, 'PERMISSIONS', 'UPDATE');
  const canUpdateRole = hasModulePermission(actor, 'ROLES', 'UPDATE');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rbacRes, docs, depts, policy] = await Promise.all([
        apiClient.getRbacUsers(),
        apiClient.getDoctors().catch(() => [] as Doctor[]),
        apiClient.getDepartments().catch(() => [] as Department[]),
        apiClient.getSecurityPolicy().catch(() => ({
          status: 'success',
          allow_patient_registration: true,
          min_password_length: 6,
          enforce_strict_role_portal: true,
        })),
      ]);
      setUsers(rbacRes.users || []);
      setDoctors(docs);
      setDepartments(depts);
      setMinPasswordLength(Math.max(6, Number(policy.min_password_length || 6)));
      if (depts[0] && !docDeptId) {
        setDocDeptId(String(depts[0].department_id));
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load user directory', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, docDeptId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        ROLE_LABELS[u.role].toLowerCase().includes(q)
      );
    });
  }, [users, roleFilter, statusFilter, search]);

  const summaryCounts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.status === 'ACTIVE').length,
      inactive: users.filter((u) => u.status === 'INACTIVE').length,
      suspended: users.filter((u) => u.status === 'SUSPENDED').length,
    }),
    [users],
  );

  const openCreateModal = () => {
    setCreateRole('RECEPTIONIST');
    setFullName('');
    setEmail('');
    setPhoneNumber('');
    setPassword('');
    setDoctorId('');
    setCreateNewDoctorProfile(false);
    setDocSpec('');
    setDocFee('500');
    setCreateOpen(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password) {
      notify('Full name, email ID, and initial password are required.', 'error');
      return;
    }
    if (password.length < minPasswordLength) {
      notify(`Password must be at least ${minPasswordLength} characters.`, 'error');
      return;
    }
    if (createRole === 'DOCTOR' && createNewDoctorProfile && !docDeptId) {
      notify('Please choose a clinical department for the new Doctor profile.', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await apiClient.createRbacUser({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role_name: createRole,
        phone_number: phoneNumber.trim() || undefined,
        ...(createRole === 'DOCTOR' && !createNewDoctorProfile && doctorId
          ? { doctor_id: Number(doctorId) }
          : {}),
        ...(createRole === 'DOCTOR' && createNewDoctorProfile
          ? {
              department_id: Number(docDeptId),
              specialization: docSpec.trim() || 'General Medicine',
              consultation_fee: Number(docFee || 500),
            }
          : {}),
      });
      notify(res.message || 'Staff account provisioned', 'success');
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to create user account', 'error');
    } finally {
      setCreating(false);
    }
  };

  // Individual Permission Overrides Handlers
  const openPermissionsModal = (row: ManagedUserRecord) => {
    setPermTarget(row);
    setDraftEffectivePerms(new Set(row.effective_permissions));
    setPermSearch('');
  };

  const toggleUserPerm = (permKey: string) => {
    setDraftEffectivePerms((prev) => {
      const next = new Set(prev);
      if (next.has(permKey)) next.delete(permKey);
      else next.add(permKey);
      return next;
    });
  };

  const handleSaveUserPerms = async () => {
    if (!permTarget) return;
    setSavingPerms(true);
    try {
      const res = await apiClient.updateUserPermissions(permTarget.user_key, {
        effective_permissions: Array.from(draftEffectivePerms),
      });
      notify(res.message || 'User permission overrides saved', 'success');
      setPermTarget(null);
      await Promise.all([loadData(), refreshUser()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save permission overrides', 'error');
    } finally {
      setSavingPerms(false);
    }
  };

  const handleResetUserPerms = async () => {
    if (!permTarget) return;
    setSavingPerms(true);
    try {
      const res = await apiClient.resetUserPermissions(permTarget.user_key);
      notify(res.message || 'Permissions reset to role defaults', 'success');
      setPermTarget(null);
      await Promise.all([loadData(), refreshUser()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to reset user permissions', 'error');
    } finally {
      setSavingPerms(false);
    }
  };

  // Status Change Handler
  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusTarget) return;
    setSavingStatus(true);
    try {
      const res = await apiClient.updateUserStatus(statusTarget.user_key, nextStatus);
      notify(res.message || `Account status updated to ${nextStatus}`, 'success');
      setStatusTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update status', 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  // Role Change Handler
  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleTarget) return;
    setSavingRole(true);
    try {
      const res = await apiClient.updateUserRole(roleTarget.user_key, nextRole);
      notify(res.message || `Assigned role updated to ${ROLE_LABELS[nextRole]}`, 'success');
      setRoleTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to change role', 'error');
    } finally {
      setSavingRole(false);
    }
  };

  // Password Reset Handler
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwTarget) return;
    if (newPassword.length < minPasswordLength) {
      notify(`New password must be at least ${minPasswordLength} characters.`, 'error');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      notify('New password and confirmation do not match.', 'error');
      return;
    }
    setSavingPw(true);
    try {
      const res = await apiClient.resetUserPassword(pwTarget.user_key, newPassword);
      notify(res.message || 'Password reset successfully', 'success');
      setPwTarget(null);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to reset password', 'error');
    } finally {
      setSavingPw(false);
    }
  };

  const handleExportCsv = () => {
    if (filteredUsers.length === 0) {
      notify('No matching users to export', 'info');
      return;
    }
    const headers = [
      'User ID',
      'Full Name',
      'Username',
      'Email',
      'Role',
      'Status',
      'Effective Permissions Count',
      'Custom Grants',
      'Custom Revokes',
      'Created On',
    ];
    const rows = filteredUsers.map((u) => [
      u.user_id,
      u.full_name,
      u.username,
      u.email,
      u.role,
      u.status,
      u.effective_permissions.length,
      u.grants.join(' | '),
      u.revokes.join(' | '),
      u.created_on || '',
    ]);
    downloadCsvFile('carepulse-users-rbac.csv', buildCsvString(headers, rows));
    notify(`Exported ${filteredUsers.length} user record(s) to CSV`, 'success');
  };

  const filteredModulesForOverride = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    if (!q) return RBAC_MODULES;
    return RBAC_MODULES.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.key.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q),
    );
  }, [permSearch]);

  const columns: DataColumn<ManagedUserRecord>[] = [
    {
      key: 'user',
      header: 'User Account',
      render: (row) => (
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-900">{row.full_name}</span>
            {row.is_protected && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                Protected Root
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {row.email} · <span className="font-mono">{row.username}</span>
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <div>
          <span className="font-mono text-xs font-semibold text-slate-800">
            {ROLE_LABELS[row.role]}
          </span>
          <p className="font-mono text-[10px] text-slate-400">{row.role}</p>
        </div>
      ),
    },
    {
      key: 'permissions',
      header: 'Effective Permissions',
      render: (row) => (
        <div className="text-xs">
          <span className="font-mono font-semibold text-slate-900 tabular-nums">
            {row.effective_permissions.length} active
          </span>
          {(row.grants.length > 0 || row.revokes.length > 0) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
              {row.grants.length > 0 && (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                  +{row.grants.length} grant{row.grants.length === 1 ? '' : 's'}
                </span>
              )}
              {row.revokes.length > 0 && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                  -{row.revokes.length} revoke{row.revokes.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusIndicator status={row.status} />,
    },
    {
      key: 'created',
      header: 'Created',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {formatDisplayDate(row.created_on)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Governance Actions',
      align: 'right',
      render: (row) => {
        if (!actor) return null;
        if (row.is_protected) {
          return (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Immutable
            </span>
          );
        }

        const statusCheck = canActorModifyTargetUser(actor, row, 'STATUS');
        const permCheck = canActorModifyTargetUser(actor, row, 'PERMISSIONS');
        const roleCheck = canActorModifyTargetUser(actor, row, 'ROLE');
        const pwCheck = canActorModifyTargetUser(actor, row, 'RESET_PASSWORD');

        return (
          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {canUpdatePerms && permCheck.allowed && (
              <button
                type="button"
                onClick={() => openPermissionsModal(row)}
                aria-label={`Manage permissions for ${row.full_name}`}
                className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                <span>Permissions</span>
              </button>
            )}
            {canUpdateUser && statusCheck.allowed && (
              <button
                type="button"
                onClick={() => {
                  setStatusTarget(row);
                  setNextStatus(row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
                }}
                aria-label={`Update status for ${row.full_name}`}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Shield className="h-3 w-3" aria-hidden="true" />
                <span>Status</span>
              </button>
            )}
            {canUpdateRole && roleCheck.allowed && (
              <button
                type="button"
                onClick={() => {
                  setRoleTarget(row);
                  setNextRole(row.role);
                }}
                aria-label={`Change role for ${row.full_name}`}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <UserCog className="h-3 w-3" aria-hidden="true" />
                <span>Role</span>
              </button>
            )}
            {canUpdateUser && pwCheck.allowed && (
              <button
                type="button"
                onClick={() => {
                  setPwTarget(row);
                  setNewPassword('');
                  setConfirmNewPassword('');
                }}
                aria-label={`Reset password for ${row.full_name}`}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <KeyRound className="h-3 w-3" aria-hidden="true" />
                <span>Password</span>
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">User Management &amp; Overrides</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Search hospital accounts, create staff logins, manage account status, and configure per-user RBAC permission overrides.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canExport && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 whitespace-nowrap"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              <span>Create Staff Account</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Status Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Total Accounts</p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {summaryCounts.total}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Active</p>
          <p className="mt-1 font-mono text-xl font-semibold text-emerald-700 tabular-nums">
            {summaryCounts.active}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Inactive</p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-700 tabular-nums">
            {summaryCounts.inactive}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Suspended</p>
          <p className="mt-1 font-mono text-xl font-semibold text-red-700 tabular-nums">
            {summaryCounts.suspended}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-xs text-teal-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
        <div>
          <span className="font-semibold">RBAC Protection Policy:</span>{' '}
          <span>
            The single Super Admin account cannot be removed, suspended, or restricted. Only the Super Admin may create Admin accounts or grant/revoke individual permission overrides.
          </span>
        </div>
      </div>

      <DataTable
        rows={filteredUsers}
        columns={columns}
        getRowKey={(row) => row.user_key}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name, email, username, or role..."
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'ALL' | RoleName)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Roles</option>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by account status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | AccountStatus)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        }
        emptyTitle="No user accounts match filters"
        emptyDescription="Adjust search or status filters, or create a new staff account."
      />

      {/* 1. Create Staff Account Modal */}
      <Modal
        open={createOpen}
        title="Provision Hospital Staff Account"
        subtitle={
          actor?.role === 'SUPER_ADMIN'
            ? 'Super Admin can create Administrator, Doctor, or Receptionist accounts.'
            : 'Provision Doctor or Receptionist accounts. Patients register via Patient Portal.'
        }
        onClose={() => setCreateOpen(false)}
        maxWidth="lg"
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rbac-new-role" className="block text-sm font-medium text-slate-700">
                Account Role *
              </label>
              <select
                id="rbac-new-role"
                value={createRole}
                onChange={(e) =>
                  setCreateRole(e.target.value as 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST')
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                {actor?.role === 'SUPER_ADMIN' && <option value="ADMIN">Administrator (ADMIN)</option>}
                <option value="DOCTOR">Doctor (DOCTOR)</option>
                <option value="RECEPTIONIST">Receptionist (RECEPTIONIST)</option>
              </select>
            </div>
            <div>
              <label htmlFor="rbac-new-name" className="block text-sm font-medium text-slate-700">
                Full Name *
              </label>
              <input
                id="rbac-new-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={createRole === 'DOCTOR' ? 'Dr. Kavita Rao' : 'Staff Full Name'}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rbac-new-email" className="block text-sm font-medium text-slate-700">
                Email ID *
              </label>
              <input
                id="rbac-new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@hospital.com"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="rbac-new-phone" className="block text-sm font-medium text-slate-700">
                Phone Number
              </label>
              <input
                id="rbac-new-phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="9876543210"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="rbac-new-pw" className="block text-sm font-medium text-slate-700">
              Initial Password * (min {minPasswordLength} chars)
            </label>
            <input
              id="rbac-new-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Minimum ${minPasswordLength} characters`}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            />
          </div>

          {createRole === 'DOCTOR' && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800">Doctor Profile Linking</span>
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={createNewDoctorProfile}
                    onChange={(e) => setCreateNewDoctorProfile(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <span>Create new Doctor profile in Oracle</span>
                </label>
              </div>

              {!createNewDoctorProfile ? (
                <div>
                  <label htmlFor="rbac-link-doc" className="block text-xs font-medium text-slate-600">
                    Link to Existing Doctor (optional)
                  </label>
                  <select
                    id="rbac-link-doc"
                    value={doctorId}
                    onChange={(e) => setDoctorId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-700 focus:outline-none"
                  >
                    <option value="">No linked clinical profile yet</option>
                    {doctors.map((d) => (
                      <option key={d.doctor_id} value={String(d.doctor_id)}>
                        Dr. {d.first_name} {d.last_name} ({d.specialization || 'OPD'})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="rbac-doc-dept" className="block text-xs font-medium text-slate-600">
                      Department *
                    </label>
                    <select
                      id="rbac-doc-dept"
                      value={docDeptId}
                      onChange={(e) => setDocDeptId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-700 focus:outline-none"
                    >
                      {departments.map((d) => (
                        <option key={d.department_id} value={String(d.department_id)}>
                          {d.department_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="rbac-doc-spec" className="block text-xs font-medium text-slate-600">
                      Specialization
                    </label>
                    <input
                      id="rbac-doc-spec"
                      type="text"
                      value={docSpec}
                      onChange={(e) => setDocSpec(e.target.value)}
                      placeholder="Cardiology"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="rbac-doc-fee" className="block text-xs font-medium text-slate-600">
                      Fee (INR)
                    </label>
                    <input
                      id="rbac-doc-fee"
                      type="number"
                      min="0"
                      value={docFee}
                      onChange={(e) => setDocFee(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {creating ? 'Provisioning...' : 'Create Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 2. Individual Permission Overrides Modal */}
      <Modal
        open={Boolean(permTarget)}
        title={permTarget ? `Permission Overrides — ${permTarget.full_name}` : ''}
        subtitle={
          permTarget
            ? `Role baseline: ${ROLE_LABELS[permTarget.role]} (${permTarget.role_permissions.length} defaults). Effective = (Role Defaults ∪ Grants) \\ Revokes.`
            : ''
        }
        onClose={() => setPermTarget(null)}
        maxWidth="2xl"
      >
        {permTarget && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />
                  Inherited
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
                  Granted (+)
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-600" />
                  Revoked (-)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  aria-label="Filter modules in override matrix"
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  placeholder="Filter module..."
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-teal-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleResetUserPerms}
                  disabled={savingPerms}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset to Role Defaults</span>
                </button>
              </div>
            </div>

            <div className="max-h-[48vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Module</th>
                    {ALL_PERMISSION_ACTIONS.map((act) => (
                      <th key={act} className="px-3 py-2.5 text-center">
                        {act}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredModulesForOverride.map((mod) => (
                    <tr key={mod.key} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{mod.label}</p>
                        <p className="text-[11px] text-slate-500">{mod.category}</p>
                      </td>
                      {ALL_PERMISSION_ACTIONS.map((action: PermissionAction) => {
                        const supported = mod.supportedActions.includes(action);
                        if (!supported) {
                          return (
                            <td key={action} className="px-3 py-2.5 text-center text-slate-300">
                              —
                            </td>
                          );
                        }
                        const key = makePermKey(mod.key, action);
                        const inRoleDefault = permTarget.role_permissions.includes(key);
                        const isChecked = draftEffectivePerms.has(key);
                        const stateLabel =
                          inRoleDefault && !isChecked
                            ? 'Revoked (-)'
                            : !inRoleDefault && isChecked
                              ? 'Granted (+)'
                              : isChecked
                                ? 'Inherited'
                                : 'Off';

                        return (
                          <td key={action} className="px-3 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggleUserPerm(key)}
                              aria-label={`${mod.label} ${action}: ${stateLabel}`}
                              className={`inline-flex flex-col items-center gap-0.5 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                                !inRoleDefault && isChecked
                                  ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                                  : inRoleDefault && !isChecked
                                    ? 'border-red-300 bg-red-50 text-red-700 line-through'
                                    : isChecked
                                      ? 'border-teal-300 bg-teal-50/70 text-teal-900'
                                      : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'
                              }`}
                            >
                              <span className="flex items-center gap-1">
                                {isChecked && <Check className="h-3 w-3" aria-hidden="true" />}
                                <span>
                                  {!inRoleDefault && isChecked
                                    ? 'Grant +'
                                    : inRoleDefault && !isChecked
                                      ? 'Revoke -'
                                      : isChecked
                                        ? 'Role'
                                        : 'None'}
                                </span>
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-xs text-slate-600 tabular-nums">
                Effective active permissions:{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {draftEffectivePerms.size}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPermTarget(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveUserPerms}
                  disabled={savingPerms}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {savingPerms ? 'Saving...' : 'Save Overrides'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 3. Account Status Confirmation Modal */}
      <Modal
        open={Boolean(statusTarget)}
        title={statusTarget ? `Update Account Status — ${statusTarget.full_name}` : ''}
        subtitle={statusTarget ? `${statusTarget.email} · Current: ${statusTarget.status}` : ''}
        onClose={() => setStatusTarget(null)}
        maxWidth="md"
      >
        {statusTarget && (
          <form onSubmit={handleSaveStatus} className="space-y-4">
            <div className="space-y-2">
              {(['ACTIVE', 'INACTIVE', 'SUSPENDED'] as AccountStatus[]).map((st) => (
                <label
                  key={st}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                    nextStatus === st
                      ? 'border-teal-700 bg-teal-50/60'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="account-status"
                    value={st}
                    checked={nextStatus === st}
                    onChange={() => setNextStatus(st)}
                    className="mt-1 text-teal-700 focus:ring-teal-700"
                  />
                  <div>
                    <p className="font-semibold text-slate-900">{st}</p>
                    <p className="text-xs text-slate-600">
                      {st === 'ACTIVE'
                        ? 'Restore full sign-in and authorized module access.'
                        : st === 'INACTIVE'
                          ? 'Mark account dormant; blocks sign-in and invalidates active sessions.'
                          : 'Immediately suspend account for security or compliance review.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingStatus || nextStatus === statusTarget.status}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                  nextStatus === 'SUSPENDED'
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-teal-700 hover:bg-teal-800'
                }`}
              >
                {savingStatus ? 'Updating...' : `Confirm ${nextStatus}`}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* 4. Change Role Modal */}
      <Modal
        open={Boolean(roleTarget)}
        title={roleTarget ? `Change Assigned Role — ${roleTarget.full_name}` : ''}
        subtitle={roleTarget ? `Current role: ${ROLE_LABELS[roleTarget.role]}` : ''}
        onClose={() => setRoleTarget(null)}
        maxWidth="md"
      >
        {roleTarget && (
          <form onSubmit={handleSaveRole} className="space-y-4">
            <div>
              <label htmlFor="rbac-change-role" className="block text-sm font-medium text-slate-700">
                New Assigned Role *
              </label>
              <select
                id="rbac-change-role"
                value={nextRole}
                onChange={(e) => setNextRole(e.target.value as RoleName)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                {actor?.role === 'SUPER_ADMIN' && <option value="ADMIN">Administrator (ADMIN)</option>}
                <option value="DOCTOR">Doctor (DOCTOR)</option>
                <option value="RECEPTIONIST">Receptionist (RECEPTIONIST)</option>
                <option value="PATIENT">Patient (PATIENT)</option>
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                SUPER_ADMIN cannot be assigned to another user. Role permissions apply immediately on the user&apos;s next request.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRoleTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingRole || nextRole === roleTarget.role}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {savingRole ? 'Saving...' : 'Update Role'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* 5. Reset Password Modal */}
      <Modal
        open={Boolean(pwTarget)}
        title={pwTarget ? `Reset Password — ${pwTarget.full_name}` : ''}
        subtitle={pwTarget ? `${pwTarget.email} · Clears active login lockouts` : ''}
        onClose={() => setPwTarget(null)}
        maxWidth="md"
      >
        {pwTarget && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label htmlFor="rbac-reset-pw1" className="block text-sm font-medium text-slate-700">
                New Password * (min {minPasswordLength} characters)
              </label>
              <input
                id="rbac-reset-pw1"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="rbac-reset-pw2" className="block text-sm font-medium text-slate-700">
                Confirm New Password *
              </label>
              <input
                id="rbac-reset-pw2"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPwTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPw}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {savingPw ? 'Updating...' : 'Reset Password'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
