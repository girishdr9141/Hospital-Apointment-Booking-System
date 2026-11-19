import React, { useEffect, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';

type Mode = 'ords' | 'oic';

interface BackendToggleProps {
  onChanged?: (mode: Mode) => void;
}

export function BackendToggle({ onChanged }: BackendToggleProps) {
  const { notify } = useToast();
  const [mode, setMode] = useState<Mode>('ords');
  const [oicConfigured, setOicConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient
      .getBackendMode()
      .then((res) => {
        setMode(res.mode);
        setOicConfigured(res.oic_configured);
      })
      .catch(() => {
        // Toggle stays on ORDS if the mode endpoint is unreachable
      });
  }, []);

  const choose = async (next: Mode) => {
    if (next === mode || busy) return;
    setBusy(true);
    try {
      const res = await apiClient.setBackendMode(next);
      setMode(res.mode);
      notify(
        res.mode === 'oic'
          ? 'Switched to Oracle Integration Cloud (OIC)'
          : 'Switched to Oracle APEX (ORDS)',
        'success',
      );
      onChanged?.(res.mode);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not switch backend', 'error');
    } finally {
      setBusy(false);
    }
  };

  const base = 'px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50';
  const on = 'bg-teal-700 text-white';
  const off = 'bg-white text-slate-600 hover:bg-slate-50';

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Data source</span>
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
        <button
          type="button"
          disabled={busy}
          onClick={() => choose('ords')}
          className={`${base} ${mode === 'ords' ? on : off}`}
        >
          ORDS (APEX)
        </button>
        <button
          type="button"
          disabled={busy || !oicConfigured}
          onClick={() => choose('oic')}
          className={`${base} border-l border-slate-300 ${mode === 'oic' ? on : off}`}
        >
          OIC
        </button>
      </div>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
        Active: {mode === 'oic' ? 'OIC' : 'ORDS'}
      </span>
    </div>
  );
}