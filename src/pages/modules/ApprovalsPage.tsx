import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarOff, Check, Clock, X } from 'lucide-react';
import type { Doctor, DoctorLeave, ShiftChangeRequest } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { formatDisplayDate, formatDisplayDateTime } from '../../utils/rules';
import { formatShiftSummary } from '../../utils/calendar';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { MissingEndpointBanner } from '../../components/common/MissingEndpointBanner';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

export function ApprovalsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const canDecide =
    hasModulePermission(user, 'SLOTS', 'UPDATE') &&
    user?.role !== 'DOCTOR' &&
    user?.role !== 'PATIENT';

  const [shiftRequests, setShiftRequests] = useState<ShiftChangeRequest[]>([]);
  const [leaves, setLeaves] = useState<DoctorLeave[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingLeavesEndpoint, setMissingLeavesEndpoint] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Admin review modal for Doctor Shift Change Requests
  const [shiftReviewTarget, setShiftReviewTarget] = useState<{
    req: ShiftChangeRequest;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);

  // Admin review modal for Doctor Leave Requests (same direct Approve/Reject flow — no trail)
  const [leaveReviewTarget, setLeaveReviewTarget] = useState<{
    leave: DoctorLeave;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);

  const [reviewComments, setReviewComments] = useState('');
  const [deciding, setDeciding] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMissingLeavesEndpoint(false);
    try {
      const [shiftRes, leaveList, docList] = await Promise.all([
        apiClient.getShiftChangeRequests().catch(() => ({ requests: [] as ShiftChangeRequest[] })),
        apiClient.getLeaves().catch((err) => {
          if (isEndpointNotDeployedError(err)) {
            setMissingLeavesEndpoint(true);
            return [] as DoctorLeave[];
          }
          throw err;
        }),
        apiClient.getDoctors().catch(() => [] as Doctor[]),
      ]);
      setShiftRequests(shiftRes.requests || []);
      setLeaves(leaveList);
      setDoctors(docList);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load approval requests', 'error');
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

  const handleDecideShiftChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftReviewTarget) return;
    setDeciding(true);
    try {
      const res = await apiClient.decideShiftChangeRequest(
        shiftReviewTarget.req.request_id,
        shiftReviewTarget.decision,
        reviewComments.trim() || undefined,
      );
      notify(res.message || `Shift change ${shiftReviewTarget.decision.toLowerCase()}`, 'success');
      setShiftReviewTarget(null);
      setReviewComments('');
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to apply shift decision', 'error');
    } finally {
      setDeciding(false);
    }
  };

  const handleDecideLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveReviewTarget) return;
    setDeciding(true);
    try {
      await apiClient.decideLeave(
        leaveReviewTarget.leave.leave_id,
        leaveReviewTarget.decision,
        reviewComments.trim() || undefined,
      );
      notify(
        `Leave request #${leaveReviewTarget.leave.leave_id} ${leaveReviewTarget.decision.toLowerCase()}`,
        'success',
      );
      setLeaveReviewTarget(null);
      setReviewComments('');
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to decide leave request', 'error');
    } finally {
      setDeciding(false);
    }
  };

  const filteredShiftRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shiftRequests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.doctor_name.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        r.request_id.toLowerCase().includes(q)
      );
    });
  }, [shiftRequests, statusFilter, search]);

  const filteredLeaves = useMemo(() => {
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

  const shiftColumns: DataColumn<ShiftChangeRequest>[] = [
    {
      key: 'doctor',
      header: 'Doctor',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.doctor_name}</p>
          <p className="font-mono text-[11px] text-slate-500">{row.request_id}</p>
        </div>
      ),
    },
    {
      key: 'current',
      header: 'Current Shift',
      render: (row) => (
        <div className="text-xs">
          <p className="font-mono text-slate-700">
            {formatShiftSummary(row.current_sessions, row.current_slot_duration_mins)}
          </p>
          <p className="text-[11px] text-slate-500">
            {row.current_working_days.map((d) => d.slice(0, 3)).join(', ')}
          </p>
        </div>
      ),
    },
    {
      key: 'requested',
      header: 'Requested Shift',
      render: (row) => (
        <div className="text-xs">
          <p className="font-mono font-semibold text-teal-900">
            {formatShiftSummary(row.requested_sessions, row.requested_slot_duration_mins)}
          </p>
          <p className="text-[11px] text-slate-500">
            {row.requested_working_days.map((d) => d.slice(0, 3)).join(', ')}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => (
        <div className="max-w-xs text-xs text-slate-700">
          <p>{row.reason}</p>
          {row.decision_comments && (
            <p className="mt-0.5 text-[11px] text-slate-500">Admin: {row.decision_comments}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusIndicator status={row.status} />,
    },
    ...(canDecide
      ? [
          {
            key: 'actions',
            header: 'Decision',
            align: 'right' as const,
            render: (row: ShiftChangeRequest) =>
              row.status === 'PENDING' ? (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setReviewComments('');
                      setShiftReviewTarget({ req: row, decision: 'APPROVED' });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReviewComments('');
                      setShiftReviewTarget({ req: row, decision: 'REJECTED' });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Reject</span>
                  </button>
                </div>
              ) : (
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {formatDisplayDateTime(row.decided_on)}
                </span>
              ),
          },
        ]
      : []),
  ];

  const leaveColumns: DataColumn<DoctorLeave>[] = [
    {
      key: 'doctor',
      header: 'Doctor',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">
            {row.doctor_name || doctorNameMap.get(row.doctor_id) || `Doctor #${row.doctor_id}`}
          </p>
          <p className="font-mono text-[11px] text-slate-500">Leave #{row.leave_id}</p>
        </div>
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
        <span className="line-clamp-2 max-w-xs text-xs text-slate-700">
          {row.leave_reason || '—'}
        </span>
      ),
    },
    {
      key: 'requested',
      header: 'Requested On',
      render: (row) => (
        <span className="font-mono text-xs text-slate-600 tabular-nums">
          {formatDisplayDateTime(row.requested_on)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusIndicator status={row.leave_status} />,
    },
    ...(canDecide
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
                      setReviewComments('');
                      setLeaveReviewTarget({ leave: row, decision: 'APPROVED' });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReviewComments('');
                      setLeaveReviewTarget({ leave: row, decision: 'REJECTED' });
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Approvals</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Directly approve or reject doctor shift window change requests and doctor leave applications.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search doctor or reason..."
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
          />
          <select
            aria-label="Filter by approval status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {missingLeavesEndpoint && (
        <MissingEndpointBanner
          endpoint="GET /leaves"
          description="Unable to reach the doctor leaves ORDS endpoint."
        />
      )}

      {/* Doctor Shift Window Change Requests */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-teal-700" aria-hidden="true" />
          <h3 className="text-base font-semibold text-slate-900">
            Doctor Shift Window Change Requests ({shiftRequests.filter((r) => r.status === 'PENDING').length} pending)
          </h3>
        </div>
        <DataTable
          rows={filteredShiftRequests}
          columns={shiftColumns}
          getRowKey={(row) => row.request_id}
          loading={loading}
          emptyTitle="No shift change requests"
          emptyDescription="When a doctor requests a change to their registered OPD shift window, it appears here for administrator approval."
        />
      </section>

      {/* Doctor Leave Requests — direct Approve / Reject, no trail */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-teal-700" aria-hidden="true" />
          <h3 className="text-base font-semibold text-slate-900">
            Doctor Leave Requests ({leaves.filter((l) => l.leave_status === 'PENDING').length} pending)
          </h3>
        </div>
        <DataTable
          rows={filteredLeaves}
          columns={leaveColumns}
          getRowKey={(row) => row.leave_id}
          loading={loading}
          emptyTitle="No leave requests"
          emptyDescription="Doctor leave requests appear here for direct approval or rejection."
        />
      </section>

      {/* Shift Change Review Modal */}
      <Modal
        open={Boolean(shiftReviewTarget)}
        title={
          shiftReviewTarget
            ? `${shiftReviewTarget.decision === 'APPROVED' ? 'Approve' : 'Reject'} Shift Change Request`
            : ''
        }
        subtitle={
          shiftReviewTarget
            ? `${shiftReviewTarget.req.doctor_name} · ${shiftReviewTarget.req.request_id}`
            : ''
        }
        onClose={() => setShiftReviewTarget(null)}
        maxWidth="md"
      >
        {shiftReviewTarget && (
          <form onSubmit={handleDecideShiftChange} className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
              <p>
                <span className="font-medium text-slate-600">Current:</span>{' '}
                <span className="font-mono text-slate-900">
                  {formatShiftSummary(
                    shiftReviewTarget.req.current_sessions,
                    shiftReviewTarget.req.current_slot_duration_mins,
                  )}
                </span>
              </p>
              <p>
                <span className="font-medium text-slate-600">Requested:</span>{' '}
                <span className="font-mono font-semibold text-teal-900">
                  {formatShiftSummary(
                    shiftReviewTarget.req.requested_sessions,
                    shiftReviewTarget.req.requested_slot_duration_mins,
                  )}
                </span>
              </p>
              <p>
                <span className="font-medium text-slate-600">Reason:</span>{' '}
                <span className="text-slate-800">{shiftReviewTarget.req.reason}</span>
              </p>
            </div>

            <div>
              <label htmlFor="shift-review-comments" className="block text-sm font-medium text-slate-700">
                Administrator Comments (optional)
              </label>
              <textarea
                id="shift-review-comments"
                rows={2}
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                placeholder="Add approval or rejection note..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShiftReviewTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deciding}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                  shiftReviewTarget.decision === 'APPROVED'
                    ? 'bg-teal-700 hover:bg-teal-800'
                    : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {deciding
                  ? 'Saving...'
                  : shiftReviewTarget.decision === 'APPROVED'
                    ? 'Confirm Approval'
                    : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Leave Review Modal (Direct Approve / Reject — no trail) */}
      <Modal
        open={Boolean(leaveReviewTarget)}
        title={
          leaveReviewTarget
            ? `${leaveReviewTarget.decision === 'APPROVED' ? 'Approve' : 'Reject'} Leave Request`
            : ''
        }
        subtitle={
          leaveReviewTarget
            ? `${leaveReviewTarget.leave.doctor_name || doctorNameMap.get(leaveReviewTarget.leave.doctor_id) || `Doctor #${leaveReviewTarget.leave.doctor_id}`} · #${leaveReviewTarget.leave.leave_id}`
            : ''
        }
        onClose={() => setLeaveReviewTarget(null)}
        maxWidth="md"
      >
        {leaveReviewTarget && (
          <form onSubmit={handleDecideLeave} className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
              <p>
                <span className="font-medium text-slate-600">Dates:</span>{' '}
                <span className="font-mono text-slate-900">
                  {formatDisplayDate(leaveReviewTarget.leave.start_date)} –{' '}
                  {formatDisplayDate(leaveReviewTarget.leave.end_date)}
                </span>
              </p>
              <p>
                <span className="font-medium text-slate-600">Reason:</span>{' '}
                <span className="text-slate-800">
                  {leaveReviewTarget.leave.leave_reason || 'No reason stated'}
                </span>
              </p>
            </div>

            <div>
              <label htmlFor="leave-review-comments" className="block text-sm font-medium text-slate-700">
                Administrator Comments (optional)
              </label>
              <textarea
                id="leave-review-comments"
                rows={2}
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                placeholder="Add approval or rejection note..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setLeaveReviewTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deciding}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                  leaveReviewTarget.decision === 'APPROVED'
                    ? 'bg-teal-700 hover:bg-teal-800'
                    : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {deciding
                  ? 'Saving...'
                  : leaveReviewTarget.decision === 'APPROVED'
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
