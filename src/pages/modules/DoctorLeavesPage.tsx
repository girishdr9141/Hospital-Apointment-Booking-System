import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarOff, Check, X } from 'lucide-react';
import type { Doctor, DoctorLeave } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { formatDisplayDate, formatDisplayDateTime } from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { MissingEndpointBanner } from '../../components/common/MissingEndpointBanner';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

export function DoctorLeavesPage() {
  const { user } = useAuth();
  const { notify } = useToast();

  const canRequest = hasModulePermission(user, 'SLOTS', 'CREATE') && user?.role === 'DOCTOR';
  const canApprove =
    hasModulePermission(user, 'SLOTS', 'UPDATE') &&
    user?.role !== 'DOCTOR' &&
    user?.role !== 'PATIENT';

  const [leaves, setLeaves] = useState<DoctorLeave[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingGetEndpoint, setMissingGetEndpoint] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Doctor Leave Request Modal
  const [requestOpen, setRequestOpen] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Admin Direct Approve/Reject Modal (matches Shift Change Approval — no audit trail)
  const [decisionTarget, setDecisionTarget] = useState<{
    leave: DoctorLeave;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [decisionComments, setDecisionComments] = useState('');
  const [deciding, setDeciding] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMissingGetEndpoint(false);
    try {
      const docs = await apiClient.getDoctors();
      setDoctors(docs);
      try {
        const list = await apiClient.getLeaves();
        setLeaves(list);
      } catch (err) {
        if (isEndpointNotDeployedError(err)) {
          setMissingGetEndpoint(true);
          setLeaves([]);
        } else {
          notify(err instanceof Error ? err.message : 'Failed to load doctor leaves', 'error');
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load doctor directory', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const doctorNameMap = useMemo(
    () => new Map(doctors.map((d) => [d.doctor_id, `Dr. ${d.first_name} ${d.last_name}`])),
    [doctors],
  );

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate || !leaveReason.trim()) {
      notify('Start date, end date, and reason are required', 'error');
      return;
    }
    if (endDate < startDate) {
      notify('End date cannot be earlier than start date', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.submitLeave({
        doctor_id: user?.doctor_id ?? undefined,
        start_date: startDate,
        end_date: endDate,
        leave_reason: leaveReason.trim(),
      });
      notify('Leave request submitted for administrator approval', 'success');
      setRequestOpen(false);
      setLeaveReason('');
      await loadData();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('POST /leaves ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to submit leave request', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionTarget) return;
    setDeciding(true);
    try {
      await apiClient.decideLeave(
        decisionTarget.leave.leave_id,
        decisionTarget.decision,
        decisionComments.trim() || undefined,
      );
      notify(
        `Leave request #${decisionTarget.leave.leave_id} ${decisionTarget.decision.toLowerCase()}`,
        'success',
      );
      setDecisionTarget(null);
      setDecisionComments('');
      await loadData();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('POST /leaves/:id/decide ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to decide leave request', 'error');
      }
    } finally {
      setDeciding(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leaves.filter((l) => {
      if (statusFilter !== 'ALL' && l.leave_status !== statusFilter) return false;
      if (!q) return true;
      const docName = (l.doctor_name || doctorNameMap.get(l.doctor_id) || '').toLowerCase();
      return (
        docName.includes(q) ||
        (l.leave_reason || '').toLowerCase().includes(q) ||
        String(l.leave_id).includes(q)
      );
    });
  }, [leaves, statusFilter, search, doctorNameMap]);

  const columns: DataColumn<DoctorLeave>[] = [
    {
      key: 'id',
      header: 'Leave ID',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">#{row.leave_id}</span>
      ),
    },
    {
      key: 'doctor',
      header: 'Doctor',
      render: (row) => (
        <span className="font-medium text-slate-900">
          {row.doctor_name || doctorNameMap.get(row.doctor_id) || `Doctor #${row.doctor_id}`}
        </span>
      ),
    },
    {
      key: 'dates',
      header: 'Leave Dates',
      render: (row) => (
        <span className="font-mono text-xs text-slate-800 tabular-nums">
          {formatDisplayDate(row.start_date)} – {formatDisplayDate(row.end_date)}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => (
        <span className="line-clamp-2 max-w-xs text-slate-700">
          {row.leave_reason || '—'}
        </span>
      ),
    },
    {
      key: 'requested',
      header: 'Requested On',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {formatDisplayDateTime(row.requested_on)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusIndicator status={row.leave_status} />,
    },
    ...(canApprove
      ? [
          {
            key: 'actions',
            header: 'Decision',
            align: 'right' as const,
            render: (row: DoctorLeave) =>
              row.leave_status === 'PENDING' ? (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDecisionComments('');
                      setDecisionTarget({ leave: row, decision: 'APPROVED' });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDecisionComments('');
                      setDecisionTarget({ leave: row, decision: 'REJECTED' });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Reject</span>
                  </button>
                </div>
              ) : (
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {formatDisplayDateTime(row.approved_on || row.requested_on)}
                </span>
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
            {user?.role === 'DOCTOR' ? 'My Leave Requests' : 'Doctor Leave Requests'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {user?.role === 'DOCTOR'
              ? 'Submit planned leave dates for administrator approval; approved leaves block slot bookings automatically.'
              : 'Approve or reject pending doctor leave requests directly.'}
          </p>
        </div>
        {canRequest && (
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <CalendarOff className="h-4 w-4" aria-hidden="true" />
            <span>Request Leave</span>
          </button>
        )}
      </div>

      {missingGetEndpoint && (
        <MissingEndpointBanner
          endpoint="GET /leaves"
          description="Unable to reach the doctor leaves ORDS endpoint. Verify module girish_opd_api is published."
        />
      )}

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.leave_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search doctor or leave reason..."
        filters={
          <select
            aria-label="Filter by leave status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        }
        emptyTitle="No leave requests found"
        emptyDescription={
          canRequest
            ? 'Use Request Leave to submit a planned absence for administrator review.'
            : 'Doctor leave applications will appear here once submitted.'
        }
      />

      {/* Doctor Submit Leave Modal */}
      <Modal
        open={requestOpen}
        title="Submit Leave Request"
        subtitle="Creates a pending leave request for administrator approval."
        onClose={() => setRequestOpen(false)}
      >
        <form onSubmit={handleSubmitLeave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="leave-start" className="block text-sm font-medium text-slate-700">
                Start date *
              </label>
              <input
                id="leave-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="leave-end" className="block text-sm font-medium text-slate-700">
                End date *
              </label>
              <input
                id="leave-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="leave-reason" className="block text-sm font-medium text-slate-700">
              Reason for leave *
            </label>
            <textarea
              id="leave-reason"
              rows={3}
              value={leaveReason}
              onChange={(e) => setLeaveReason(e.target.value)}
              placeholder="e.g., Medical conference attendance"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setRequestOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin Direct Approve / Reject Leave Modal */}
      <Modal
        open={Boolean(decisionTarget)}
        title={
          decisionTarget
            ? `${decisionTarget.decision === 'APPROVED' ? 'Approve' : 'Reject'} Leave Request`
            : ''
        }
        subtitle={
          decisionTarget
            ? `${decisionTarget.leave.doctor_name || doctorNameMap.get(decisionTarget.leave.doctor_id) || `Doctor #${decisionTarget.leave.doctor_id}`} · #${decisionTarget.leave.leave_id}`
            : undefined
        }
        onClose={() => setDecisionTarget(null)}
        maxWidth="md"
      >
        {decisionTarget && (
          <form onSubmit={handleConfirmDecision} className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
              <p>
                <span className="font-medium text-slate-600">Dates:</span>{' '}
                <span className="font-mono text-slate-900">
                  {formatDisplayDate(decisionTarget.leave.start_date)} –{' '}
                  {formatDisplayDate(decisionTarget.leave.end_date)}
                </span>
              </p>
              <p>
                <span className="font-medium text-slate-600">Reason:</span>{' '}
                <span className="text-slate-800">
                  {decisionTarget.leave.leave_reason || 'No reason stated'}
                </span>
              </p>
            </div>

            <div>
              <label htmlFor="decide-comments" className="block text-sm font-medium text-slate-700">
                Administrator Comments (optional)
              </label>
              <textarea
                id="decide-comments"
                rows={2}
                value={decisionComments}
                onChange={(e) => setDecisionComments(e.target.value)}
                placeholder="Add approval or rejection note..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDecisionTarget(null)}
                disabled={deciding}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deciding}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                  decisionTarget.decision === 'APPROVED'
                    ? 'bg-teal-700 hover:bg-teal-800'
                    : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {deciding
                  ? 'Saving...'
                  : decisionTarget.decision === 'APPROVED'
                    ? 'Confirm Approval'
                    : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
