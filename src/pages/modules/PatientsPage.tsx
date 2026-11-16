import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, UserPlus } from 'lucide-react';
import type { Appointment, Patient } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatDisplayDate } from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { StatusIndicator } from '../../components/layout/StatusIndicator';

interface PatientsPageProps {
  mode?: 'directory' | 'register';
  onRegistered?: () => void;
}

export function PatientsPage({ mode = 'directory', onRegistered }: PatientsPageProps) {
  const { user, hasPermission } = useAuth();
  const { notify } = useToast();
  const isDoctor = user?.role === 'DOCTOR';
  const canManage = hasPermission('MANAGE_PATIENTS') && user?.role !== 'ADMIN';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState('ALL');

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [createOpen, setCreateOpen] = useState(mode === 'register');

  // Registration / Edit form state
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === 'register') {
      setEditingPatient(null);
      setCreateOpen(true);
    }
  }, [mode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [patList, apptList] = await Promise.all([
        apiClient.getPatients(),
        apiClient.getAppointments(),
      ]);
      setPatients(patList);
      setAppointments(apptList);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load patients', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = (pat?: Patient | null) => {
    setEditingPatient(pat || null);
    setFirstName(pat?.first_name || '');
    setLastName(pat?.last_name || '');
    setPhoneNumber(pat?.phone_number || '');
    setEmail(pat?.email || '');
    setDob(pat?.date_of_birth ? pat.date_of_birth.slice(0, 10) : '');
    setGender((pat?.gender as 'MALE' | 'FEMALE' | 'OTHER' | '') || '');
    setBloodGroup(pat?.blood_group || '');
  };

  const openCreate = () => {
    resetForm(null);
    setCreateOpen(true);
  };

  const openEdit = (pat: Patient) => {
    resetForm(pat);
    setCreateOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phoneNumber.trim()) {
      notify('First name, last name, and phone number are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phoneNumber.trim(),
        email: email.trim(),
        date_of_birth: dob || undefined,
        gender: gender || undefined,
        blood_group: bloodGroup.trim() || undefined,
      };
      if (editingPatient) {
        await apiClient.updatePatient(editingPatient.patient_id, payload);
        notify('Patient record updated', 'success');
      } else {
        await apiClient.createPatient(payload);
        notify('Patient registered in Oracle database', 'success');
      }
      setCreateOpen(false);
      resetForm(null);
      await loadData();
      if (mode === 'register') onRegistered?.();
    } catch (err) {
      if (isEndpointNotDeployedError(err) && editingPatient) {
        notify('PUT /patients/:id ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to save patient', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return patients.filter((p) => {
      if (genderFilter !== 'ALL' && (p.gender || '') !== genderFilter) return false;
      if (!q) return true;
      const full = `${p.first_name} ${p.last_name}`.toLowerCase();
      return (
        full.includes(q) ||
        p.phone_number.toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
      );
    });
  }, [patients, genderFilter, search]);

  const selectedAppointments = useMemo(() => {
    if (!selectedPatient) return [];
    return appointments.filter((a) => a.patient_id === selectedPatient.patient_id);
  }, [appointments, selectedPatient]);

  const columns: DataColumn<Patient>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">#{row.patient_id}</span>
      ),
    },
    {
      key: 'name',
      header: 'Patient Name',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">
            {row.first_name} {row.last_name}
          </p>
          <p className="text-xs text-slate-500">{row.email || 'No email on file'}</p>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700 tabular-nums">{row.phone_number}</span>
      ),
    },
    {
      key: 'demographics',
      header: 'Gender / Blood',
      render: (row) => (
        <span className="text-xs text-slate-600">
          {row.gender || '—'} · {row.blood_group || '—'}
        </span>
      ),
    },
    {
      key: 'dob',
      header: 'DOB',
      render: (row) => (
        <span className="font-mono text-xs text-slate-600 tabular-nums">
          {formatDisplayDate(row.date_of_birth)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedPatient(row)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Profile</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => openEdit(row)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit
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
            {mode === 'register'
              ? 'Front-Desk Patient Registration'
              : isDoctor
                ? 'My Booked Patients'
                : 'Patient Directory'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {isDoctor
              ? 'Showing only patients who have booked an appointment with you.'
              : user?.role === 'ADMIN'
                ? 'System-wide read-only directory of registered patients in GIRISH_PATIENTS.'
                : 'Search outpatient records, inspect appointment histories, and register patients in GIRISH_PATIENTS.'}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            <span>Register Patient</span>
          </button>
        )}
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.patient_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, phone, or email..."
        filters={
          <select
            aria-label="Filter by gender"
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
          >
            <option value="ALL">All Genders</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        }
        emptyTitle={isDoctor ? 'No booked patients yet' : 'No patient records found'}
        emptyDescription={
          isDoctor
            ? 'Patients will appear here automatically once they book an appointment with you.'
            : canManage
              ? 'Register a new patient or clear active search filters.'
              : 'Clear active search filters to view patient records.'
        }
      />

      {/* Patient Profile + History Modal */}
      <Modal
        open={Boolean(selectedPatient)}
        title={
          selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : ''
        }
        subtitle={selectedPatient ? `Patient ID #${selectedPatient.patient_id}` : undefined}
        onClose={() => setSelectedPatient(null)}
        maxWidth="xl"
      >
        {selectedPatient && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Phone</p>
                <p className="mt-0.5 font-mono text-xs font-medium text-slate-900">
                  {selectedPatient.phone_number}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Gender</p>
                <p className="mt-0.5 font-medium text-slate-900">{selectedPatient.gender || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Blood Group</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {selectedPatient.blood_group || '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Date of Birth</p>
                <p className="mt-0.5 font-mono text-xs text-slate-900">
                  {formatDisplayDate(selectedPatient.date_of_birth)}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900">Appointment History</h3>
              {selectedAppointments.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No appointments recorded for this patient.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Ref</th>
                        <th className="px-3 py-2">Slot</th>
                        <th className="px-3 py-2">Created</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedAppointments.map((a) => (
                        <tr key={a.appointment_id}>
                          <td className="px-3 py-2 font-mono">{a.appointment_ref}</td>
                          <td className="px-3 py-2 font-mono">Slot #{a.slot_id}</td>
                          <td className="px-3 py-2 font-mono">{formatDisplayDate(a.created_on)}</td>
                          <td className="px-3 py-2">
                            <StatusIndicator status={a.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Register / Edit Patient Modal */}
      <Modal
        open={createOpen}
        title={editingPatient ? 'Edit Patient Profile' : 'Register New Patient'}
        subtitle="Persists directly to Oracle GIRISH_PATIENTS."
        onClose={() => setCreateOpen(false)}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pat-first" className="block text-sm font-medium text-slate-700">
                First name *
              </label>
              <input
                id="pat-first"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="pat-last" className="block text-sm font-medium text-slate-700">
                Last name *
              </label>
              <input
                id="pat-last"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pat-phone" className="block text-sm font-medium text-slate-700">
                Phone number *
              </label>
              <input
                id="pat-phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="pat-email" className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="pat-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="pat-dob" className="block text-sm font-medium text-slate-700">
                Date of birth
              </label>
              <input
                id="pat-dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="pat-gender" className="block text-sm font-medium text-slate-700">
                Gender
              </label>
              <select
                id="pat-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as 'MALE' | 'FEMALE' | 'OTHER' | '')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="">Select</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="pat-blood" className="block text-sm font-medium text-slate-700">
                Blood group
              </label>
              <input
                id="pat-blood"
                type="text"
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                placeholder="O+"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {saving ? 'Saving...' : editingPatient ? 'Update Patient' : 'Register Patient'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
