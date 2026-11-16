import React, { useCallback, useEffect, useState } from 'react';
import { Lock, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import type { SecuritySettings } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_SECURITY_SETTINGS } from '../../utils/rbac';

export function SecuritySettingsPage() {
  const { user, hasModulePermission } = useAuth();
  const { notify } = useToast();

  const canUpdate =
    user?.role === 'SUPER_ADMIN' || hasModulePermission('SYSTEM_SETTINGS', 'UPDATE');

  const [settings, setSettings] = useState<SecuritySettings>(DEFAULT_SECURITY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getSecuritySettings();
      setSettings(res.settings);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load security settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUpdate) return;
    setSaving(true);
    try {
      const res = await apiClient.updateSecuritySettings(settings);
      setSettings(res.settings);
      notify(res.message || 'Security policy saved', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save security settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Security Settings &amp; Policies</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Configure authentication lockout thresholds, password complexity, session lifetimes, and portal registration controls.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSettings()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {!canUpdate && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <span>
            Read-only view. <span className="font-mono">SYSTEM_SETTINGS:UPDATE</span> permission is required to modify security policies.
          </span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="sec-max-fail" className="block text-sm font-medium text-slate-700">
              Max Failed Login Attempts (2–20)
            </label>
            <input
              id="sec-max-fail"
              type="number"
              min={2}
              max={20}
              disabled={!canUpdate || loading}
              value={settings.max_failed_login_attempts}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  max_failed_login_attempts: Number(e.target.value || 5),
                }))
              }
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
            />
            <p className="mt-1 text-xs text-slate-500">
              Account signs in are temporarily locked after exceeding this threshold.
            </p>
          </div>

          <div>
            <label htmlFor="sec-lockout" className="block text-sm font-medium text-slate-700">
              Lockout Duration (Minutes, 1–120)
            </label>
            <input
              id="sec-lockout"
              type="number"
              min={1}
              max={120}
              disabled={!canUpdate || loading}
              value={settings.lockout_minutes}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  lockout_minutes: Number(e.target.value || 15),
                }))
              }
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
            />
            <p className="mt-1 text-xs text-slate-500">
              Cooldown duration before locked credentials can attempt sign-in again.
            </p>
          </div>

          <div>
            <label htmlFor="sec-min-pw" className="block text-sm font-medium text-slate-700">
              Minimum Password Length (6–32)
            </label>
            <input
              id="sec-min-pw"
              type="number"
              min={6}
              max={32}
              disabled={!canUpdate || loading}
              value={settings.min_password_length}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  min_password_length: Number(e.target.value || 6),
                }))
              }
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
            />
            <p className="mt-1 text-xs text-slate-500">
              Enforced on patient self-registration, staff provisioning, and password resets.
            </p>
          </div>

          <div>
            <label htmlFor="sec-ttl" className="block text-sm font-medium text-slate-700">
              Session Token Lifetime (Hours, 1–168)
            </label>
            <input
              id="sec-ttl"
              type="number"
              min={1}
              max={168}
              disabled={!canUpdate || loading}
              value={settings.session_ttl_hours}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  session_ttl_hours: Number(e.target.value || 12),
                }))
              }
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
            />
            <p className="mt-1 text-xs text-slate-500">
              Signed session token expiry duration for all hospital portals.
            </p>
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-5">
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3.5 cursor-pointer hover:bg-slate-50/70">
            <input
              type="checkbox"
              disabled={!canUpdate || loading}
              checked={settings.allow_patient_registration}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  allow_patient_registration: e.target.checked,
                }))
              }
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
            />
            <div>
              <p className="text-sm font-medium text-slate-900">
                Allow Public Patient Self-Registration
              </p>
              <p className="text-xs text-slate-500">
                When disabled, patients cannot create new self-service accounts from the Patient Portal; only Receptionists/Admins can register patients.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3.5 cursor-pointer hover:bg-slate-50/70">
            <input
              type="checkbox"
              disabled={!canUpdate || loading}
              checked={settings.enforce_strict_role_portal}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  enforce_strict_role_portal: e.target.checked,
                }))
              }
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
            />
            <div>
              <p className="text-sm font-medium text-slate-900">
                Enforce Strict Role-Isolated Login Portals
              </p>
              <p className="text-xs text-slate-500">
                Requires each user to authenticate exclusively through their matching role card (Super Admin, Admin, Doctor, Receptionist, or Patient).
              </p>
            </div>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <span>Every security policy update is recorded in the immutable RBAC Audit Trail.</span>
          </div>
          {canUpdate && (
            <button
              type="submit"
              disabled={saving || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>{saving ? 'Saving Policy...' : 'Save Security Settings'}</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
