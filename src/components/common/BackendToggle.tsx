import React, { useEffect, useState } from 'react';
import {
  apiClient,
  getSelectedBackendMode,
  setSelectedBackendMode,
} from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { parseBackendMode, type BackendMode } from '../../utils/backendRouter';

interface BackendToggleProps {
  compact?: boolean;
  onChanged?: (mode: BackendMode) => void;
}

const MODES: BackendMode[] = ['HYBRID', 'OIC', 'ORDS'];

export function BackendToggle({
  compact = false,
  onChanged,
}: BackendToggleProps) {
  const { user } = useAuth();
  const { notify } = useToast();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const [mode, setMode] = useState<BackendMode>(() => getSelectedBackendMode());
  const [oicConfigured, setOicConfigured] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient
      .getBackendMode()
      .then((res) => {
        setOicConfigured(res.oic_configured);
        let stored: BackendMode | null = null;
        try {
          stored = parseBackendMode(window.localStorage.getItem('carepulse_opd_backend_mode'));
        } catch {
          stored = null;
        }
        const resolved = stored || res.mode;
        setMode(resolved);
        setSelectedBackendMode(resolved);
      })
      .catch(() => {
        // Keep current selection if mode endpoint is temporarily unreachable
      });
  }, [user?.user_id]);

  const describeMode = (active: BackendMode, configured: boolean): { text: string; tone: 'success' | 'info' } => {
    if (active === 'ORDS') {
      return {
        text: 'ORDS mode active: all reads and writes -> Oracle APEX (ORDS)',
        tone: 'success',
      };
    }
    if (!configured) {
      return {
        text: `${active} mode selected. Add OIC credentials in .env locally to execute writes via OIC (using ORDS fallback meanwhile).`,
        tone: 'info',
      };
    }
    return active === 'HYBRID'
      ? {
          text: 'HYBRID mode active: GET reads -> ORDS, writes -> OIC (OAuth 2.0)',
          tone: 'success',
        }
      : {
          text: 'OIC mode active: writes -> OIC (OAuth 2.0), GET reads -> ORDS',
          tone: 'success',
        };
  };

  const choose = async (next: BackendMode) => {
    if (next === mode || busy) return;
    const prevMode = mode;
    setMode(next);
    setSelectedBackendMode(next);

    if (!isAdmin) {
      const msg = describeMode(next, oicConfigured);
      notify(msg.text, msg.tone);
      onChanged?.(next);
      return;
    }

    setBusy(true);
    try {
      const res = await apiClient.setBackendMode({ mode: next });
      setOicConfigured(res.oic_configured);
      setMode(res.mode);
      setSelectedBackendMode(res.mode);
      const msg = describeMode(res.mode, res.oic_configured);
      notify(msg.text, msg.tone);
      onChanged?.(res.mode);
    } catch (err) {
      setMode(prevMode);
      setSelectedBackendMode(prevMode);
      notify(err instanceof Error ? err.message : 'Could not switch backend mode', 'error');
    } finally {
      setBusy(false);
    }
  };

  const base = compact
    ? 'px-2 py-1 text-[10px] sm:px-2.5 sm:text-[11px] font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50'
    : 'px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const on = 'bg-teal-700 text-white';
  const off = 'bg-white text-slate-700 hover:bg-slate-50';

  const getModeTitle = (target: BackendMode) => {
    if (!oicConfigured && target !== 'ORDS') {
      return `${target} mode: routes writes via OIC when .env OIC credentials are configured locally (safely falls back to ORDS until then)`;
    }
    if (target === 'HYBRID') {
      return 'HYBRID: GET requests route directly to ORDS; POST/PUT/PATCH/DELETE route to OIC';
    }
    if (target === 'OIC') {
      return 'OIC: Mutations route via OIC (OAuth 2.0 Client Credentials); fast reads stay on ORDS';
    }
    return 'ORDS: Route all GET and write operations directly to ORDS_BASE_URL';
  };

  if (compact) {
    return (
      <div
        className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white"
        role="group"
        aria-label="Backend routing mode"
      >
        {MODES.map((m, idx) => (
          <button
            key={m}
            type="button"
            disabled={busy}
            aria-pressed={mode === m}
            title={getModeTitle(m)}
            onClick={() => void choose(m)}
            className={`${base} ${idx > 0 ? 'border-l border-slate-200' : ''} ${
              mode === m ? on : off
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Routing Mode
      </span>
      <div
        className="inline-flex overflow-hidden rounded-lg border border-slate-300"
        role="group"
        aria-label="Application backend routing mode"
      >
        {MODES.map((m, idx) => (
          <button
            key={m}
            type="button"
            disabled={busy}
            aria-pressed={mode === m}
            title={getModeTitle(m)}
            onClick={() => void choose(m)}
            className={`${base} ${idx > 0 ? 'border-l border-slate-300' : ''} ${
              mode === m ? on : off
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}