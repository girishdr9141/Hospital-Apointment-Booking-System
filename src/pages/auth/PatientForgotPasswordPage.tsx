import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, Phone, Stethoscope } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';

interface PatientForgotPasswordPageProps {
  onBackToLogin: () => void;
  onResetSuccess: (email: string, message: string) => void;
}

export function PatientForgotPasswordPage({
  onBackToLogin,
  onResetSuccess,
}: PatientForgotPasswordPageProps) {
  const { notify } = useToast();

  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !phoneNumber.trim() || !newPassword || !confirmPassword) {
      setErrorMsg('Please enter your registered email ID, phone number, and new password.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation password do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.patientForgotPassword({
        email: email.trim(),
        phone_number: phoneNumber.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      notify(res.message || 'Password updated successfully.', 'success');
      onResetSuccess(
        email.trim().toLowerCase(),
        res.message || 'Password updated successfully. Sign in with your new password.',
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col justify-center bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white">
              <Stethoscope className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">CarePulse OPD</h1>
              <p className="text-xs text-slate-500">Patient Portal · Password Recovery</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onBackToLogin}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Login</span>
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-7">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-teal-700" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-slate-900">Reset Patient Password</h2>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Verify your registered email ID and phone number from your hospital patient record to set a new password.
          </p>

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
              <label htmlFor="forgot-email" className="block text-sm font-medium text-slate-700">
                Registered Email ID
              </label>
              <div className="relative mt-1.5">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="patient@example.com"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="forgot-phone" className="block text-sm font-medium text-slate-700">
                Registered Phone Number
              </label>
              <div className="relative mt-1.5">
                <Phone
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="forgot-phone"
                  type="tel"
                  autoComplete="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="10-digit registered mobile number"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="forgot-new-pw" className="block text-sm font-medium text-slate-700">
                New Password
              </label>
              <div className="relative mt-1.5">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="forgot-new-pw"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
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

            <div>
              <label htmlFor="forgot-confirm-pw" className="block text-sm font-medium text-slate-700">
                Confirm New Password
              </label>
              <div className="relative mt-1.5">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="forgot-confirm-pw"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? 'Updating password...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
