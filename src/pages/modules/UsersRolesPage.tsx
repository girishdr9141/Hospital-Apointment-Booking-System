import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, UserPlus } from 'lucide-react';
import type { Doctor, PermissionRecord, RoleName, RoleRecord, UserAccount } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { formatDisplayDate } from '../../utils/rules';
import { SINGLE_ADMIN_EMAIL, SINGLE_ADMIN_NAME } from '../../utils/permissions';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { MissingEndpointBanner } from '../../components/common/MissingEndpointBanner';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

export function UsersRolesPage() {
  const { notify } = useToast();

  const [tab, setTab] = useState<'users' | 'roles' | 'permissions'>('users');
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingEndpoint, setMissingEndpoint] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  // Create User Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [roleName, setRoleName] = useState<RoleName>('RECEPTIONIST');
  const [doctorId, setDoctorId] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMissingEndpoint(null);
    try {
      const docs = await apiClient.getDoctors();
      setDoctors(docs);

      if (tab === 'users') {
        try {
          const list = await apiClient.getUsers();
          setUsers(list);
        } catch (err) {
          if (isEndpointNotDeployedError(err)) {
            setMissingEndpoint('GET /users');
            setUsers([]);
          } else {
            notify(err instanceof Error ? err.message : 'Failed to load users', 'error');
          }
        }
      } else if (tab === 'roles') {
        try {
          const list = await apiClient.getRoles();
          setRoles(list);
        } catch (err) {
          if (isEndpointNotDeployedError(err)) {
            setMissingEndpoint('GET /roles');
            setRoles([]);
          } else {
            notify(err instanceof Error ? err.message : 'Failed to load roles', 'error');
          }
        }
      } else {
        try {
          const list = await apiClient.getPermissions();
          setPermissions(list);
        } catch (err) {
          if (isEndpointNotDeployedError(err)) {
            setMissingEndpoint('GET /permissions');
            setPermissions([]);
          } else {
            notify(err instanceof Error ? err.message : 'Failed to load permissions', 'error');
          }
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load directory', 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeReceptionistCount = useMemo(
    () =>
      users.filter(
        (u) =>
          u.is_active === 'Y' &&
          u.role_name === 'RECEPTIONIST' &&
          (u.email || '').trim().toLowerCase() !== 'reception@hospital.com',
      ).length,
    [users],
  );

  const receptionistLimitReached = activeReceptionistCount >= 2;

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !email.trim() || !fullName.trim() || password.length < 6) {
      notify('Username, email, full name, and a 6+ char password are required', 'error');
      return;
    }
    if (roleName === 'RECEPTIONIST' && receptionistLimitReached) {
      notify('Maximum of 2 active Receptionist accounts reached.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiClient.createUser({
        username: username.trim(),
        email: email.trim(),
        full_name: fullName.trim(),
        password,
        role_name: roleName,
        phone_number: phoneNumber.trim() || undefined,
        doctor_id: roleName === 'DOCTOR' && doctorId ? Number(doctorId) : null,
      });
      notify('User account created in GIRISH_USERS', 'success');
      setCreateOpen(false);
      setUsername('');
      setEmail('');
      setFullName('');
      setPhoneNumber('');
      setPassword('');
      await loadData();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('POST /users ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to create user', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role_name !== roleFilter) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q)
      );
    });
  }, [users, roleFilter, search]);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) =>
        r.role_name.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q),
    );
  }, [roles, search]);

  const filteredPermissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter(
      (p) =>
        p.permission_name.toLowerCase().includes(q) ||
        p.resource_name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q),
    );
  }, [permissions, search]);

  const userColumns: DataColumn<UserAccount>[] = [
    {
      key: 'user',
      header: 'User',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.full_name}</p>
          <p className="text-xs text-slate-500">
            {row.username} · {row.email}
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Assigned Role',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-slate-800">
          {row.role_name || '—'}
        </span>
      ),
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
      key: 'status',
      header: 'Status',
      render: (row) => <StatusIndicator status={row.is_active === 'Y' ? 'ACTIVE' : 'INACTIVE'} />,
    },
  ];

  const roleColumns: DataColumn<RoleRecord>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (row) => <span className="font-mono text-xs text-slate-500">#{row.role_id}</span>,
    },
    {
      key: 'name',
      header: 'Role Name',
      render: (row) => <span className="font-mono text-xs font-semibold text-slate-900">{row.role_name}</span>,
    },
    {
      key: 'desc',
      header: 'Description',
      render: (row) => <span className="text-slate-600">{row.description || '—'}</span>,
    },
    {
      key: 'perms',
      header: 'Permissions',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700 tabular-nums">
          {row.permission_count ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Active',
      render: (row) => <StatusIndicator status={row.is_active === 'Y' ? 'ACTIVE' : 'INACTIVE'} />,
    },
  ];

  const permissionColumns: DataColumn<PermissionRecord>[] = [
    {
      key: 'name',
      header: 'Permission Key',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-slate-900">{row.permission_name}</span>
      ),
    },
    {
      key: 'resource',
      header: 'Resource / Action',
      render: (row) => (
        <span className="font-mono text-xs text-slate-600">
          {row.resource_name} · {row.action_name}
        </span>
      ),
    },
    {
      key: 'desc',
      header: 'Description',
      render: (row) => <span className="text-slate-600">{row.description || '—'}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Users, Roles &amp; Permissions</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Manage hospital accounts, RBAC role assignments, and granular permissions in Oracle.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          <span>Create User</span>
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
        <div>
          <span className="font-semibold">Account Provisioning Policy:</span>{' '}
          <span>
            {SINGLE_ADMIN_NAME} ({SINGLE_ADMIN_EMAIL}) is the sole Administrator. Doctors and up to 2 Receptionists ({activeReceptionistCount}/2 active) are created by Admin; Patients self-register via the Patient Portal.
          </span>
        </div>
      </div>

      {/* Segmented Control */}
      <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
        {(['users', 'roles', 'permissions'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setSearch('');
            }}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap ${
              tab === key
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      {missingEndpoint && (
        <MissingEndpointBanner
          endpoint={missingEndpoint}
          description="Unable to reach this ORDS endpoint in module girish_opd_api."
        />
      )}

      {tab === 'users' && (
        <DataTable
          rows={filteredUsers}
          columns={userColumns}
          getRowKey={(row) => row.user_id}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search username, email, or name..."
          filters={
            <select
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Roles</option>
              <option value="ADMIN">Admin</option>
              <option value="DOCTOR">Doctor</option>
              <option value="RECEPTIONIST">Receptionist</option>
              <option value="PATIENT">Patient</option>
            </select>
          }
          emptyTitle="No user accounts listed"
          emptyDescription="Create a user account or clear your active search filters."
        />
      )}

      {tab === 'roles' && (
        <DataTable
          rows={filteredRoles}
          columns={roleColumns}
          getRowKey={(row) => row.role_id}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search roles..."
          emptyTitle="No roles listed"
          emptyDescription="Hospital roles (ADMIN, DOCTOR, PATIENT, RECEPTIONIST) from GIRISH_ROLES will appear here."
        />
      )}

      {tab === 'permissions' && (
        <DataTable
          rows={filteredPermissions}
          columns={permissionColumns}
          getRowKey={(row) => row.permission_id}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search permission key or resource..."
          emptyTitle="No permissions listed"
          emptyDescription="Granular permissions from GIRISH_PERMISSIONS will appear here."
        />
      )}

      <Modal
        open={createOpen}
        title="Create Hospital User Account"
        subtitle="Creates a user in GIRISH_USERS and assigns a role in GIRISH_USER_ROLES."
        onClose={() => setCreateOpen(false)}
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="usr-full" className="block text-sm font-medium text-slate-700">
                Full name *
              </label>
              <input
                id="usr-full"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="usr-username" className="block text-sm font-medium text-slate-700">
                Username *
              </label>
              <input
                id="usr-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="usr-email" className="block text-sm font-medium text-slate-700">
                Email *
              </label>
              <input
                id="usr-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="usr-phone" className="block text-sm font-medium text-slate-700">
                Phone number
              </label>
              <input
                id="usr-phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="usr-role" className="block text-sm font-medium text-slate-700">
                Role *
              </label>
              <select
                id="usr-role"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value as RoleName)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="RECEPTIONIST" disabled={receptionistLimitReached}>
                  RECEPTIONIST ({activeReceptionistCount}/2 active)
                </option>
                <option value="DOCTOR">DOCTOR</option>
              </select>
            </div>
            <div>
              <label htmlFor="usr-pass" className="block text-sm font-medium text-slate-700">
                Initial password *
              </label>
              <input
                id="usr-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          {roleName === 'DOCTOR' && (
            <div>
              <label htmlFor="usr-doc" className="block text-sm font-medium text-slate-700">
                Link to Doctor record
              </label>
              <select
                id="usr-doc"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="">Select doctor</option>
                {doctors.map((d) => (
                  <option key={d.doctor_id} value={String(d.doctor_id)}>
                    Dr. {d.first_name} {d.last_name}
                  </option>
                ))}
              </select>
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
              disabled={saving}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
