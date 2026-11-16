import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Appointment, Department, Doctor, DoctorShiftConfig, Slot, SlotTemplate } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { enrichAppointments, enrichSlots, formatCurrencyInr, formatDisplayDate } from '../../utils/rules';
import { formatShiftSummary } from '../../utils/calendar';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

export function DoctorsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = user?.role === 'ADMIN';

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [shifts, setShifts] = useState<DoctorShiftConfig[]>([]);
  const [inspectDoctor, setInspectDoctor] = useState<Doctor | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [consultationFee, setConsultationFee] = useState('');
  const [teleConsult, setTeleConsult] = useState<'Y' | 'N'>('N');
  const [employmentType, setEmploymentType] = useState<'FULL_TIME' | 'PART_TIME'>('FULL_TIME');
  const [loginEmail, setLoginEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('Doctor@123');
  const [saving, setSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<Doctor | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [docs, activeDepts, rawSlots, rawTemplates, rawAppts, shiftsRes] = await Promise.all([
        apiClient.getDoctors(),
        apiClient.getDepartments(),
        apiClient.getSlots().catch(() => [] as Slot[]),
        apiClient.getSlotTemplates().catch(() => [] as SlotTemplate[]),
        apiClient.getAppointments().catch(() => [] as Appointment[]),
        apiClient.getDoctorShifts().catch(() => ({ shifts: [] as DoctorShiftConfig[] })),
      ]);
      const resolvedDepts = await apiClient.resolveDepartmentsForIds(
        docs.map((d) => d.department_id),
        activeDepts,
      );
      const joinedSlots = enrichSlots(rawSlots, rawTemplates, docs, resolvedDepts);
      const joinedAppts = enrichAppointments(rawAppts, joinedSlots, docs);
      setDoctors(docs);
      setDepartments(activeDepts);
      setAllDepartments(resolvedDepts);
      setSlots(joinedSlots);
      setAppointments(joinedAppts);
      setShifts(shiftsRes.shifts || []);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load doctors', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deptMap = useMemo(
    () =>
      new Map(
        allDepartments.map((d) => [
          d.department_id,
          d.is_active === 'N' ? `${d.department_name} (Inactive)` : d.department_name,
        ]),
      ),
    [allDepartments],
  );

  const openCreate = () => {
    setEditing(null);
    setDepartmentId(departments[0] ? String(departments[0].department_id) : '');
    setFirstName('');
    setLastName('');
    setSpecialization('');
    setConsultationFee('500');
    setTeleConsult('N');
    setEmploymentType('FULL_TIME');
    setLoginEmail('');
    setInitialPassword('Doctor@123');
    setModalOpen(true);
  };

  const openEdit = (doc: Doctor) => {
    setEditing(doc);
    setDepartmentId(String(doc.department_id));
    setFirstName(doc.first_name);
    setLastName(doc.last_name);
    setSpecialization(doc.specialization || '');
    setConsultationFee(String(doc.consultation_fee));
    setTeleConsult(doc.tele_consult_flag);
    setEmploymentType(doc.employment_type || 'FULL_TIME');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!departmentId || !firstName.trim() || !lastName.trim() || !consultationFee) {
      notify('Department, first name, last name, and consultation fee are required', 'error');
      return;
    }
    const fee = Number(consultationFee);
    if (Number.isNaN(fee) || fee < 0) {
      notify('Consultation fee must be a valid non-negative number', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        department_id: Number(departmentId),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        specialization: specialization.trim() || undefined,
        consultation_fee: fee,
        tele_consult_flag: teleConsult,
        employment_type: employmentType,
      };
      if (editing) {
        await apiClient.updateDoctor(editing.doctor_id, payload);
        notify('Doctor profile updated', 'success');
      } else {
        const created = await apiClient.createDoctor({
          ...payload,
          ...(loginEmail.trim() ? { login_email: loginEmail.trim().toLowerCase() } : {}),
          ...(initialPassword.trim() ? { initial_password: initialPassword.trim() } : {}),
        });
        notify(
          created.login_email
            ? `Doctor registered! Portal login email: ${created.login_email}`
            : 'Doctor added successfully',
          'success',
        );
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save doctor', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await apiClient.deactivateDoctor(deactivateTarget.doctor_id);
      notify(`Dr. ${deactivateTarget.first_name} ${deactivateTarget.last_name} deactivated`, 'success');
      setDeactivateTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to deactivate doctor', 'error');
    } finally {
      setDeactivating(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return doctors.filter((doc) => {
      if (deptFilter !== 'ALL' && String(doc.department_id) !== deptFilter) return false;
      if (!q) return true;
      const fullName = `${doc.first_name} ${doc.last_name}`.toLowerCase();
      const deptName = (deptMap.get(doc.department_id) || '').toLowerCase();
      return (
        fullName.includes(q) ||
        (doc.specialization || '').toLowerCase().includes(q) ||
        deptName.includes(q)
      );
    });
  }, [doctors, deptFilter, search, deptMap]);

  const shiftByDoctorId = useMemo(
    () => new Map(shifts.map((s) => [s.doctor_id, s])),
    [shifts],
  );

  const apptBySlotId = useMemo(() => {
    const map = new Map<number, Appointment>();
    for (const a of appointments) {
      if (a.status !== 'CANCELLED') map.set(a.slot_id, a);
    }
    return map;
  }, [appointments]);

  const inspectDoctorSlots = useMemo(
    () =>
      inspectDoctor
        ? slots.filter((s) => s.doctor_id === inspectDoctor.doctor_id && s.status !== 'CANCELLED')
        : [],
    [inspectDoctor, slots],
  );

  const columns: DataColumn<Doctor>[] = [
    {
      key: 'name',
      header: 'Doctor',
      render: (row) => (
        <button
          type="button"
          onClick={() => setInspectDoctor(row)}
          className="text-left group"
        >
          <p className="font-medium text-slate-900 group-hover:text-teal-700 group-hover:underline">
            Dr. {row.first_name} {row.last_name}
          </p>
          <p className="text-xs text-slate-500">{row.specialization || 'General OPD'}</p>
        </button>
      ),
    },
    {
      key: 'dept',
      header: 'Department',
      render: (row) => (
        <span className="text-slate-700">
          {deptMap.get(row.department_id) || `Dept #${row.department_id}`}
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Fee',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-slate-900 tabular-nums">
          {formatCurrencyInr(row.consultation_fee)}
        </span>
      ),
    },
    {
      key: 'tele',
      header: 'Tele-Consult',
      render: (row) => (
        <span className="text-xs text-slate-600">
          {row.tele_consult_flag === 'Y' ? 'Supported' : 'In-person only'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row: Doctor) => (
        <div className="inline-flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setInspectDoctor(row)}
            className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Slots</span>
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => openEdit(row)}
                aria-label={`Edit Dr. ${row.first_name} ${row.last_name}`}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setDeactivateTarget(row)}
                aria-label={`Deactivate Dr. ${row.first_name} ${row.last_name}`}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Deactivate</span>
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Medical Staff &amp; Doctors</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Active physicians, department assignments, and consultation fees from GIRISH_DOCTORS.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Register Doctor</span>
          </button>
        )}
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.doctor_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search doctor name or specialization..."
        filters={
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
        }
        emptyTitle="No matching doctors"
        emptyDescription="Adjust filters or register a doctor to this department."
      />

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Doctor Profile' : 'Register Doctor'}
        subtitle="Updates GIRISH_DOCTORS in Oracle APEX."
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-first" className="block text-sm font-medium text-slate-700">
                First name *
              </label>
              <input
                id="doc-first"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="doc-last" className="block text-sm font-medium text-slate-700">
                Last name *
              </label>
              <input
                id="doc-last"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-dept" className="block text-sm font-medium text-slate-700">
                Department *
              </label>
              <select
                id="doc-dept"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                {departments.map((d) => (
                  <option key={d.department_id} value={String(d.department_id)}>
                    {d.department_name}
                  </option>
                ))}
                {editing &&
                  !departments.some((d) => d.department_id === editing.department_id) && (
                    <option value={String(editing.department_id)}>
                      {deptMap.get(editing.department_id) || `Dept #${editing.department_id}`}
                    </option>
                  )}
              </select>
            </div>
            <div>
              <label htmlFor="doc-fee" className="block text-sm font-medium text-slate-700">
                Consultation fee (INR) *
              </label>
              <input
                id="doc-fee"
                type="number"
                min="0"
                step="0.01"
                value={consultationFee}
                onChange={(e) => setConsultationFee(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="doc-spec" className="block text-sm font-medium text-slate-700">
              Specialization
            </label>
            <input
              id="doc-spec"
              type="text"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              placeholder="e.g., Interventional Cardiology"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-emp" className="block text-sm font-medium text-slate-700">
                Employment type
              </label>
              <select
                id="doc-emp"
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as 'FULL_TIME' | 'PART_TIME')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="FULL_TIME">Full Time</option>
                <option value="PART_TIME">Part Time</option>
              </select>
            </div>
            <div>
              <label htmlFor="doc-tele" className="block text-sm font-medium text-slate-700">
                Tele-consultation
              </label>
              <select
                id="doc-tele"
                value={teleConsult}
                onChange={(e) => setTeleConsult(e.target.value as 'Y' | 'N')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="N">In-person only (N)</option>
                <option value="Y">Tele-consult enabled (Y)</option>
              </select>
            </div>
          </div>

          {!editing && (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="doc-login-email" className="block text-xs font-medium text-slate-700">
                  Portal Login Email (auto-generated if blank)
                </label>
                <input
                  id="doc-login-email"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder={
                    firstName && lastName
                      ? `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, '.') +
                        '@hospital.com'
                      : 'doctor@hospital.com'
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="doc-init-pass" className="block text-xs font-medium text-slate-700">
                  Initial Login Password
                </label>
                <input
                  id="doc-init-pass"
                  type="text"
                  value={initialPassword}
                  onChange={(e) => setInitialPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>
          )}

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
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Register Doctor'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Inspect Doctor Shift Window & Open/Booked Slots Modal */}
      <Modal
        open={Boolean(inspectDoctor)}
        title={
          inspectDoctor
            ? `Dr. ${inspectDoctor.first_name} ${inspectDoctor.last_name} — Shift & Slots`
            : ''
        }
        subtitle={
          inspectDoctor
            ? `${deptMap.get(inspectDoctor.department_id) || 'OPD'}${inspectDoctor.specialization ? ` · ${inspectDoctor.specialization}` : ''}`
            : ''
        }
        onClose={() => setInspectDoctor(null)}
        maxWidth="xl"
      >
        {inspectDoctor && (() => {
          const docShift = shiftByDoctorId.get(inspectDoctor.doctor_id);
          const openCount = inspectDoctorSlots.filter(
            (s) => s.status === 'AVAILABLE' && s.booked_patients < s.max_patients_per_slot,
          ).length;
          const bookedCount = inspectDoctorSlots.filter(
            (s) => s.booked_patients > 0 || s.status === 'SOLD_OUT',
          ).length;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-medium text-slate-500">Registered Shift Window</p>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-slate-900">
                    {docShift
                      ? formatShiftSummary(docShift.sessions, docShift.slot_duration_mins)
                      : 'Not registered yet'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-500">Open Slots</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-700">
                    {openCount}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-500">Booked Slots</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-amber-800">
                    {bookedCount}
                  </p>
                </div>
              </div>

              {inspectDoctorSlots.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                  No open or booked slots found for this doctor yet.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Window</th>
                        <th className="px-3 py-2">Patient / Note</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inspectDoctorSlots.map((slot) => {
                        const isBooked = slot.booked_patients > 0 || slot.status === 'SOLD_OUT';
                        const appt = apptBySlotId.get(slot.slot_id);
                        return (
                          <tr key={slot.slot_id}>
                            <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">
                              {formatDisplayDate(slot.slot_date)}
                            </td>
                            <td className="px-3 py-2 font-mono font-medium text-slate-900 whitespace-nowrap">
                              {slot.start_time} – {slot.end_time}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {appt
                                ? `${appt.patient_name} (${appt.appointment_ref})`
                                : isBooked
                                  ? 'Booked'
                                  : 'Open for booking'}
                            </td>
                            <td className="px-3 py-2">
                              <StatusIndicator status={isBooked ? 'BOOKED' : slot.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title="Deactivate doctor profile?"
        description={
          deactivateTarget
            ? `Dr. ${deactivateTarget.first_name} ${deactivateTarget.last_name} will be marked inactive (IS_ACTIVE = 'N').`
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
