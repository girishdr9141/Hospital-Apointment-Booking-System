import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Doctor, MedicalRecordEntry, Patient } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import { hasModulePermission } from '../../utils/permissions';
import { formatDisplayDate, formatDisplayDateTime } from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog';

export function MedicalRecordsPage() {
  const { user } = useAuth();
  const { notify } = useToast();

  const canCreate = hasModulePermission(user, 'MEDICAL_RECORDS', 'CREATE');
  const canUpdate = hasModulePermission(user, 'MEDICAL_RECORDS', 'UPDATE');
  const canDelete = hasModulePermission(user, 'MEDICAL_RECORDS', 'DELETE');
  const canExport = hasModulePermission(user, 'MEDICAL_RECORDS', 'EXPORT');

  const [records, setRecords] = useState<MedicalRecordEntry[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [inspectRecord, setInspectRecord] = useState<MedicalRecordEntry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MedicalRecordEntry | null>(null);
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [appointmentRef, setAppointmentRef] = useState('');
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [vitalsSummary, setVitalsSummary] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MedicalRecordEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [recRes, patList, docList] = await Promise.all([
        apiClient.getMedicalRecords(),
        apiClient.getPatients().catch(() => [] as Patient[]),
        apiClient.getDoctors().catch(() => [] as Doctor[]),
      ]);
      setRecords(recRes.records || []);
      setPatients(patList);
      setDoctors(docList);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load medical records', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const patientOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of patients) {
      map.set(p.patient_id, `${p.first_name} ${p.last_name}`);
    }
    for (const r of records) {
      if (!map.has(r.patient_id)) {
        map.set(r.patient_id, r.patient_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [patients, records]);

  const openCreate = () => {
    setEditing(null);
    setPatientId(patientOptions[0] ? String(patientOptions[0].id) : '');
    setDoctorId(
      user?.doctor_id
        ? String(user.doctor_id)
        : doctors[0]
          ? String(doctors[0].doctor_id)
          : '',
    );
    setAppointmentRef('');
    setVisitDate(new Date().toISOString().slice(0, 10));
    setChiefComplaint('');
    setDiagnosis('');
    setVitalsSummary('');
    setClinicalNotes('');
    setModalOpen(true);
  };

  const openEdit = (rec: MedicalRecordEntry) => {
    setEditing(rec);
    setPatientId(String(rec.patient_id));
    setDoctorId(String(rec.doctor_id));
    setAppointmentRef(rec.appointment_ref || '');
    setVisitDate(rec.visit_date.slice(0, 10));
    setChiefComplaint(rec.chief_complaint);
    setDiagnosis(rec.diagnosis);
    setVitalsSummary(rec.vitals_summary || '');
    setClinicalNotes(rec.clinical_notes || '');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chiefComplaint.trim() || !diagnosis.trim()) {
      notify('Chief complaint and diagnosis are required.', 'error');
      return;
    }
    if (!editing && !patientId) {
      notify('Please select a patient.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiClient.updateMedicalRecord(editing.record_id, {
          chief_complaint: chiefComplaint.trim(),
          diagnosis: diagnosis.trim(),
          vitals_summary: vitalsSummary.trim() || undefined,
          clinical_notes: clinicalNotes.trim() || '',
        });
        notify('Medical record updated', 'success');
      } else {
        const selectedPat = patientOptions.find((p) => String(p.id) === patientId);
        const selectedDoc = doctors.find((d) => String(d.doctor_id) === doctorId);
        await apiClient.createMedicalRecord({
          patient_id: Number(patientId),
          patient_name: selectedPat?.name,
          doctor_id: doctorId ? Number(doctorId) : user?.doctor_id ?? undefined,
          doctor_name: selectedDoc
            ? `Dr. ${selectedDoc.first_name} ${selectedDoc.last_name}`
            : user?.role === 'DOCTOR'
              ? user.full_name
              : undefined,
          appointment_ref: appointmentRef.trim() || undefined,
          visit_date: visitDate,
          chief_complaint: chiefComplaint.trim(),
          diagnosis: diagnosis.trim(),
          vitals_summary: vitalsSummary.trim() || undefined,
          clinical_notes: clinicalNotes.trim() || undefined,
        });
        notify('Medical record added', 'success');
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save medical record', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.deleteMedicalRecord(deleteTarget.record_id);
      notify(`Medical record ${deleteTarget.record_id} deleted`, 'success');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to delete medical record', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      notify('No medical records to export', 'info');
      return;
    }
    const headers = [
      'Record ID',
      'Visit Date',
      'Patient',
      'Doctor',
      'Appointment Ref',
      'Chief Complaint',
      'Diagnosis',
      'Vitals',
      'Clinical Notes',
    ];
    const rows = filtered.map((r) => [
      r.record_id,
      r.visit_date,
      r.patient_name,
      r.doctor_name,
      r.appointment_ref || '',
      r.chief_complaint,
      r.diagnosis,
      r.vitals_summary || '',
      r.clinical_notes,
    ]);
    downloadCsvFile('carepulse-medical-records.csv', buildCsvString(headers, rows));
    notify(`Exported ${filtered.length} medical record(s)`, 'success');
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.record_id.toLowerCase().includes(q) ||
        r.patient_name.toLowerCase().includes(q) ||
        r.doctor_name.toLowerCase().includes(q) ||
        r.diagnosis.toLowerCase().includes(q) ||
        r.chief_complaint.toLowerCase().includes(q),
    );
  }, [records, search]);

  const columns: DataColumn<MedicalRecordEntry>[] = [
    {
      key: 'id',
      header: 'Record ID',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-slate-900">{row.record_id}</p>
          <p className="font-mono text-[11px] text-slate-500 tabular-nums">
            {formatDisplayDate(row.visit_date)}
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
      header: 'Chief Complaint & Diagnosis',
      render: (row) => (
        <div className="max-w-sm">
          <p className="font-medium text-slate-900">{row.diagnosis}</p>
          <p className="text-xs text-slate-500 line-clamp-1">{row.chief_complaint}</p>
        </div>
      ),
    },
    {
      key: 'vitals',
      header: 'Vitals',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700">{row.vitals_summary || '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="inline-flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setInspectRecord(row)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>View</span>
          </button>
          {canUpdate && (
            <button
              type="button"
              onClick={() => openEdit(row)}
              aria-label={`Edit ${row.record_id}`}
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
              aria-label={`Delete ${row.record_id}`}
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
            {user?.role === 'PATIENT' ? 'My Medical Records' : 'Outpatient Medical Records'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {user?.role === 'PATIENT'
              ? 'Read-only outpatient consultation notes, vitals, and visit diagnoses.'
              : user?.role === 'DOCTOR'
                ? 'Clinical visit records scoped to patients booked under your practice.'
                : 'Inspect and manage outpatient clinical notes, vitals, and diagnoses.'}
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
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New Medical Record</span>
            </button>
          )}
        </div>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.record_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search patient, doctor, diagnosis, or complaint..."
        emptyTitle="No medical records found"
        emptyDescription={
          canCreate
            ? 'Click New Medical Record to document an outpatient consultation.'
            : 'Permitted clinical records will appear here once documented by a physician.'
        }
      />

      {/* Inspect Clinical Record Modal */}
      <Modal
        open={Boolean(inspectRecord)}
        title={inspectRecord ? `${inspectRecord.record_id} — ${inspectRecord.patient_name}` : ''}
        subtitle={
          inspectRecord
            ? `${inspectRecord.doctor_name} · Visit ${formatDisplayDate(inspectRecord.visit_date)}${
                inspectRecord.appointment_ref ? ` · ${inspectRecord.appointment_ref}` : ''
              }`
            : ''
        }
        onClose={() => setInspectRecord(null)}
        maxWidth="lg"
      >
        {inspectRecord && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-500">Chief Complaint</p>
                <p className="mt-0.5 font-medium text-slate-900">{inspectRecord.chief_complaint}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Vitals Summary</p>
                <p className="mt-0.5 font-mono text-xs text-slate-800">
                  {inspectRecord.vitals_summary || 'Not recorded'}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Diagnosis</p>
              <p className="mt-1 rounded-lg border border-teal-200 bg-teal-50/50 px-3.5 py-2.5 font-medium text-teal-950">
                {inspectRecord.diagnosis}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Clinical Notes</p>
              <div className="mt-1 rounded-lg border border-slate-200 bg-white p-3.5 text-slate-700 whitespace-pre-wrap">
                {inspectRecord.clinical_notes || 'No additional clinical notes recorded.'}
              </div>
            </div>
            <p className="font-mono text-[11px] text-slate-400">
              Last updated {formatDisplayDateTime(inspectRecord.updated_at)}
            </p>
          </div>
        )}
      </Modal>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        title={editing ? `Edit Medical Record ${editing.record_id}` : 'Create Medical Record'}
        subtitle="Document patient vitals, chief complaint, diagnosis, and clinical observations."
        onClose={() => setModalOpen(false)}
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {!editing && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="mr-patient" className="block text-sm font-medium text-slate-700">
                  Patient *
                </label>
                <select
                  id="mr-patient"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
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
                  <label htmlFor="mr-doctor" className="block text-sm font-medium text-slate-700">
                    Attending Doctor
                  </label>
                  <select
                    id="mr-doctor"
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
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mr-visit" className="block text-sm font-medium text-slate-700">
                Visit Date
              </label>
              <input
                id="mr-visit"
                type="date"
                value={visitDate}
                disabled={Boolean(editing)}
                onChange={(e) => setVisitDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
              />
            </div>
            <div>
              <label htmlFor="mr-appt-ref" className="block text-sm font-medium text-slate-700">
                Appointment Ref (optional)
              </label>
              <input
                id="mr-appt-ref"
                type="text"
                value={appointmentRef}
                disabled={Boolean(editing)}
                onChange={(e) => setAppointmentRef(e.target.value)}
                placeholder="APT-..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="mr-complaint" className="block text-sm font-medium text-slate-700">
              Chief Complaint *
            </label>
            <input
              id="mr-complaint"
              type="text"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="e.g., Persistent migraine and dizziness for 3 days"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mr-diagnosis" className="block text-sm font-medium text-slate-700">
                Diagnosis *
              </label>
              <input
                id="mr-diagnosis"
                type="text"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g., Migraine without aura"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="mr-vitals" className="block text-sm font-medium text-slate-700">
                Vitals Summary
              </label>
              <input
                id="mr-vitals"
                type="text"
                value={vitalsSummary}
                onChange={(e) => setVitalsSummary(e.target.value)}
                placeholder="BP 120/80 · Pulse 74 · SpO2 99%"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="mr-notes" className="block text-sm font-medium text-slate-700">
              Clinical Notes
            </label>
            <textarea
              id="mr-notes"
              rows={3}
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              placeholder="Examination findings, follow-up advice, and precautions..."
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Save Record'}</span>
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete medical record?"
        description={
          deleteTarget
            ? `Permanently delete medical record ${deleteTarget.record_id} for ${deleteTarget.patient_name}?`
            : ''
        }
        confirmLabel="Delete Record"
        tone="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
