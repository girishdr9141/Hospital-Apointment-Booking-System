import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Search,
  ShieldCheck,
  Stethoscope,
  User,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiClient, type DirectoryAccountEntry } from '../../services/apiClient';
import { getRolePortalConfig } from '../../utils/permissions';
import type { RoleName } from '../../types/opd';

interface LoginPageProps {
  selectedRole: RoleName;
  onChangeRole: () => void;
  onSwitchToRegister?: () => void;
  onSwitchToForgotPassword?: () => void;
  initialEmail?: string;
  bannerMessage?: string | null;
}

const DEFAULT_PASS_BY_ROLE: Record<RoleName, string> = {
  ADMIN: 'Admin@123',
  DOCTOR: 'Doctor@123',
  PATIENT: 'Patient@123',
  RECEPTIONIST: 'Reception@123',
};

const ROLE_ICON: Record<RoleName, typeof ShieldCheck> = {
  ADMIN: ShieldCheck,
  DOCTOR: Stethoscope,
  RECEPTIONIST: ClipboardCheck,
  PATIENT: UserRound,
};

const DIRECTORY_TITLE: Record<RoleName, string> = {
  ADMIN: 'System Administrator Account',
  DOCTOR: 'Registered Doctors',
  RECEPTIONIST: 'Registered Receptionists',
  PATIENT: 'Registered Patients',
};

const NAME_PLACEHOLDER: Record<RoleName, string> = {
  ADMIN: 'Girish DR',
  DOCTOR: 'e.g. Dr. Priya Sharma',
  RECEPTIONIST: 'e.g. Meera Kulkarni',
  PATIENT: 'e.g. John Doe or Sneha Reddy',
};

const EMAIL_PLACEHOLDER: Record<RoleName, string> = {
  ADMIN: 'girishramachandra12dr@gmail.com',
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

  const [directory, setDirectory] = useState<DirectoryAccountEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(true);
  const [dirSearch, setDirSearch] = useState('');

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    let mounted = true;
    setDirLoading(true);
    apiClient
      .getLoginDirectory(selectedRole)
      .then((accounts) => {
        if (mounted) setDirectory(accounts.filter((a) => a.role === selectedRole));
      })
      .catch(() => {
        if (mounted) setDirectory([]);
      })
      .finally(() => {
        if (mounted) setDirLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedRole]);

  const filteredDirectory = useMemo(() => {
    const q = dirSearch.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter(
      (entry) =>
        entry.full_name.toLowerCase().includes(q) ||
        entry.email.toLowerCase().includes(q) ||
        (entry.detail || '').toLowerCase().includes(q),
    );
  }, [directory, dirSearch]);

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

  const applyAccountEntry = (entry: DirectoryAccountEntry) => {
    setFullName(entry.full_name);
    setEmail(entry.email);
    setPassword(bannerMessage ? '' : DEFAULT_PASS_BY_ROLE[entry.role]);
    setErrorMsg(null);
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
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

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Role-Scoped Sign In Form */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-7 lg:col-span-6">
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
                New patient?{' '}
                <button
                  type="button"
                  onClick={onSwitchToRegister}
                  className="font-medium text-teal-700 hover:underline"
                >
                  Register
                </button>
              </div>
            )}
          </div>

          {/* Right: Role-Scoped Registered Accounts */}
          <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 sm:p-7 lg:col-span-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {DIRECTORY_TITLE[selectedRole]}
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Tap a registered {portal.title.toLowerCase()} below to fill their exact Name and Email ID from Oracle.
              </p>
            </div>

            {selectedRole !== 'ADMIN' && (
              <div className="relative mt-4">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  aria-label={`Search registered ${portal.title.toLowerCase()} accounts`}
                  value={dirSearch}
                  onChange={(e) => setDirSearch(e.target.value)}
                  placeholder="Search name or email..."
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                />
              </div>
            )}

            <div className="mt-3 max-h-[360px] flex-1 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {dirLoading ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Loading registered {portal.title.toLowerCase()} accounts from Oracle...
                </div>
              ) : filteredDirectory.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  {directory.length === 0
                    ? `No registered ${portal.title.toLowerCase()} accounts found.`
                    : 'No matching accounts found.'}
                </div>
              ) : (
                filteredDirectory.map((entry) => (
                  <button
                    key={`${entry.role}-${entry.email}`}
                    type="button"
                    onClick={() => applyAccountEntry(entry)}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-teal-50/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {entry.full_name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-teal-800">{entry.email}</p>
                      {entry.detail && (
                        <p className="truncate text-[11px] text-slate-500">{entry.detail}</p>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-[10px] font-medium text-slate-500">
                      {entry.role}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
