import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, Check, Clock, Download, RefreshCw, XCircle } from 'lucide-react';
import type {
  Appointment,
  CancellationRule,
  Department,
  Doctor,
  GlobalBranchMetadata,
  Patient,
  Slot,
} from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useBranchContext } from '../../context/BranchContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import {
  formatBranchCurrency,
  getDoctorEffectiveBranchFee,
} from '../../utils/globalBranch';
import {
  enrichAppointments,
  enrichSlots,
  formatCurrencyInr,
  formatDisplayDate,
  formatHoldRemaining,
  getIsoDatePart,
  isAppointmentHoldExpired,
} from '../../utils/rules';
import { getAppointmentsAwaitingOutcome, isSlotEndExpired } from '../../utils/calendar';
import {
  evaluateCancellationRefund,
  formatRefundRemaining,
  isRefundCompletionDue,
} from '../../utils/refunds';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog';
import { StatusIndicator, ConsultationModeBadge } from '../../components/layout/StatusIndicator';
import { PatientBookingCalendar } from '../../components/calendar/PatientBookingCalendar';
import {
  AppointmentPaymentModal,
  type PaymentModalAppointmentDetails,
} from '../../components/modals/AppointmentPaymentModal';

interface AppointmentsPageProps {
  mode?: 'list' | 'book' | 'history';
  onModeHandled?: () => void;
  onDataChanged?: () => Promise<void> | void;
}

type AppointmentWithBranch = Appointment & {
  branch_meta?: GlobalBranchMetadata | null;
  local_currency?: string | null;
  local_amount?: number | null;
};
type SlotWithBranch = Slot & { branch_meta?: GlobalBranchMetadata | null };

export function AppointmentsPage({ mode = 'list', onModeHandled, onDataChanged }: AppointmentsPageProps) {
  const { user } = useAuth();
  const { notify } = useToast();
  const {
    countries,
    branches,
    branchDepartments,
    doctorBranches,
    headquartersBranch,
    selectedBranchId,
    activeBranch,
  } = useBranchContext();

  const [appointments, setAppointments] = useState<AppointmentWithBranch[]>([]);
  const [slots, setSlots] = useState<SlotWithBranch[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [cancellationRules, setCancellationRules] = useState<CancellationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiringHolds, setExpiringHolds] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [modeFilter, setModeFilter] = useState<'ALL' | 'ONLINE' | 'FACE_TO_FACE'>('ALL');
  const [doctorFilter, setDoctorFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');

  // Booking Modal (used when clicking Book Appointment from list mode)
  const [bookOpen, setBookOpen] = useState(false);

  // Action Confirmation Dialog
  const [pendingAction, setPendingAction] = useState<{
    appointment: Appointment;
    type: 'cancel' | 'COMPLETED' | 'NO_SHOW';
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<PaymentModalAppointmentDetails | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const autoExpiredTriggeredRef = useRef<Set<number>>(new Set());
  const autoRefundTriggeredRef = useRef<Set<number>>(new Set());

  // Refresh countdown tick every second when any appointment is HELD or REFUND_PENDING
  useEffect(() => {
    if (
      !appointments.some(
        (a) => a.status === 'HELD' || a.refund_status === 'REFUND_PENDING',
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [appointments]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rawAppts, rawSlots, templates, docs, activeDepts, pats, rules] = await Promise.all([
        apiClient.getGlobalAppointments().catch(() => apiClient.getAppointments()),
        apiClient.getGlobalSlots().catch(() => apiClient.getSlots()),
        apiClient.getSlotTemplates(),
        apiClient.getDoctors(),
        apiClient.getDepartments(),
        user?.role === 'PATIENT'
          ? Promise.resolve([] as Patient[])
          : apiClient.getPatients().catch(() => [] as Patient[]),
        apiClient.getCancellationRules().catch(() => [] as CancellationRule[]),
      ]);
      const allDepts = await apiClient.resolveDepartmentsForIds(
        docs.map((d) => d.department_id),
        activeDepts,
      );

      const rawApptMetaById = new Map(
        (rawAppts as AppointmentWithBranch[]).map((a) => [
          a.appointment_id,
          {
            branch_meta: a.branch_meta ?? null,
            local_currency: a.local_currency ?? null,
            local_amount: a.local_amount ?? null,
          },
        ]),
      );
      const rawSlotBranchById = new Map(
        (rawSlots as SlotWithBranch[]).map((s) => [s.slot_id, s.branch_meta ?? null]),
      );

      const joinedSlots: SlotWithBranch[] = enrichSlots(rawSlots, templates, docs, allDepts).map(
        (s) => ({
          ...s,
          branch_meta: rawSlotBranchById.get(s.slot_id) ?? null,
        }),
      );
      const joinedAppts: AppointmentWithBranch[] = enrichAppointments(
        rawAppts,
        joinedSlots,
        docs,
      ).map((a) => {
        const meta = rawApptMetaById.get(a.appointment_id);
        return {
          ...a,
          branch_meta: meta?.branch_meta ?? null,
          local_currency: meta?.local_currency ?? null,
          local_amount: meta?.local_amount ?? null,
        };
      });

      setAppointments(joinedAppts);
      setSlots(joinedSlots);
      setDoctors(docs);
      setDepartments(allDepts);
      setPatients(pats);
      setCancellationRules(rules);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load appointments', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, user?.role]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Automatically release expired holds & complete due 2-hour refunds on countdown tick
  useEffect(() => {
    const newlyExpired = appointments.filter(
      (a) => isAppointmentHoldExpired(a, nowMs) && !autoExpiredTriggeredRef.current.has(a.appointment_id),
    );
    const newlyDueRefunds = appointments.filter(
      (a) =>
        isRefundCompletionDue(a.refund_status, a.refund_due_at, nowMs) &&
        !autoRefundTriggeredRef.current.has(a.appointment_id),
    );
    if (newlyExpired.length === 0 && newlyDueRefunds.length === 0) return;
    for (const appt of newlyExpired) {
      autoExpiredTriggeredRef.current.add(appt.appointment_id);
    }
    for (const appt of newlyDueRefunds) {
      autoRefundTriggeredRef.current.add(appt.appointment_id);
    }
    void loadData();
  }, [appointments, nowMs, loadData]);

  const handleOpenConfirmPaymentModal = (appt: AppointmentWithBranch) => {
    const doc = doctors.find((d) => d.doctor_id === appt.doctor_id);
    const branchObj =
      (appt.branch_meta
        ? branches.find((b) => b.branch_id === appt.branch_meta?.branch_id)
        : undefined) || headquartersBranch;
    const feeInfo = getDoctorEffectiveBranchFee({
      doctor: doc,
      branch: branchObj,
      countries,
      doctorBranches,
      branchDepartments,
    });
    const fee = Number(appt.consultation_fee ?? feeInfo.base_inr_amount ?? 0);
    setPaymentTarget({
      appointment_id: appt.appointment_id,
      appointment_ref: appt.appointment_ref,
      doctor_name:
        appt.doctor_name ||
        (doc ? `Dr. ${doc.first_name} ${doc.last_name}` : `Slot #${appt.slot_id}`),
      department_name: appt.department_name || 'OPD',
      patient_name: appt.patient_name,
      slot_date: appt.slot_date,
      start_time: appt.start_time,
      end_time: appt.end_time,
      consultation_mode: appt.consultation_mode,
      consultation_fee: fee,
      branch_id: branchObj?.branch_id ?? appt.branch_meta?.branch_id ?? null,
      branch_name: branchObj?.branch_name ?? appt.branch_meta?.branch_name ?? null,
      country_name: branchObj?.country_name ?? appt.branch_meta?.country_name ?? null,
      local_currency: appt.local_currency ?? feeInfo.currency_code,
      local_amount: appt.local_amount ?? feeInfo.local_amount,
    });
  };

  const handlePayAndConfirmAppointment = async (
    paymentMethod: 'UPI' | 'CARD' | 'NET_BANKING' | 'CASH',
  ) => {
    if (!paymentTarget) return;
    setPaymentBusy(true);
    try {
      const res = paymentTarget.branch_id
        ? await apiClient.payAndConfirmGlobalAppointment(paymentTarget.appointment_id, {
            payment_method: paymentMethod,
            branch_id: paymentTarget.branch_id,
          })
        : await apiClient.payAndConfirmAppointment(paymentTarget.appointment_id, {
            payment_method: paymentMethod,
          });
      const paidDisplay =
        paymentTarget.local_currency &&
        paymentTarget.local_currency !== 'INR' &&
        paymentTarget.local_amount != null
          ? formatBranchCurrency(paymentTarget.local_amount, paymentTarget.local_currency)
          : formatCurrencyInr(paymentTarget.consultation_fee);
      notify(
        `Paid ${paidDisplay} (${res.payment_ref || paymentMethod}) · Appointment ${paymentTarget.appointment_ref} confirmed!`,
        'success',
      );
      setPaymentTarget(null);
      await loadData();
      await onDataChanged?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Payment or confirmation failed', 'error');
    } finally {
      setPaymentBusy(false);
    }
  };

  const executeAppointmentAction = async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      const { appointment, type } = pendingAction;
      if (type === 'cancel') {
        const res = await apiClient.cancelAppointment(appointment.appointment_id);
        if (res.refund?.applicable && res.refund.refund_status === 'REFUND_PENDING') {
          notify(
            `Appointment ${appointment.appointment_ref} cancelled & slot freed. Refund of ${formatCurrencyInr(res.refund.refund_amount)} (${res.refund.refund_percentage}% · ${res.refund.refund_rule_name}) will be completed within 2 hours.`,
            'success',
          );
        } else if (res.refund?.applicable && res.refund.refund_status === 'NO_REFUND') {
          notify(
            `Appointment ${appointment.appointment_ref} cancelled & slot freed. Per ${res.refund.refund_rule_name}, 0% refund applies.`,
            'info',
          );
        } else {
          notify(`Appointment ${appointment.appointment_ref} cancelled and slot freed`, 'success');
        }
      } else {
        await apiClient.updateAppointmentOutcome(appointment.appointment_id, type);
        notify(`Appointment marked ${type}`, 'success');
      }
      setPendingAction(null);
      await loadData();
      await onDataChanged?.();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('Appointment action endpoint is unavailable in Oracle ORDS.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to update appointment', 'error');
      }
      setPendingAction(null);
    } finally {
      setActionBusy(false);
    }
  };

  const handleExpireHolds = async () => {
    setExpiringHolds(true);
    try {
      const res = await apiClient.expireAppointmentHolds();
      const count = res.expired_count ?? 0;
      notify(
        count > 0
          ? `Expired ${count} overdue hold${count === 1 ? '' : 's'} and released slot capacity`
          : 'No overdue online holds found',
        'success',
      );
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to expire holds', 'error');
    } finally {
      setExpiringHolds(false);
    }
  };

  const filteredAppointments = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hqId = headquartersBranch?.branch_id ?? 1;
    return appointments.filter((a) => {
      if (mode === 'history' && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status)) {
        return false;
      }
      if (selectedBranchId !== 'ALL') {
        const apptBranchId = a.branch_meta?.branch_id ?? hqId;
        if (apptBranchId !== selectedBranchId) return false;
      }
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (modeFilter !== 'ALL' && (a.consultation_mode || 'FACE_TO_FACE') !== modeFilter) {
        return false;
      }
      if (doctorFilter !== 'ALL' && String(a.doctor_id || '') !== doctorFilter) return false;
      if (dateFilter && getIsoDatePart(a.slot_date || a.created_on) !== dateFilter) return false;
      if (!q) return true;
      return (
        a.appointment_ref.toLowerCase().includes(q) ||
        a.patient_name.toLowerCase().includes(q) ||
        (a.doctor_name || '').toLowerCase().includes(q) ||
        (a.branch_meta?.branch_name || '').toLowerCase().includes(q)
      );
    });
  }, [
    appointments,
    mode,
    selectedBranchId,
    headquartersBranch?.branch_id,
    statusFilter,
    modeFilter,
    doctorFilter,
    dateFilter,
    search,
  ]);

  const canBook = hasModulePermission(user, 'APPOINTMENTS', 'CREATE') && user?.role !== 'DOCTOR';
  const canConfirm =
    user?.role !== 'DOCTOR' &&
    (hasModulePermission(user, 'APPOINTMENTS', 'UPDATE') ||
      (user?.role === 'PATIENT' && hasModulePermission(user, 'APPOINTMENTS', 'CREATE')));
  const canCancel = hasModulePermission(user, 'APPOINTMENTS', 'DELETE') && user?.role !== 'DOCTOR';
  const canUpdateOutcome =
    hasModulePermission(user, 'APPOINTMENTS', 'UPDATE') && user?.role !== 'PATIENT';
  const canExpireHolds =
    hasModulePermission(user, 'APPOINTMENTS', 'UPDATE') &&
    user?.role !== 'PATIENT' &&
    user?.role !== 'DOCTOR';
  const canExport = hasModulePermission(user, 'APPOINTMENTS', 'EXPORT');
  const awaitingOutcomeAppts = useMemo(
    () =>
      user?.role === 'DOCTOR'
        ? getAppointmentsAwaitingOutcome(appointments, user.doctor_id)
        : [],
    [appointments, user?.role, user?.doctor_id],
  );

  const columns: DataColumn<AppointmentWithBranch>[] = [
    {
      key: 'ref',
      header: 'Reference',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-medium text-slate-900 tabular-nums">
            {row.appointment_ref}
          </p>
          {row.status === 'HELD' && row.hold_expires_at && (
            <p className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-amber-700 tabular-nums">
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>Hold: {formatHoldRemaining(row.hold_expires_at, nowMs)}</span>
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'patient',
      header: 'Patient',
      render: (row) => <span className="font-medium text-slate-900">{row.patient_name}</span>,
    },
    {
      key: 'doctor',
      header: 'Doctor & Branch',
      render: (row) => (
        <div>
          <p className="text-slate-900">{row.doctor_name || `Slot #${row.slot_id}`}</p>
          <p className="text-xs text-slate-500">
            {row.department_name || 'OPD'}
            {row.branch_meta
              ? ` · ${row.branch_meta.branch_name} (${row.branch_meta.country_code})`
              : ''}
            {row.local_amount != null && row.local_currency && row.local_currency !== 'INR'
              ? ` · ${formatBranchCurrency(row.local_amount, row.local_currency)}`
              : row.consultation_fee
                ? ` · ${formatCurrencyInr(row.consultation_fee)}`
                : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700 tabular-nums">
          {row.slot_date
            ? `${formatDisplayDate(row.slot_date)} ${row.start_time || ''}`
            : formatDisplayDate(row.created_on)}
        </span>
      ),
    },
    {
      key: 'mode',
      header: 'Mode',
      render: (row) => <ConsultationModeBadge mode={row.consultation_mode} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="space-y-1">
          <StatusIndicator status={row.status} />
          {row.status === 'CANCELLED' && row.refund_status === 'REFUND_PENDING' && (
            <p className="text-[11px] font-medium text-amber-700">
              Will refund within 2 hours
              {row.refund_due_at ? ` (${formatRefundRemaining(row.refund_due_at, nowMs)} left)` : ''}
              {row.refund_amount != null
                ? ` · ${formatCurrencyInr(row.refund_amount)} (${row.refund_percentage ?? 0}%)`
                : ''}
            </p>
          )}
          {row.status === 'CANCELLED' && row.refund_status === 'REFUNDED' && (
            <p className="text-[11px] font-medium text-emerald-700">
              Refunded {formatCurrencyInr(row.refund_amount)} ({row.refund_percentage ?? 0}%
              {row.refund_rule_name ? ` · ${row.refund_rule_name}` : ''})
            </p>
          )}
          {row.status === 'CANCELLED' && row.refund_status === 'NO_REFUND' && (
            <p className="text-[11px] text-slate-500">
              No refund ({row.refund_rule_name || 'Cancellation rule'})
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {row.status === 'HELD' && !isAppointmentHoldExpired(row, nowMs) && canConfirm && (
            <button
              type="button"
              onClick={() => handleOpenConfirmPaymentModal(row)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              <span>Confirm &amp; Pay</span>
            </button>
          )}
          {['HELD', 'CONFIRMED'].includes(row.status) && canCancel && (
            <button
              type="button"
              onClick={() => setPendingAction({ appointment: row, type: 'cancel' })}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              <XCircle className="h-3 w-3" aria-hidden="true" />
              <span>Cancel</span>
            </button>
          )}
          {row.status === 'CONFIRMED' && canUpdateOutcome && (
            isSlotEndExpired(row.slot_date, row.start_time, row.end_time) ? (
              <>
                <button
                  type="button"
                  onClick={() => setPendingAction({ appointment: row, type: 'COMPLETED' })}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  Complete
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAction({ appointment: row, type: 'NO_SHOW' })}
                  className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
                >
                  No-Show
                </button>
              </>
            ) : (
              <span className="font-mono text-[11px] text-slate-400">
                Ends {row.end_time || 'later'}
              </span>
            )
          )}
        </div>
      ),
    },
  ];

  if (mode === 'book') {
    return (
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Book OPD Appointment</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Select a date on the calendar to view confirmed doctor slots and book via Oracle PL/SQL.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onModeHandled?.()}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            View My Appointments
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading live doctor availability calendar...
          </div>
        ) : (
          <PatientBookingCalendar
            slots={slots}
            doctors={doctors}
            departments={departments}
            patients={patients}
            isPatientRole={user?.role === 'PATIENT'}
            fixedPatientId={user?.patient_id}
            onRefreshSlots={loadData}
            onBooked={async () => {
              await loadData();
              onModeHandled?.();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {mode === 'history'
              ? 'Appointment History'
              : user?.role === 'DOCTOR'
                ? 'My Patient Appointments'
                : user?.role === 'PATIENT'
                  ? 'My Appointments'
                  : 'Appointments Management'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {activeBranch
              ? `${activeBranch.branch_name} (${activeBranch.city}, ${activeBranch.country_code}) · Powered by Oracle PL/SQL and GBR_ sidecar views.`
              : 'Powered by Oracle PL/SQL booking, hold expiry, confirmation, cancellation, and outcome procedures.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canExport && (
            <button
              type="button"
              onClick={() => {
                const csv = buildCsvString(
                  [
                    'Reference',
                    'Patient',
                    'Doctor',
                    'Department',
                    'Branch',
                    'Country',
                    'Date',
                    'Start Time',
                    'Consultation Mode',
                    'Status',
                  ],
                  filteredAppointments.map((a) => [
                    a.appointment_ref,
                    a.patient_name,
                    a.doctor_name || `Slot #${a.slot_id}`,
                    a.department_name || 'OPD',
                    a.branch_meta?.branch_name || 'Headquarters',
                    a.branch_meta?.country_code || 'IN',
                    a.slot_date || a.created_on,
                    a.start_time || '',
                    a.consultation_mode || 'FACE_TO_FACE',
                    a.status,
                  ]),
                );
                downloadCsvFile('carepulse-appointments.csv', csv);
                notify('Appointments exported as CSV', 'success');
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          )}
          {canExpireHolds && (
            <button
              type="button"
              onClick={handleExpireHolds}
              disabled={expiringHolds}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw className={`h-4 w-4 ${expiringHolds ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{expiringHolds ? 'Expiring...' : 'Expire Holds'}</span>
            </button>
          )}
          {canBook && (
            <button
              type="button"
              onClick={() => setBookOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              <span>Book Appointment</span>
            </button>
          )}
        </div>
      </div>

      {mode === 'list' && user?.role === 'DOCTOR' && awaitingOutcomeAppts.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-950"
        >
          <span className="font-semibold">
            {awaitingOutcomeAppts.length} completed-time appointment
            {awaitingOutcomeAppts.length === 1 ? '' : 's'} awaiting outcome:
          </span>{' '}
          Use the <strong>Complete</strong> or <strong>No-Show</strong> buttons in the table below to finalize analytics records.
        </div>
      )}

      <DataTable
        rows={filteredAppointments}
        columns={columns}
        getRowKey={(row) => row.appointment_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search ref, patient, or doctor..."
        filters={
          <>
            <input
              type="date"
              aria-label="Filter by date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            />
            {user?.role !== 'DOCTOR' && (
              <select
                aria-label="Filter by doctor"
                value={doctorFilter}
                onChange={(e) => setDoctorFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
              >
                <option value="ALL">All Doctors</option>
                {doctors.map((d) => (
                  <option key={d.doctor_id} value={String(d.doctor_id)}>
                    Dr. {d.first_name} {d.last_name}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Filter by consultation mode"
              value={modeFilter}
              onChange={(e) =>
                setModeFilter(e.target.value as 'ALL' | 'ONLINE' | 'FACE_TO_FACE')
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Modes</option>
              <option value="ONLINE">Online Consultation</option>
              <option value="FACE_TO_FACE">Face-to-Face</option>
            </select>
            <select
              aria-label="Filter by appointment status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="HELD">Held</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="NO_SHOW">No-Show</option>
            </select>
          </>
        }
        emptyTitle="No appointments match your criteria"
        emptyDescription={
          canBook
            ? 'Book a new appointment from an available doctor slot on the calendar.'
            : 'Appointments scheduled for your patients will appear here.'
        }
      />

      {/* Calendar Booking Modal */}
      <Modal
        open={bookOpen}
        title="Book OPD Appointment"
        subtitle="Browse available doctor dates on the calendar and book via GIRISH_BOOK_APPOINTMENT."
        onClose={() => setBookOpen(false)}
        maxWidth="2xl"
      >
        <PatientBookingCalendar
          slots={slots}
          doctors={doctors}
          departments={departments}
          patients={patients}
          isPatientRole={user?.role === 'PATIENT'}
          fixedPatientId={user?.patient_id}
          onRefreshSlots={loadData}
          onBooked={async () => {
            setBookOpen(false);
            await loadData();
          }}
          onCancel={() => setBookOpen(false)}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={
          pendingAction?.type === 'cancel'
            ? 'Cancel appointment?'
            : `Mark appointment ${pendingAction?.type}?`
        }
        description={
          pendingAction
            ? pendingAction.type === 'cancel'
              ? (() => {
                  const appt = pendingAction.appointment;
                  const paidAmt = Number(appt.paid_amount || 0);
                  if (paidAmt > 0) {
                    const preview = evaluateCancellationRefund({
                      rules: cancellationRules,
                      slotDate: appt.slot_date,
                      startTime: appt.start_time,
                      paidAmount: paidAmt,
                    });
                    if (preview.refund_status === 'REFUND_PENDING') {
                      return `Ref ${appt.appointment_ref} for ${appt.patient_name}. Paid ${formatCurrencyInr(paidAmt)}. Applicable rule "${preview.rule_name}" grants ${preview.refund_percentage}% refund (${formatCurrencyInr(preview.refund_amount)}). Status will show "Will refund within 2 hours" and complete automatically in 2 hours. The slot will be released immediately for other patients.`;
                    }
                    return `Ref ${appt.appointment_ref} for ${appt.patient_name}. Paid ${formatCurrencyInr(paidAmt)}. Applicable rule "${preview.rule_name}" grants 0% refund. The slot will be released immediately for other patients.`;
                  }
                  return `Ref ${appt.appointment_ref} for ${appt.patient_name}. Cancelling releases the slot immediately for other patients to book.${cancellationRules.length > 0 ? ` Refund rules: ${cancellationRules.map((r) => `${r.rule_name} (${r.refund_percentage}%)`).join(' · ')}.` : ''}`;
                })()
              : `Ref ${pendingAction.appointment.appointment_ref} for ${pendingAction.appointment.patient_name}. Note: Oracle only allows ${pendingAction.type} after the slot end time has passed.`
            : ''
        }
        confirmLabel={
          pendingAction?.type === 'cancel'
            ? 'Cancel Appointment'
            : 'Confirm Action'
        }
        tone={pendingAction?.type === 'cancel' ? 'danger' : 'primary'}
        busy={actionBusy}
        onConfirm={executeAppointmentAction}
        onCancel={() => setPendingAction(null)}
      />

      <AppointmentPaymentModal
        open={Boolean(paymentTarget)}
        appointment={paymentTarget}
        onPayAndConfirm={handlePayAndConfirmAppointment}
        onClose={() => setPaymentTarget(null)}
        busy={paymentBusy}
      />
    </div>
  );
}
