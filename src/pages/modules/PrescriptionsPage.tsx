import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Download, Eye, Pencil, Pill, Plus, Trash2 } from 'lucide-react';
import type { Appointment, Doctor, Patient, PrescriptionEntry } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import { hasModulePermission } from '../../utils/permissions';
import { getTodayIsoLocal, isAppointmentTimeReached } from '../../utils/calendar';
import {
  enrichAppointments,
  enrichSlots,
  formatDisplayDate,
  formatDisplayDateTime,
} from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog';
import { ConsultationModeBadge, StatusIndicator } from '../../components/layout/StatusIndicator';

interface MedicationDraft {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
}

const EMPTY_MED: MedicationDraft = {
  name: '',
  dosage: '',
  frequency: '',
  duration: '',
};

export function PrescriptionsPage() {
  const { user } = useAuth();
  const { notify } = useToast();

  const canCreate = hasModulePermission(user, 'PRESCRIPTIONS', 'CREATE');
  const canUpdate = hasModulePermission(user, 'PRESCRIPTIONS', 'UPDATE');
  const canDelete = hasModulePermission(user, 'PRESCRIPTIONS', 'DELETE');
  const canExport = hasModulePermission(user, 'PRESCRIPTIONS', 'EXPORT');

  const [prescriptions, setPrescriptions] = useState<PrescriptionEntry[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED'>('ALL');
  const [inspectRx, setInspectRx] = useState<PrescriptionEntry | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PrescriptionEntry | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [appointmentRef, setAppointmentRef] = useState('');
  const [prescribedDate, setPrescribedDate] = useState(() => getTodayIsoLocal());
  const [diagnosis, setDiagnosis] = useState('');
  const [medications, setMedications] = useState<MedicationDraft[]>([{ ...EMPTY_MED }]);
  const [instructions, setInstructions] = useState('');
  const [rxStatus, setRxStatus] = useState<'ACTIVE' | 'COMPLETED'>('ACTIVE');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<PrescriptionEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rxRes, patList, docList, rawAppts, rawSlots, templates] = await Promise.all([
        apiClient.getPrescriptions(),
        apiClient.getPatients().catch(() => [] as Patient[]),
        apiClient.getDoctors().catch(() => [] as Doctor[]),
        apiClient.getAppointments().catch(() => [] as Appointment[]),
        apiClient.getSlots().catch(() => []),
        apiClient.getSlotTemplates().catch(() => []),
      ]);
      const joinedSlots = enrichSlots(rawSlots, templates, docList, []);
      const joinedAppts = enrichAppointments(rawAppts, joinedSlots, docList);
      setPrescriptions(rxRes.prescriptions || []);
      setPatients(patList);
      setDoctors(docList);
      setAppointments(joinedAppts);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load prescriptions', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeAppointments = useMemo(() => {
    return appointments
      .filter((a) => {
        if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') return false;
        if (user?.role === 'DOCTOR' && user.doctor_id) {
          return a.doctor_id === user.doctor_id;
        }
        return true;
      })
      .sort((a, b) => {
        const ad = `${a.slot_date || ''} ${a.start_time || ''}`;
        const bd = `${b.slot_date || ''} ${b.start_time || ''}`;
        return bd.localeCompare(ad);
      });
  }, [appointments, user?.role, user?.doctor_id]);

  const selectedAppointment = useMemo(
    () =>
      activeAppointments.find((a) => String(a.appointment_id) === selectedAppointmentId) || null,
    [activeAppointments, selectedAppointmentId],
  );

  const isSelectedAppointmentReached = useMemo(() => {
    if (!selectedAppointment) return false;
    return isAppointmentTimeReached(selectedAppointment.slot_date, selectedAppointment.start_time);
  }, [selectedAppointment]);

  const makeNonce = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const patientOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of patients) {
      map.set(p.patient_id, `${p.first_name} ${p.last_name}`);
    }
    for (const a of appointments) {
      if (!map.has(a.patient_id)) {
        map.set(a.patient_id, a.patient_name);
      }
    }
    for (const rx of prescriptions) {
      if (!map.has(rx.patient_id)) {
        map.set(rx.patient_id, rx.patient_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [patients, appointments, prescriptions]);

  const openCreate = (presetAppt?: Appointment) => {
    const targetAppt =
      presetAppt ||
      activeAppointments.find((a) => isAppointmentTimeReached(a.slot_date, a.start_time)) ||
      activeAppointments[0] ||
      null;

    setEditing(null);
    setIdempotencyKey(makeNonce());
    if (targetAppt) {
      setSelectedAppointmentId(String(targetAppt.appointment_id));
      setPatientId(String(targetAppt.patient_id));
      setDoctorId(targetAppt.doctor_id ? String(targetAppt.doctor_id) : '');
      setAppointmentRef(targetAppt.appointment_ref);
    } else {
      setSelectedAppointmentId('');
      setPatientId(patientOptions[0] ? String(patientOptions[0].id) : '');
      setDoctorId(
        user?.doctor_id
          ? String(user.doctor_id)
          : doctors[0]
            ? String(doctors[0].doctor_id)
            : '',
      );
      setAppointmentRef('');
    }
    setPrescribedDate(getTodayIsoLocal());
    setDiagnosis('');
    setMedications([{ ...EMPTY_MED }]);
    setInstructions('');
    setRxStatus('ACTIVE');
    setModalOpen(true);
  };

  const openEdit = (rx: PrescriptionEntry) => {
    setEditing(rx);
    setIdempotencyKey(makeNonce());
    setSelectedAppointmentId('');
    setPatientId(String(rx.patient_id));
    setDoctorId(String(rx.doctor_id));
    setAppointmentRef(rx.appointment_ref || '');
    setPrescribedDate(rx.prescribed_date.slice(0, 10));
    setDiagnosis(rx.diagnosis);
    setMedications(rx.medications.length > 0 ? rx.medications.map((m) => ({ ...m })) : [{ ...EMPTY_MED }]);
    setInstructions(rx.instructions || '');
    setRxStatus(rx.status);
    setModalOpen(true);
  };

  const updateMedRow = (idx: number, field: keyof MedicationDraft, value: string) => {
    setMedications((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)),
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const validMeds = medications.filter((m) => m.name.trim());
    if (!diagnosis.trim() || validMeds.length === 0) {
      notify('Diagnosis and at least one medication name are required.', 'error');
      return;
    }
    if (!editing) {
      if (!selectedAppointment) {
        notify('Please select an appointment before issuing a prescription.', 'error');
        return;
      }
      if (!isSelectedAppointmentReached) {
        notify('Prescription can only be issued after the scheduled appointment time.', 'error');
        return;
      }
      if (!patientId) {
        notify('Please select a patient.', 'error');
        return;
      }
    }
    setSaving(true);
    try {
      const normalizedMeds = validMeds.map((m) => ({
        name: m.name.trim(),
        dosage: m.dosage.trim() || 'As directed',
        frequency: m.frequency.trim() || 'Once daily',
        duration: m.duration.trim() || '5 days',
      }));

      if (editing) {
        await apiClient.updatePrescription(editing.prescription_id, {
          diagnosis: diagnosis.trim(),
          medications: normalizedMeds,
          instructions: instructions.trim(),
          status: rxStatus,
          idempotency_key: idempotencyKey || makeNonce(),
        });
        notify(`Prescription ${editing.prescription_id} updated`, 'success');
      } else {
        const selectedPat = patientOptions.find((p) => String(p.id) === patientId);
        const selectedDoc = doctors.find((d) => String(d.doctor_id) === doctorId);
        await apiClient.createPrescription({
          patient_id: Number(patientId),
          patient_name: selectedAppointment?.patient_name || selectedPat?.name,
          doctor_id: doctorId ? Number(doctorId) : user?.doctor_id ?? undefined,
          doctor_name:
            selectedAppointment?.doctor_name ||
            (selectedDoc
              ? `Dr. ${selectedDoc.first_name} ${selectedDoc.last_name}`
              : user?.role === 'DOCTOR'
                ? user.full_name
                : undefined),
          appointment_id: selectedAppointment?.appointment_id,
          appointment_ref: selectedAppointment?.appointment_ref || appointmentRef.trim() || undefined,
          prescribed_date: prescribedDate,
          diagnosis: diagnosis.trim(),
          medications: normalizedMeds,
          instructions: instructions.trim(),
          idempotency_key: idempotencyKey || makeNonce(),
        });
        notify('Prescription issued', 'success');
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save prescription', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkCompleted = async (rx: PrescriptionEntry) => {
    try {
      await apiClient.updatePrescription(rx.prescription_id, { status: 'COMPLETED' });
      notify(`Prescription ${rx.prescription_id} marked COMPLETED`, 'success');
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update prescription status', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.deletePrescription(deleteTarget.prescription_id);
      notify(`Prescription ${deleteTarget.prescription_id} deleted`, 'success');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to delete prescription', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      notify('No prescriptions to export', 'info');
      return;
    }
    const headers = [
      'Prescription ID',
      'Date',
      'Patient',
      'Doctor',
      'Diagnosis',
      'Medications',
      'Instructions',
      'Status',
    ];
    const rows = filtered.map((rx) => [
      rx.prescription_id,
      rx.prescribed_date,
      rx.patient_name,
      rx.doctor_name,
      rx.diagnosis,
      rx.medications
        .map((m) => `${m.name} (${m.dosage}, ${m.frequency}, ${m.duration})`)
        .join(' | '),
      rx.instructions,
      rx.status,
    ]);
    downloadCsvFile('carepulse-prescriptions.csv', buildCsvString(headers, rows));
    notify(`Exported ${filtered.length} prescription(s)`, 'success');
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prescriptions.filter((rx) => {
      if (statusFilter !== 'ALL' && rx.status !== statusFilter) return false;
      if (!q) return true;
      return (
        rx.prescription_id.toLowerCase().includes(q) ||
        rx.patient_name.toLowerCase().includes(q) ||
        rx.doctor_name.toLowerCase().includes(q) ||
        rx.diagnosis.toLowerCase().includes(q) ||
        rx.medications.some((m) => m.name.toLowerCase().includes(q))
      );
    });
  }, [prescriptions, statusFilter, search]);

  const columns: DataColumn<PrescriptionEntry>[] = [
    {
      key: 'id',
      header: 'Rx ID',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-slate-900">{row.prescription_id}</p>
          <p className="font-mono text-[11px] text-slate-500 tabular-nums">
            {formatDisplayDate(row.prescribed_date)}
            {row.appointment_ref ? ` · ${row.appointment_ref}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'patient',
      header: 'Patient & Doctor',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.patient_name}</p>
          <p className="text-xs text-slate-500">{row.doctor_name}</p>
        </div>
      ),
    },
    {
      key: 'diagnosis',
      header: 'Diagnosis & Medications',
      render: (row) => (
        <div className="max-w-sm">
          <p className="font-medium text-slate-900">{row.diagnosis}</p>
          <p className="text-xs text-slate-500 line-clamp-1">
            {row.medications.map((m) => `${m.name} ${m.dosage}`).join(' · ')}
          </p>
        </div>
      ),
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
          <button
            type="button"
            onClick={() => setInspectRx(row)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>View</span>
          </button>
          {canUpdate && row.status === 'ACTIVE' && (
            <button
              type="button"
              onClick={() => handleMarkCompleted(row)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Complete</span>
            </button>
          )}
          {canUpdate && (
            <button
              type="button"
              onClick={() => openEdit(row)}
              aria-label={`Edit ${row.prescription_id}`}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Edit</span>
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setDeleteTarget(row)}
              aria-label={`Delete ${row.prescription_id}`}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Delete</span>
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {user?.role === 'PATIENT' ? 'My Prescriptions' : 'Outpatient Prescriptions'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {user?.role === 'PATIENT'
              ? 'View medications, dosages, and care instructions issued during your OPD consultations.'
              : user?.role === 'DOCTOR'
                ? 'Issue and manage medication prescriptions for patients booked with you.'
                : 'Digital outpatient prescriptions scoped dynamically by role and RBAC permissions.'}
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
              onClick={() => openCreate()}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Issue Prescription</span>
            </button>
          )}
        </div>
      </div>

      {canCreate && activeAppointments.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Appointments &amp; Prescription Eligibility
              </h3>
              <p className="text-xs text-slate-500">
                Prescriptions can only be issued on or after the scheduled appointment date and time.
              </p>
            </div>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {activeAppointments.slice(0, 6).map((appt) => {
              const reached = isAppointmentTimeReached(appt.slot_date, appt.start_time);
              return (
                <div
                  key={appt.appointment_id}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <span className="font-mono font-semibold text-slate-900">
                      {appt.appointment_ref}
                    </span>
                    <span className="font-medium text-slate-800">{appt.patient_name}</span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {appt.slot_date
                        ? `${formatDisplayDate(appt.slot_date)} ${appt.start_time || ''}`
                        : formatDisplayDate(appt.created_on)}
                    </span>
                    <ConsultationModeBadge mode={appt.consultation_mode} />
                    <StatusIndicator status={appt.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {!reached && (
                      <span className="text-xs font-medium text-amber-700">
                        Prescription can only be issued after the scheduled appointment time.
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={!reached}
                      onClick={() => openCreate(appt)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 whitespace-nowrap"
                    >
                      <Pill className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Issue Prescription</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.prescription_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search Rx ID, patient, doctor, medication..."
        filters={
          <select
            aria-label="Filter prescriptions by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'COMPLETED')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="COMPLETED">Completed</option>
          </select>
        }
        emptyTitle="No prescriptions found"
        emptyDescription={
          canCreate
            ? 'Click Issue Prescription to create a structured medication regimen.'
            : 'Prescriptions issued for your permitted scope will appear here.'
        }
      />

      {/* Inspect Rx Modal */}
      <Modal
        open={Boolean(inspectRx)}
        title={inspectRx ? `${inspectRx.prescription_id} — ${inspectRx.patient_name}` : ''}
        subtitle={
          inspectRx
            ? `${inspectRx.doctor_name} · Prescribed ${formatDisplayDate(inspectRx.prescribed_date)}`
            : ''
        }
        onClose={() => setInspectRx(null)}
        maxWidth="lg"
      >
        {inspectRx && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs text-slate-500">Diagnosis</p>
                <p className="font-semibold text-slate-900">{inspectRx.diagnosis}</p>
              </div>
              <StatusIndicator status={inspectRx.status} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Medications ({inspectRx.medications.length})
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Medication</th>
                      <th className="px-3 py-2">Dosage</th>
                      <th className="px-3 py-2">Frequency</th>
                      <th className="px-3 py-2">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspectRx.medications.map((m, idx) => (
                      <tr key={`${m.name}-${idx}`}>
                        <td className="px-3 py-2 font-medium text-slate-900">{m.name}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{m.dosage}</td>
                        <td className="px-3 py-2 text-slate-700">{m.frequency}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{m.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500">Patient Instructions</p>
              <p className="mt-1 rounded-lg border border-slate-200 bg-white p-3 text-slate-700">
                {inspectRx.instructions || 'Take medications as prescribed above.'}
              </p>
            </div>

            <p className="font-mono text-[11px] text-slate-400">
              Updated {formatDisplayDateTime(inspectRx.updated_at)}
            </p>
          </div>
        )}
      </Modal>

      {/* Issue / Edit Prescription Modal */}
      <Modal
        open={modalOpen}
        title={editing ? `Edit Prescription ${editing.prescription_id}` : 'Issue Prescription'}
        subtitle="Specify diagnosis, structured medication schedule, and follow-up instructions."
        onClose={() => setModalOpen(false)}
        maxWidth="xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {!editing && (
            <div className="space-y-4">
              <div>
                <label htmlFor="rx-appointment" className="block text-sm font-medium text-slate-700">
                  Associated Appointment *
                </label>
                <select
                  id="rx-appointment"
                  value={selectedAppointmentId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedAppointmentId(nextId);
                    const picked = activeAppointments.find(
                      (a) => String(a.appointment_id) === nextId,
                    );
                    if (picked) {
                      setPatientId(String(picked.patient_id));
                      setDoctorId(picked.doctor_id ? String(picked.doctor_id) : '');
                      setAppointmentRef(picked.appointment_ref);
                    }
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
                >
                  <option value="">Select scheduled appointment</option>
                  {activeAppointments.map((a) => {
                    const reached = isAppointmentTimeReached(a.slot_date, a.start_time);
                    return (
                      <option key={a.appointment_id} value={String(a.appointment_id)}>
                        {a.appointment_ref} · {a.patient_name} ·{' '}
                        {a.slot_date
                          ? `${formatDisplayDate(a.slot_date)} ${a.start_time || ''}`
                          : formatDisplayDate(a.created_on)}{' '}
                        ({a.consultation_mode === 'ONLINE' ? 'Online' : 'Face-to-Face'})
                        {reached ? ' — Eligible' : ' — Before scheduled time'}
                      </option>
                    );
                  })}
                </select>
              </div>

              {(!selectedAppointment || !isSelectedAppointmentReached) && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <span>
                    Prescription can only be issued after the scheduled appointment time.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="rx-patient" className="block text-sm font-medium text-slate-700">
                    Patient *
                  </label>
                  <select
                    id="rx-patient"
                    value={patientId}
                    disabled={Boolean(selectedAppointment)}
                    onChange={(e) => setPatientId(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
                  >
                    <option value="">Select patient</option>
                    {patientOptions.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} (#{p.id})
                      </option>
                    ))}
                  </select>
                </div>
                {user?.role !== 'DOCTOR' && (
                  <div>
                    <label htmlFor="rx-doctor" className="block text-sm font-medium text-slate-700">
                      Prescribing Doctor
                    </label>
                    <select
                      id="rx-doctor"
                      value={doctorId}
                      disabled={Boolean(selectedAppointment)}
                      onChange={(e) => setDoctorId(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
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
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="rx-diag" className="block text-sm font-medium text-slate-700">
                Diagnosis *
              </label>
              <input
                id="rx-diag"
                type="text"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g., Acute Bronchitis"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="rx-date" className="block text-sm font-medium text-slate-700">
                Prescribed Date
              </label>
              <input
                id="rx-date"
                type="date"
                value={prescribedDate}
                disabled={Boolean(editing)}
                onChange={(e) => setPrescribedDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
              />
            </div>
            {editing ? (
              <div>
                <label htmlFor="rx-status" className="block text-sm font-medium text-slate-700">
                  Regimen Status
                </label>
                <select
                  id="rx-status"
                  value={rxStatus}
                  onChange={(e) => setRxStatus(e.target.value as 'ACTIVE' | 'COMPLETED')}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
            ) : (
              <div>
                <label htmlFor="rx-appt" className="block text-sm font-medium text-slate-700">
                  Appointment Ref
                </label>
                <input
                  id="rx-appt"
                  type="text"
                  value={appointmentRef}
                  readOnly
                  placeholder="APT-..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">Medications *</span>
              <button
                type="button"
                onClick={() => setMedications((prev) => [...prev, { ...EMPTY_MED }])}
                className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                <span>Add Medicine</span>
              </button>
            </div>

            {medications.map((med, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                <input
                  type="text"
                  aria-label={`Medication ${idx + 1} name`}
                  placeholder="Medicine name"
                  value={med.name}
                  onChange={(e) => updateMedRow(idx, 'name', e.target.value)}
                  className="sm:col-span-4 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-700 focus:outline-none"
                />
                <input
                  type="text"
                  aria-label={`Medication ${idx + 1} dosage`}
                  placeholder="Dosage (500 mg)"
                  value={med.dosage}
                  onChange={(e) => updateMedRow(idx, 'dosage', e.target.value)}
                  className="sm:col-span-3 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-700 focus:outline-none"
                />
                <input
                  type="text"
                  aria-label={`Medication ${idx + 1} frequency`}
                  placeholder="Frequency (Twice daily)"
                  value={med.frequency}
                  onChange={(e) => updateMedRow(idx, 'frequency', e.target.value)}
                  className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-700 focus:outline-none"
                />
                <input
                  type="text"
                  aria-label={`Medication ${idx + 1} duration`}
                  placeholder="Duration (5 days)"
                  value={med.duration}
                  onChange={(e) => updateMedRow(idx, 'duration', e.target.value)}
                  className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-700 focus:outline-none"
                />
                <div className="sm:col-span-1 flex items-center justify-end">
                  {medications.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setMedications((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))
                      }
                      aria-label={`Remove medication ${idx + 1}`}
                      className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="rx-instructions" className="block text-sm font-medium text-slate-700">
              Care &amp; Administration Instructions
            </label>
            <textarea
              id="rx-instructions"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Take after meals; hydrate well; follow up in 7 days..."
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
              disabled={saving || (!editing && !isSelectedAppointmentReached)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pill className="h-4 w-4" aria-hidden="true" />
              <span>{saving ? 'Saving...' : editing ? 'Update Prescription' : 'Issue Prescription'}</span>
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete prescription?"
        description={
          deleteTarget
            ? `Permanently delete prescription ${deleteTarget.prescription_id} for ${deleteTarget.patient_name}?`
            : ''
        }
        confirmLabel="Delete Prescription"
        tone="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
