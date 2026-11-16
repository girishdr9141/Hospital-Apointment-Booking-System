import React, { useCallback, useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import type { Department, Doctor, DoctorShiftConfig, Patient } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ROLE_LABELS } from '../../utils/permissions';
import { formatCurrencyInr, formatDisplayDate } from '../../utils/rules';
import { formatShiftSummary } from '../../utils/calendar';
import { RegionFields } from '../../components/common/RegionFields';
import { StatusIndicator } from '../../components/layout/StatusIndicator';
import { DoctorShiftModal } from '../../components/modals/DoctorShiftModal';

export function ProfilePage() {
  const { user } = useAuth();
  const { notify } = useToast();

  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctorShift, setDoctorShift] = useState<DoctorShiftConfig | null>(null);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);

  // Patient Edit State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [locality, setLocality] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (user.role === 'PATIENT') {
        const list = await apiClient.getPatients();
        const found =
          (user.patient_id ? list.find((p) => p.patient_id === user.patient_id) : undefined) ||
          list[0] ||
          null;
        setPatient(found);
        if (found) {
          setFirstName(found.first_name || '');
          setLastName(found.last_name || '');
          setPhoneNumber(found.phone_number || '');
          setEmail(found.email || '');
          setCity(found.city || '');
          setLocality(found.locality || '');
          setDob(found.date_of_birth ? found.date_of_birth.slice(0, 10) : '');
          setGender((found.gender as 'MALE' | 'FEMALE' | 'OTHER' | '') || '');
          setBloodGroup(found.blood_group || '');
        }
      } else if (user.role === 'DOCTOR') {
        const [docs, activeDepts, shiftsRes] = await Promise.all([
          apiClient.getDoctors(),
          apiClient.getDepartments(),
          apiClient.getDoctorShifts().catch(() => ({ shift: undefined })),
        ]);
        const depts = await apiClient.resolveDepartmentsForIds(
          docs.map((d) => d.department_id),
          activeDepts,
        );
        const found =
          (user.doctor_id ? docs.find((d) => d.doctor_id === user.doctor_id) : undefined) ||
          docs[0] ||
          null;
        setDoctor(found);
        setDepartments(depts);
        setDoctorShift(shiftsRes.shift || null);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load profile', 'error');
    } finally {
      setLoading(false);
    }
  }, [user, notify]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient) return;
    if (!firstName.trim() || !lastName.trim() || !phoneNumber.trim() || !city.trim() || !locality.trim()) {
      notify('First name, last name, phone number, city, and locality are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiClient.updatePatient(patient.patient_id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phoneNumber.trim(),
        email: email.trim(),
        city: city.trim(),
        locality: locality.trim(),
        date_of_birth: dob || undefined,
        gender: gender || undefined,
        blood_group: bloodGroup.trim() || undefined,
      });
      notify('Profile updated in Oracle GIRISH_PATIENTS', 'success');
      await loadProfile();
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        notify('PUT /patients/:id ORDS endpoint is unavailable.', 'error');
      } else {
        notify(err instanceof Error ? err.message : 'Unable to update profile', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

  if (user.role === 'PATIENT') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">My Patient Profile</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Personal demographics stored in Oracle GIRISH_PATIENTS.
          </p>
        </div>

        {!patient ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            No linked patient record found for your account ({user.email}).
          </div>
        ) : (
          <form
            onSubmit={handleSavePatient}
            className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {patient.first_name} {patient.last_name}
                </h3>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  Patient ID #{patient.patient_id} · Signed in as {user.email}
                </p>
              </div>
              <StatusIndicator status="ACTIVE" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="prof-first" className="block text-sm font-medium text-slate-700">
                  First name *
                </label>
                <input
                  id="prof-first"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="prof-last" className="block text-sm font-medium text-slate-700">
                  Last name *
                </label>
                <input
                  id="prof-last"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="prof-phone" className="block text-sm font-medium text-slate-700">
                  Phone number *
                </label>
                <input
                  id="prof-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="prof-email" className="block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="prof-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <RegionFields
              idPrefix="prof"
              city={city}
              locality={locality}
              onCityChange={setCity}
              onLocalityChange={setLocality}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="prof-dob" className="block text-sm font-medium text-slate-700">
                  Date of birth
                </label>
                <input
                  id="prof-dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="prof-gender" className="block text-sm font-medium text-slate-700">
                  Gender
                </label>
                <select
                  id="prof-gender"
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
                <label htmlFor="prof-blood" className="block text-sm font-medium text-slate-700">
                  Blood group
                </label>
                <input
                  id="prof-blood"
                  type="text"
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value)}
                  placeholder="O+"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <span className="text-xs text-slate-500">
                Recorded DOB: {formatDisplayDate(patient.date_of_birth)}
              </span>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (user.role === 'DOCTOR' && doctor) {
    const deptName =
      departments.find((d) => d.department_id === doctor.department_id)?.department_name ||
      user.department_name ||
      `Department #${doctor.department_id}`;

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Doctor Clinical Profile</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Practitioner record and recurring OPD consultation schedule from Oracle.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Dr. {doctor.first_name} {doctor.last_name}
              </h3>
              <p className="text-sm text-slate-600">
                {deptName}
                {doctor.specialization ? ` · ${doctor.specialization}` : ''}
              </p>
            </div>
            <StatusIndicator status={doctor.is_active === 'N' ? 'INACTIVE' : 'ACTIVE'} />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Doctor ID</p>
              <p className="mt-0.5 font-mono text-sm font-medium text-slate-900 tabular-nums">
                #{doctor.doctor_id}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Consultation Fee</p>
              <p className="mt-0.5 font-mono text-sm font-medium text-slate-900 tabular-nums">
                {formatCurrencyInr(doctor.consultation_fee)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tele-Consultation</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">
                {doctor.tele_consult_flag === 'Y' ? 'Enabled' : 'In-person only'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Employment</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">
                {doctor.employment_type === 'PART_TIME' ? 'Part-time' : 'Full-time'}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Clock className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span>Registered OPD Shift Window</span>
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Your shift window defines daily working hours. Any shift update requires administrator approval.
              </p>
            </div>
            <button
              type="button"
              disabled={Boolean(doctorShift?.pending_change_request)}
              onClick={() => setShiftModalOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {doctorShift?.pending_change_request
                ? 'Shift Change Pending Approval'
                : doctorShift?.is_registered
                  ? 'Request Shift Change'
                  : 'Register Shift Window'}
            </button>
          </div>

          {doctorShift ? (
            <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Shift Sessions &amp; Slot Length</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
                  {formatShiftSummary(doctorShift.sessions, doctorShift.slot_duration_mins)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Working Days</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {doctorShift.working_days.map((d) => d.slice(0, 3)).join(', ')}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Registration Status</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {doctorShift.is_registered ? 'Confirmed' : 'Pending first-login registration'}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Unable to load shift configuration.</p>
          )}
        </div>

        <DoctorShiftModal
          open={shiftModalOpen}
          mode={doctorShift?.is_registered ? 'change' : 'register'}
          doctorName={`Dr. ${doctor.first_name} ${doctor.last_name}`}
          shift={doctorShift}
          onClose={() => setShiftModalOpen(false)}
          onCompleted={loadProfile}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{user.full_name}</h2>
          <p className="text-sm text-slate-500">
            {ROLE_LABELS[user.role]} · {user.email}
          </p>
        </div>
        <StatusIndicator status="ACTIVE" />
      </div>
      <div className="text-xs text-slate-600">
        Username: <span className="font-mono text-slate-900">{user.username}</span>
      </div>
    </div>
  );
}
