import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Department } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog';
import { StatusIndicator } from '../../components/layout/StatusIndicator';
import { BackendToggle } from '../../components/common/BackendToggle';

export function DepartmentsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasModulePermission(user, 'DEPARTMENTS', 'CREATE');
  const canEdit = hasModulePermission(user, 'DEPARTMENTS', 'UPDATE');
  const canDelete = hasModulePermission(user, 'DEPARTMENTS', 'DELETE');
  const canExport = hasModulePermission(user, 'DEPARTMENTS', 'EXPORT');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<Department | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient.getDepartments();
      setDepartments(list);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load departments', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setModalOpen(true);
  };

  const openEdit = async (dept: Department) => {
    setEditing(dept);
    setName(dept.department_name);
    setDescription(dept.description || '');
    setModalOpen(true);
    try {
      const detail = await apiClient.getDepartmentById(dept.department_id);
      if (detail) {
        setDescription(detail.description || '');
      }
    } catch {
      // Keep base fields if detail lookup fails
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      notify('Department name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiClient.updateDepartment(editing.department_id, {
          department_name: name.trim(),
          description: description.trim(),
        });
        notify('Department updated', 'success');
      } else {
        await apiClient.createDepartment({
          department_name: name.trim(),
          description: description.trim(),
        });
        notify('Department created', 'success');
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save department', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await apiClient.deactivateDepartment(deactivateTarget.department_id);
      notify(`Department "${deactivateTarget.department_name}" deactivated`, 'success');
      setDeactivateTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to deactivate department', 'error');
    } finally {
      setDeactivating(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.department_name.toLowerCase().includes(q) ||
        String(d.department_id).includes(q),
    );
  }, [departments, search]);

  const columns: DataColumn<Department>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">#{row.department_id}</span>
      ),
    },
    {
      key: 'name',
      header: 'Department Name',
      render: (row) => <span className="font-medium text-slate-900">{row.department_name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <StatusIndicator status="ACTIVE" />,
    },
    ...(canEdit || canDelete
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (row: Department) => (
              <div className="inline-flex items-center justify-end gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    aria-label={`Edit ${row.department_name}`}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeactivateTarget(row)}
                    aria-label={`Deactivate ${row.department_name}`}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Deactivate</span>
                  </button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
            {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && (
        <BackendToggle onChanged={() => loadData()} />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Hospital Departments</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Manage clinical departments stored in Oracle GIRISH_DEPARTMENTS.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canExport && (
            <button
              type="button"
              onClick={() => {
                const csv = buildCsvString(
                  ['Department ID', 'Name', 'Description'],
                  filtered.map((d) => [d.department_id, d.department_name, d.description || '']),
                );
                downloadCsvFile('carepulse-departments.csv', csv);
                notify('Departments exported as CSV', 'success');
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Department</span>
            </button>
          )}
        </div>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.department_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search departments..."
        emptyTitle="No departments found"
        emptyDescription="Create an active clinical department to assign doctors and schedules."
        emptyAction={
          canCreate ? (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Add First Department
            </button>
          ) : undefined
        }
      />

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Department' : 'Create Department'}
        subtitle="Persists directly to Oracle GIRISH_DEPARTMENTS via ORDS."
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="dept-name" className="block text-sm font-medium text-slate-700">
              Department name *
            </label>
            <input
              id="dept-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Cardiology"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
          <div>
            <label htmlFor="dept-desc" className="block text-sm font-medium text-slate-700">
              Description
            </label>
            <textarea
              id="dept-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Clinical focus and OPD scope"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Department'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title="Deactivate department?"
        description={
          deactivateTarget
            ? `"${deactivateTarget.department_name}" will be marked inactive (IS_ACTIVE = 'N') in Oracle.`
            : ''
        }
        confirmLabel="Deactivate"
        tone="danger"
        busy={deactivating}
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
