import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, SkipForward } from 'lucide-react';
import type { Appointment, Department, TokenQueueItem } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatDisplayDate } from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

export function TokenQueuePage() {
  const { user, hasPermission } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission('MANAGE_TOKENS') && user?.role !== 'PATIENT';

  const [tokens, setTokens] = useState<TokenQueueItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedApptId, setSelectedApptId] = useState('');
  const [issuing, setIssuing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, depts, appts] = await Promise.all([
        apiClient.getTokenQueue(),
        apiClient.getDepartments(),
        canManage ? apiClient.getAppointments() : Promise.resolve([] as Appointment[]),
      ]);
      setTokens(queue);
      setDepartments(depts);
      const confirmed = appts.filter((a) => a.status === 'CONFIRMED');
      setAppointments(confirmed);
      if (confirmed[0] && !selectedApptId) {
        setSelectedApptId(String(confirmed[0].appointment_id));
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load token queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, canManage, selectedApptId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleIssueToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApptId) {
      notify('Select a confirmed appointment to check in', 'error');
      return;
    }
    setIssuing(true);
    try {
      await apiClient.issueToken({ appointment_id: Number(selectedApptId) });
      notify('Patient checked in and token issued', 'success');
      setIssueOpen(false);
      await loadData();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('POST /token_queue ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to issue token', 'error');
      }
    } finally {
      setIssuing(false);
    }
  };

  const handleAdvanceStatus = async (item: TokenQueueItem, nextStatus: TokenQueueItem['status']) => {
    try {
      await apiClient.updateTokenStatus(item.queue_id, nextStatus);
      notify(`Token #${item.token_number} marked ${nextStatus.replaceAll('_', ' ')}`, 'success');
      await loadData();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('PUT /token_queue/:id ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to update token status', 'error');
      }
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tokens.filter((t) => {
      if (deptFilter !== 'ALL' && String(t.department_id) !== deptFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.appointment_ref.toLowerCase().includes(q) ||
        t.department_name.toLowerCase().includes(q) ||
        String(t.token_number).includes(q)
      );
    });
  }, [tokens, deptFilter, statusFilter, search]);

  const columns: DataColumn<TokenQueueItem>[] = [
    {
      key: 'token',
      header: 'Token',
      render: (row) => (
        <span className="font-mono text-sm font-semibold text-teal-800 tabular-nums">
          #{row.token_number}
        </span>
      ),
    },
    {
      key: 'appt',
      header: 'Appointment Ref',
      render: (row) => (
        <span className="font-mono text-xs text-slate-800 tabular-nums">{row.appointment_ref}</span>
      ),
    },
    {
      key: 'dept',
      header: 'Department',
      render: (row) => <span className="font-medium text-slate-900">{row.department_name}</span>,
    },
    {
      key: 'date',
      header: 'Queue Date',
      render: (row) => (
        <span className="font-mono text-xs text-slate-600 tabular-nums">
          {formatDisplayDate(row.queue_date)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusIndicator status={row.status} />,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Queue Control',
            align: 'right' as const,
            render: (row: TokenQueueItem) => (
              <div className="inline-flex items-center gap-1.5">
                {row.status === 'WAITING' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAdvanceStatus(row, 'IN_CONSULTATION')}
                      className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                    >
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      <span>Call In</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAdvanceStatus(row, 'SKIPPED')}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <SkipForward className="h-3 w-3" aria-hidden="true" />
                      <span>Skip</span>
                    </button>
                  </>
                )}
                {row.status === 'IN_CONSULTATION' && (
                  <button
                    type="button"
                    onClick={() => handleAdvanceStatus(row, 'DONE')}
                    className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    Mark Done
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
          <h2 className="text-xl font-semibold text-slate-900">
            {user?.role === 'PATIENT' ? 'My Queue Tokens' : 'OPD Token Queue'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Track daily check-ins and consultation room progression from GIRISH_TOKEN_QUEUE.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setIssueOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Check In &amp; Issue Token</span>
          </button>
        )}
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.queue_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search token # or appointment ref..."
        filters={
          <>
            <select
              aria-label="Filter by department"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d.department_id} value={String(d.department_id)}>
                  {d.department_name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by token status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="WAITING">Waiting</option>
              <option value="IN_CONSULTATION">In Consultation</option>
              <option value="DONE">Done</option>
              <option value="SKIPPED">Skipped</option>
            </select>
          </>
        }
        emptyTitle="Token queue is empty"
        emptyDescription="Checked-in confirmed appointments will appear in the daily queue."
      />

      <Modal
        open={issueOpen}
        title="Check In Patient & Issue Token"
        subtitle="Generates the next department token for a confirmed appointment."
        onClose={() => setIssueOpen(false)}
      >
        <form onSubmit={handleIssueToken} className="space-y-4">
          <div>
            <label htmlFor="tok-appt" className="block text-sm font-medium text-slate-700">
              Confirmed appointment *
            </label>
            <select
              id="tok-appt"
              value={selectedApptId}
              onChange={(e) => setSelectedApptId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            >
              {appointments.length === 0 ? (
                <option value="">No confirmed appointments available</option>
              ) : (
                appointments.map((a) => (
                  <option key={a.appointment_id} value={String(a.appointment_id)}>
                    {a.appointment_ref} · {a.patient_name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIssueOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={issuing || !selectedApptId}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {issuing ? 'Issuing...' : 'Issue Token'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
