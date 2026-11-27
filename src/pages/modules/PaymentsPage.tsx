import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import type { Appointment, GlobalBranchMetadata, Payment } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useBranchContext } from '../../context/BranchContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import { formatBranchCurrency } from '../../utils/globalBranch';
import { formatCurrencyInr, formatDisplayDateTime } from '../../utils/rules';
import { formatRefundRemaining, isRefundCompletionDue } from '../../utils/refunds';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

type PaymentWithBranch = Payment & {
  branch_meta?: GlobalBranchMetadata | null;
  local_currency?: string | null;
  local_amount?: number | null;
  fx_rate_to_inr?: number | null;
};

export function PaymentsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const { selectedBranchId, activeBranch, headquartersBranch } = useBranchContext();
  const canRecord = hasModulePermission(user, 'PAYMENTS', 'CREATE');
  const canExport = hasModulePermission(user, 'PAYMENTS', 'EXPORT');

  const [payments, setPayments] = useState<PaymentWithBranch[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [appointmentId, setAppointmentId] = useState('');
  const [amount, setAmount] = useState('500');
  const [method, setMethod] = useState('UPI');
  const [status, setStatus] = useState<'SUCCESS' | 'FAILED' | 'REFUNDED'>('SUCCESS');
  const [saving, setSaving] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const autoRefundRefreshedRef = useRef<Set<number>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [payList, apptList] = await Promise.all([
        apiClient.getGlobalPayments().catch(() => apiClient.getPayments()),
        canRecord
          ? apiClient.getGlobalAppointments().catch(() => apiClient.getAppointments().catch(() => [] as Appointment[]))
          : Promise.resolve([] as Appointment[]),
      ]);
      setPayments(payList as PaymentWithBranch[]);
      setAppointments(apptList);
      if (apptList[0] && !appointmentId) {
        setAppointmentId(String(apptList[0].appointment_id));
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load payments', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, canRecord, appointmentId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!payments.some((p) => p.status === 'REFUND_PENDING' || p.refund_status === 'REFUND_PENDING')) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payments]);

  useEffect(() => {
    const due = payments.filter(
      (p) =>
        isRefundCompletionDue(p.refund_status || p.status, p.refund_due_at, nowMs) &&
        !autoRefundRefreshedRef.current.has(p.payment_id),
    );
    if (due.length === 0) return;
    for (const p of due) autoRefundRefreshedRef.current.add(p.payment_id);
    void loadData();
  }, [payments, nowMs, loadData]);

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointmentId || !amount) {
      notify('Appointment and amount are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiClient.recordPayment({
        appointment_id: Number(appointmentId),
        amount: Number(amount),
        payment_method: method,
        status,
      });
      notify('Payment recorded in Oracle GIRISH_PAYMENTS', 'success');
      setModalOpen(false);
      await loadData();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('POST /payments ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to record payment', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hqId = headquartersBranch?.branch_id ?? 1;
    return payments.filter((p) => {
      if (selectedBranchId !== 'ALL') {
        const payBranchId = p.branch_meta?.branch_id ?? hqId;
        if (payBranchId !== selectedBranchId) return false;
      }
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.payment_ref.toLowerCase().includes(q) ||
        p.appointment_ref.toLowerCase().includes(q) ||
        (p.payment_method || '').toLowerCase().includes(q) ||
        (p.branch_meta?.branch_name || '').toLowerCase().includes(q)
      );
    });
  }, [payments, selectedBranchId, headquartersBranch?.branch_id, statusFilter, search]);

  const columns: DataColumn<PaymentWithBranch>[] = [
    {
      key: 'pay_ref',
      header: 'Payment Ref',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-slate-900 tabular-nums">
          {row.payment_ref}
        </span>
      ),
    },
    {
      key: 'appt_ref',
      header: 'Appointment Ref',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700 tabular-nums">
          {row.appointment_ref}
        </span>
      ),
    },
    {
      key: 'branch',
      header: 'Branch',
      render: (row) => (
        <div>
          <p className="text-xs font-medium text-slate-900">
            {row.branch_meta?.branch_name || 'Headquarters'}
          </p>
          <p className="text-[11px] text-slate-500">
            {row.branch_meta
              ? `${row.branch_meta.city}, ${row.branch_meta.country_code}`
              : 'Bengaluru, IN'}
          </p>
        </div>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      render: (row) => <span className="text-slate-700">{row.payment_method || '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => {
        const localCurr = (row.local_currency || row.branch_meta?.currency_code || 'INR').toUpperCase();
        const showLocal = localCurr !== 'INR' && row.local_amount != null;
        return (
          <div className="text-right">
            <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
              {showLocal
                ? formatBranchCurrency(row.local_amount, localCurr)
                : formatCurrencyInr(row.amount)}
            </span>
            {showLocal && (
              <p className="font-mono text-[10px] text-slate-500 tabular-nums">
                {formatCurrencyInr(row.amount)}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status & Refund Policy',
      render: (row) => (
        <div className="space-y-1">
          <StatusIndicator status={row.status} />
          {(row.status === 'REFUND_PENDING' || row.refund_status === 'REFUND_PENDING') && (
            <p className="text-[11px] font-medium text-amber-700">
              It will refund within 2 hours
              {row.refund_due_at ? ` · ${formatRefundRemaining(row.refund_due_at, nowMs)} left` : ''}
              {row.refund_amount != null
                ? ` · ${formatCurrencyInr(row.refund_amount)} (${row.refund_percentage ?? 0}%${row.refund_rule_name ? ` · ${row.refund_rule_name}` : ''})`
                : ''}
            </p>
          )}
          {row.status === 'REFUNDED' && (
            <p className="text-[11px] font-medium text-emerald-700">
              {row.refund_amount != null
                ? `Refunded ${formatCurrencyInr(row.refund_amount)} (${row.refund_percentage ?? 100}%${row.refund_rule_name ? ` · ${row.refund_rule_name}` : ''})`
                : 'Refund completed'}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Recorded On',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {formatDisplayDateTime(row.created_on)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Payments &amp; Receipts</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {activeBranch
              ? `${activeBranch.branch_name} (${activeBranch.currency_code}) · Consultation fee records stored in Oracle GIRISH_PAYMENTS.`
              : 'Consultation fee records and multi-currency branch receipts stored in Oracle GIRISH_PAYMENTS.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canExport && (
            <button
              type="button"
              onClick={() => {
                const csv = buildCsvString(
                  [
                    'Payment Ref',
                    'Appointment Ref',
                    'Branch',
                    'Local Currency',
                    'Local Amount',
                    'Method',
                    'Amount INR',
                    'Status',
                    'Recorded On',
                  ],
                  filtered.map((p) => [
                    p.payment_ref,
                    p.appointment_ref,
                    p.branch_meta?.branch_name || 'Headquarters',
                    p.local_currency || 'INR',
                    p.local_amount ?? p.amount,
                    p.payment_method || '',
                    p.amount,
                    p.status,
                    p.created_on,
                  ]),
                );
                downloadCsvFile('carepulse-payments.csv', csv);
                notify('Payments ledger exported as CSV', 'success');
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          )}
          {canRecord && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Record Payment</span>
            </button>
          )}
        </div>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.payment_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search payment ref, appointment ref, or branch..."
        filters={
          <select
            aria-label="Filter by payment status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="REFUND_PENDING">Will Refund Within 2 Hours</option>
            <option value="REFUNDED">Refunded</option>
            <option value="FAILED">Failed</option>
          </select>
        }
        emptyTitle="No payment records yet"
        emptyDescription="Consultation fee receipts will appear here once recorded."
      />

      <Modal
        open={modalOpen}
        title="Record Consultation Payment"
        subtitle="Logs payment to GIRISH_PAYMENTS (no external gateway)."
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleRecord} className="space-y-4">
          <div>
            <label htmlFor="pay-appt" className="block text-sm font-medium text-slate-700">
              Appointment *
            </label>
            <select
              id="pay-appt"
              value={appointmentId}
              onChange={(e) => setAppointmentId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            >
              {appointments.map((a) => (
                <option key={a.appointment_id} value={String(a.appointment_id)}>
                  {a.appointment_ref} · {a.patient_name} ({a.status})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="pay-amount" className="block text-sm font-medium text-slate-700">
                Amount (INR) *
              </label>
              <input
                id="pay-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="pay-method" className="block text-sm font-medium text-slate-700">
                Method *
              </label>
              <select
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="UPI">UPI</option>
                <option value="CARD">Card</option>
                <option value="CASH">Cash</option>
                <option value="NET_BANKING">Net Banking</option>
              </select>
            </div>
            <div>
              <label htmlFor="pay-status" className="block text-sm font-medium text-slate-700">
                Status *
              </label>
              <select
                id="pay-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'SUCCESS' | 'FAILED' | 'REFUNDED')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="SUCCESS">Success</option>
                <option value="FAILED">Failed</option>
                <option value="REFUNDED">Refunded</option>
              </select>
            </div>
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
              {saving ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
