import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Crown,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Stethoscope,
  User,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { getRolePortalConfig } from '../../utils/permissions';
import { apiClient } from '../../services/apiClient';
import type { RoleName } from '../../types/opd';

interface LoginPageProps {
  selectedRole: RoleName;
  onChangeRole: () => void;
  onSwitchToRegister?: () => void;
  onSwitchToForgotPassword?: () => void;
  initialEmail?: string;
  bannerMessage?: string | null;
}

const ROLE_ICON: Record<RoleName, typeof ShieldCheck> = {
  SUPER_ADMIN: Crown,
  ADMIN: ShieldCheck,
  DOCTOR: Stethoscope,
  RECEPTIONIST: ClipboardCheck,
  PATIENT: UserRound,
};

const NAME_PLACEHOLDER: Record<RoleName, string> = {
  SUPER_ADMIN: 'Enter super administrator full name',
  ADMIN: 'Enter administrator full name',
  DOCTOR: 'Enter doctor full name',
  RECEPTIONIST: 'Enter receptionist full name',
  PATIENT: 'Enter your full name',
};

const EMAIL_PLACEHOLDER: Record<RoleName, string> = {
  SUPER_ADMIN: 'superadmin@hospital.com',
  ADMIN: 'admin@hospital.com',
  DOCTOR: 'doctor@hospital.com',
  RECEPTIONIST: 'receptionist@hospital.com',
  PATIENT: 'patient@example.com',
};

export function LoginPage({
  selectedRole,
  onChangeRole,
  onSwitchToRegister,
  onSwitchToForgotPassword,
  initialEmail = '',
  bannerMessage = null,
}: LoginPageProps) {
  const { login } = useAuth();
  const { notify } = useToast();
  const portal = getRolePortalConfig(selectedRole);
  const RoleIcon = ROLE_ICON[selectedRole];

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [allowPatientReg, setAllowPatientReg] = useState(true);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    apiClient
      .getSecurityPolicy()
      .then((res) => setAllowPatientReg(res.allow_patient_registration))
      .catch(() => null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!fullName.trim() || !email.trim() || !password) {
      setErrorMsg('Please enter your full name, email ID, and password.');
      return;
    }

    setSubmitting(true);
    try {
      const user = await login({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        expected_role: selectedRole,
      });
      notify(`Signed in as ${user.full_name}`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in';
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white">
              <Stethoscope className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">CarePulse OPD</h1>
              <p className="text-xs text-slate-500">{portal.portalTitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onChangeRole}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Change role</span>
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-7">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <RoleIcon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">{portal.title} Login</h2>
              <p className="text-xs text-slate-500">{portal.description}</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
            {portal.policyNote}
          </div>

          {bannerMessage && (
            <div
              role="status"
              className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>{bannerMessage}</span>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div>
              <label htmlFor="login-fullname" className="block text-sm font-medium text-slate-700">
                Full Name
              </label>
              <div className="relative mt-1.5">
                <User
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="login-fullname"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={NAME_PLACEHOLDER[selectedRole]}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
                Email ID
              </label>
              <div className="relative mt-1.5">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={EMAIL_PLACEHOLDER[selectedRole]}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
                  Password
                </label>
                {portal.allowForgotPassword && onSwitchToForgotPassword && (
                  <button
                    type="button"
                    onClick={onSwitchToForgotPassword}
                    className="text-xs font-medium text-teal-700 hover:underline"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div className="relative mt-1.5">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? 'Signing in...' : `Sign in as ${portal.title}`}
            </button>
          </form>

          {portal.allowRegistration && onSwitchToRegister && (
            <div className="mt-5 border-t border-slate-200 pt-4 text-center text-sm text-slate-600">
              {allowPatientReg ? (
                <>
                  New patient?{' '}
                  <button
                    type="button"
                    onClick={onSwitchToRegister}
                    className="font-medium text-teal-700 hover:underline"
                  >
                    Register
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-500">
                  Self-registration is temporarily disabled by Security Settings. Contact reception.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
