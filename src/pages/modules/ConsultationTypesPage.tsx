import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ConsultationType, Department } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { formatCurrencyInr } from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog';
import { MissingEndpointBanner } from '../../components/common/MissingEndpointBanner';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

export function ConsultationTypesPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasModulePermission(user, 'DEPARTMENTS', 'CREATE');
  const canEdit = hasModulePermission(user, 'DEPARTMENTS', 'UPDATE');
  const canDelete = hasModulePermission(user, 'DEPARTMENTS', 'DELETE');

  const [types, setTypes] = useState<ConsultationType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingGetEndpoint, setMissingGetEndpoint] = useState(false);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConsultationType | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationMins, setDurationMins] = useState('20');
  const [fee, setFee] = useState('500');
  const [saving, setSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<ConsultationType | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMissingGetEndpoint(false);
    try {
      const depts = await apiClient.getDepartments();
      setDepartments(depts);
      setAllDepartments(depts);
      try {
        const list = await apiClient.getConsultationTypes();
        setTypes(list);
        const resolved = await apiClient.resolveDepartmentsForIds(
          list.map((t) => t.department_id),
          depts,
        );
        setAllDepartments(resolved);
      } catch (err) {
        if (isEndpointNotDeployedError(err)) {
          setMissingGetEndpoint(true);
          setTypes([]);
        } else {
          notify(err instanceof Error ? err.message : 'Failed to load consultation types', 'error');
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load departments', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deptMap = useMemo(
    () => new Map(allDepartments.map((d) => [d.department_id, d.department_name])),
    [allDepartments],
  );

  const openCreate = () => {
    setEditing(null);
    setDepartmentId(departments[0] ? String(departments[0].department_id) : '');
    setName('');
    setDescription('');
    setDurationMins('20');
    setFee('500');
    setModalOpen(true);
  };

  const openEdit = (item: ConsultationType) => {
    setEditing(item);
    setDepartmentId(String(item.department_id));
    setName(item.consultation_type_name);
    setDescription(item.description || '');
    setDurationMins(String(item.duration_mins));
    setFee(item.consultation_fee !== null && item.consultation_fee !== undefined ? String(item.consultation_fee) : '');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!departmentId || !name.trim() || !durationMins) {
      notify('Department, consultation type name, and duration are required', 'error');
      return;
    }
    const mins = Number(durationMins);
    if (Number.isNaN(mins) || mins <= 0) {
      notify('Duration must be greater than 0 minutes', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        department_id: Number(departmentId),
        consultation_type_name: name.trim(),
        description: description.trim() || undefined,
        duration_mins: mins,
        consultation_fee: fee ? Number(fee) : null,
      };
      if (editing) {
        await apiClient.updateConsultationType(editing.consultation_type_id, payload);
        notify('Consultation type updated in Oracle', 'success');
      } else {
        await apiClient.createConsultationType(payload);
        notify('Consultation type created in Oracle', 'success');
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save consultation type', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await apiClient.deactivateConsultationType(deactivateTarget.consultation_type_id);
      notify(`Consultation type "${deactivateTarget.consultation_type_name}" deactivated`, 'success');
      setDeactivateTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to deactivate consultation type', 'error');
    } finally {
      setDeactivating(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return types;
    return types.filter(
      (t) =>
        t.consultation_type_name.toLowerCase().includes(q) ||
        (deptMap.get(t.department_id) || '').toLowerCase().includes(q),
    );
  }, [types, search, deptMap]);

  const columns: DataColumn<ConsultationType>[] = [
    {
      key: 'name',
      header: 'Consultation Type',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.consultation_type_name}</p>
          {row.description && <p className="text-xs text-slate-500">{row.description}</p>}
        </div>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      render: (row) => (
        <span className="text-slate-700">
          {row.department_name || deptMap.get(row.department_id) || `Dept #${row.department_id}`}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700 tabular-nums">
          {row.duration_mins} min
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Fee',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-slate-900 tabular-nums">
          {row.consultation_fee !== null && row.consultation_fee !== undefined
            ? formatCurrencyInr(row.consultation_fee)
            : 'Doctor default'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusIndicator status={row.is_active === 'N' ? 'INACTIVE' : 'ACTIVE'} />,
    },
    ...(canEdit || canDelete
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (row: ConsultationType) => (
              <div className="inline-flex items-center justify-end gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Consultation Types</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Configure outpatient visit durations and consultation fees per department.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Consultation Type</span>
          </button>
        )}
      </div>

      {missingGetEndpoint && (
        <MissingEndpointBanner
          endpoint="GET /consultation-types/"
          description="Unable to reach the consultation types ORDS endpoint. Verify module girish_opd_api is published."
        />
      )}

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.consultation_type_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search consultation types..."
        emptyTitle="No consultation types listed"
        emptyDescription="You can create a consultation type right now using the Add Consultation Type button."
      />

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Consultation Type' : 'Add Consultation Type'}
        subtitle="Persists to Oracle GIRISH_CONSULTATION_TYPES."
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="ct-dept" className="block text-sm font-medium text-slate-700">
              Department *
            </label>
            <select
              id="ct-dept"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            >
              {departments.map((d) => (
                <option key={d.department_id} value={String(d.department_id)}>
                  {d.department_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ct-name" className="block text-sm font-medium text-slate-700">
              Consultation type name *
            </label>
            <input
              id="ct-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., First Visit Assessment"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ct-duration" className="block text-sm font-medium text-slate-700">
                Duration (minutes) *
              </label>
              <input
                id="ct-duration"
                type="number"
                min="5"
                value={durationMins}
                onChange={(e) => setDurationMins(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="ct-fee" className="block text-sm font-medium text-slate-700">
                Fee (INR)
              </label>
              <input
                id="ct-fee"
                type="number"
                min="0"
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label htmlFor="ct-desc" className="block text-sm font-medium text-slate-700">
              Description
            </label>
            <textarea
              id="ct-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
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
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Consultation Type'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title="Deactivate consultation type?"
        description={
          deactivateTarget
            ? `"${deactivateTarget.consultation_type_name}" will be marked inactive in GIRISH_CONSULTATION_TYPES.`
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
