import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, Clock, Download, RefreshCw, XCircle } from 'lucide-react';
import type { Appointment, CancellationRule, Department, Doctor, Patient, Slot } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasModulePermission } from '../../utils/permissions';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import {
  enrichAppointments,
  enrichSlots,
  formatCurrencyInr,
  formatDisplayDate,
  formatHoldRemaining,
  getIsoDatePart,
} from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog';
import { StatusIndicator, ConsultationModeBadge } from '../../components/layout/StatusIndicator';
import { PatientBookingCalendar } from '../../components/calendar/PatientBookingCalendar';

interface AppointmentsPageProps {
  mode?: 'list' | 'book' | 'history';
  onModeHandled?: () => void;
}

export function AppointmentsPage({ mode = 'list', onModeHandled }: AppointmentsPageProps) {
  const { user } = useAuth();
  const { notify } = useToast();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
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
    type: 'confirm' | 'cancel' | 'COMPLETED' | 'NO_SHOW';
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Refresh hold countdown tick every second when any appointment is HELD
  useEffect(() => {
    if (!appointments.some((a) => a.status === 'HELD')) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [appointments]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rawAppts, rawSlots, templates, docs, activeDepts, pats, rules] = await Promise.all([
        apiClient.getAppointments(),
        apiClient.getSlots(),
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

      const joinedSlots = enrichSlots(rawSlots, templates, docs, allDepts);
      const joinedAppts = enrichAppointments(rawAppts, joinedSlots, docs);

      setAppointments(joinedAppts);
      setSlots(joinedSlots);
      setDoctors(docs);
      setDepartments(activeDepts);
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

  const executeAppointmentAction = async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      const { appointment, type } = pendingAction;
      if (type === 'confirm') {
        await apiClient.confirmAppointment(appointment.appointment_id);
        notify(`Appointment ${appointment.appointment_ref} confirmed`, 'success');
      } else if (type === 'cancel') {
        await apiClient.cancelAppointment(appointment.appointment_id);
        notify(`Appointment ${appointment.appointment_ref} cancelled and slot freed`, 'success');
      } else {
        await apiClient.updateAppointmentOutcome(appointment.appointment_id, type);
        notify(`Appointment marked ${type}`, 'success');
      }
      setPendingAction(null);
      await loadData();
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
    return appointments.filter((a) => {
      if (mode === 'history' && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status)) {
        return false;
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
        (a.doctor_name || '').toLowerCase().includes(q)
      );
    });
  }, [appointments, mode, statusFilter, modeFilter, doctorFilter, dateFilter, search]);

  const canBook = hasModulePermission(user, 'APPOINTMENTS', 'CREATE') && user?.role !== 'DOCTOR';
  const canConfirm = hasModulePermission(user, 'APPOINTMENTS', 'UPDATE') && user?.role !== 'DOCTOR';
  const canCancel = hasModulePermission(user, 'APPOINTMENTS', 'DELETE') && user?.role !== 'DOCTOR';
  const canUpdateOutcome =
    hasModulePermission(user, 'APPOINTMENTS', 'UPDATE') && user?.role !== 'PATIENT';
  const canExpireHolds =
    hasModulePermission(user, 'APPOINTMENTS', 'UPDATE') &&
    user?.role !== 'PATIENT' &&
    user?.role !== 'DOCTOR';
  const canExport = hasModulePermission(user, 'APPOINTMENTS', 'EXPORT');

  const columns: DataColumn<Appointment>[] = [
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
      header: 'Doctor & Department',
      render: (row) => (
        <div>
          <p className="text-slate-900">{row.doctor_name || `Slot #${row.slot_id}`}</p>
          <p className="text-xs text-slate-500">
            {row.department_name || 'OPD'}
            {row.consultation_fee ? ` · ${formatCurrencyInr(row.consultation_fee)}` : ''}
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
      render: (row) => <StatusIndicator status={row.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {row.status === 'HELD' && canConfirm && (
            <button
              type="button"
              onClick={() => setPendingAction({ appointment: row, type: 'confirm' })}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              <span>Confirm</span>
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
            <>
              <button
                type="button"
                onClick={() => setPendingAction({ appointment: row, type: 'COMPLETED' })}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Complete
              </button>
              <button
                type="button"
                onClick={() => setPendingAction({ appointment: row, type: 'NO_SHOW' })}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                No-Show
              </button>
            </>
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
            Powered by Oracle PL/SQL booking, hold expiry, confirmation, cancellation, and outcome procedures.
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
          pendingAction?.type === 'confirm'
            ? 'Confirm held appointment?'
            : pendingAction?.type === 'cancel'
              ? 'Cancel appointment?'
              : `Mark appointment ${pendingAction?.type}?`
        }
        description={
          pendingAction
            ? pendingAction.type === 'cancel' && cancellationRules.length > 0
              ? `Ref ${pendingAction.appointment.appointment_ref} for ${pendingAction.appointment.patient_name}. Policy: ${cancellationRules.map((r) => `${r.rule_name} (${r.refund_percentage}% refund)`).join(' · ')}.`
              : pendingAction.type === 'COMPLETED' || pendingAction.type === 'NO_SHOW'
                ? `Ref ${pendingAction.appointment.appointment_ref} for ${pendingAction.appointment.patient_name}. Note: Oracle only allows ${pendingAction.type} after the slot end time has passed.`
                : `Ref ${pendingAction.appointment.appointment_ref} for ${pendingAction.appointment.patient_name}.`
            : ''
        }
        confirmLabel={
          pendingAction?.type === 'cancel' ? 'Cancel Appointment' : 'Confirm Action'
        }
        tone={pendingAction?.type === 'cancel' ? 'danger' : 'primary'}
        busy={actionBusy}
        onConfirm={executeAppointmentAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
