import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldAlert, Stethoscope } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { RegionFields } from '../../components/common/RegionFields';
import { apiClient } from '../../services/apiClient';

interface RegisterPatientPageProps {
  onSwitchToLogin: () => void;
  onChangeRole?: () => void;
}

export function RegisterPatientPage({
  onSwitchToLogin,
  onChangeRole,
}: RegisterPatientPageProps) {
  const { registerPatient } = useAuth();
  const { notify } = useToast();

  const [allowRegistration, setAllowRegistration] = useState(true);
  const [minPasswordLen, setMinPasswordLen] = useState(6);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [locality, setLocality] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getSecurityPolicy()
      .then((res) => {
        setAllowRegistration(res.allow_patient_registration);
        setMinPasswordLen(Math.max(6, Number(res.min_password_length || 6)));
      })
      .catch(() => null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !phoneNumber.trim() ||
      !email.trim() ||
      !city.trim() ||
      !locality.trim() ||
      !password
    ) {
      setErrorMsg(
        'First name, last name, phone number, email, city, locality, and password are required.',
      );
      return;
    }

    if (password.length < minPasswordLen) {
      setErrorMsg(`Password must be at least ${minPasswordLen} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      const user = await registerPatient({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phoneNumber.trim(),
        email: email.trim(),
        city: city.trim(),
        locality: locality.trim(),
        date_of_birth: dateOfBirth || undefined,
        gender: gender || undefined,
        blood_group: bloodGroup.trim() || undefined,
        password,
      });
      notify(`Welcome, ${user.full_name}. Your patient record is registered.`, 'success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to register patient');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col justify-center bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white">
              <Stethoscope className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">CarePulse OPD</h1>
              <p className="text-xs text-slate-500">Patient Portal · Self-Registration</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {onChangeRole && (
              <button
                type="button"
                onClick={onChangeRole}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Change role
              </button>
            )}
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Patient Login</span>
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          {!allowRegistration ? (
            <div className="py-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                <ShieldAlert className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="mt-3 text-lg font-semibold text-slate-900">
                Patient Self-Registration Disabled
              </h2>
              <p className="mt-1.5 text-sm text-slate-600">
                The hospital Super Admin has disabled public patient self-registration in Security
                Settings. Please contact front-desk reception to create your patient profile.
              </p>
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="mt-5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                Return to Login
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-slate-900">Register as a new patient</h2>
              <p className="mt-1 text-sm text-slate-600">
                Creates your outpatient record directly in the hospital Oracle database.
              </p>

              {errorMsg && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
                >
                  {errorMsg}
                </div>
              )}

              <form
                onSubmit={handleSubmit}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                className="mt-6 space-y-4"
                noValidate
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-first-name"
                      className="block text-sm font-medium text-slate-700"
                    >
                      First name *
                    </label>
                    <input
                      id="reg-first-name"
                      name="carepulse_reg_first_name"
                      type="text"
                      autoComplete="off"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-last-name"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Last name *
                    </label>
                    <input
                      id="reg-last-name"
                      name="carepulse_reg_last_name"
                      type="text"
                      autoComplete="off"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="reg-phone" className="block text-sm font-medium text-slate-700">
                      Phone number *
                    </label>
                    <input
                      id="reg-phone"
                      name="carepulse_reg_phone"
                      type="tel"
                      autoComplete="off"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="9876543211"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700">
                      Email address *
                    </label>
                    <input
                      id="reg-email"
                      name="carepulse_reg_email"
                      type="email"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="patient@example.com"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                </div>

                <RegionFields
                  idPrefix="reg"
                  city={city}
                  locality={locality}
                  onCityChange={setCity}
                  onLocalityChange={setLocality}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="reg-dob" className="block text-sm font-medium text-slate-700">
                      Date of birth
                    </label>
                    <input
                      id="reg-dob"
                      name="carepulse_reg_dob"
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-gender" className="block text-sm font-medium text-slate-700">
                      Gender
                    </label>
                    <select
                      id="reg-gender"
                      name="carepulse_reg_gender"
                      value={gender}
                      onChange={(e) =>
                        setGender(e.target.value as 'MALE' | 'FEMALE' | 'OTHER' | '')
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    >
                      <option value="">Select</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="reg-blood" className="block text-sm font-medium text-slate-700">
                      Blood group
                    </label>
                    <input
                      id="reg-blood"
                      name="carepulse_reg_blood"
                      type="text"
                      autoComplete="off"
                      value={bloodGroup}
                      onChange={(e) => setBloodGroup(e.target.value)}
                      placeholder="O+"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-password"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Create password *
                  </label>
                  <input
                    id="reg-password"
                    name="carepulse_reg_password"
                    type="password"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={`At least ${minPasswordLen} characters`}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
                >
                  {submitting ? 'Registering patient...' : 'Register and continue'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
