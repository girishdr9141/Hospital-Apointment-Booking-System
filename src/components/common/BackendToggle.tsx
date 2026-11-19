import React, { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { ALL_OIC_PHASES, type BackendMode, type OicPhaseId } from '../../utils/backendRouter';
import { OicBlueprintModal } from '../modals/OicBlueprintModal';

interface BackendToggleProps {
  compact?: boolean;
  onChanged?: (mode: BackendMode) => void;
}

export function BackendToggle({ compact = false, onChanged }: BackendToggleProps) {
  const { notify } = useToast();
  const [mode, setMode] = useState<BackendMode>('ords');
  const [oicConfigured, setOicConfigured] = useState(false);
  const [oicHostPreview, setOicHostPreview] = useState<string | null>(null);
  const [enabledPhases, setEnabledPhases] = useState<OicPhaseId[]>(ALL_OIC_PHASES);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    apiClient
      .getBackendMode()
      .then((res) => {
        setMode(res.mode);
        setOicConfigured(res.oic_configured);
        setOicHostPreview(res.oic_host_preview ?? null);
        if (Array.isArray(res.oic_phases) && res.oic_phases.length > 0) {
          setEnabledPhases(res.oic_phases);
        }
      })
      .catch(() => {
        // Toggle stays on ORDS if the mode endpoint is unreachable
      });
  }, []);

  const choose = async (next: BackendMode) => {
    if (next === mode || busy) return;
    setBusy(true);
    try {
      const res = await apiClient.setBackendMode({ mode: next });
      setMode(res.mode);
      setEnabledPhases(res.oic_phases);
      const scopeLabel =
        res.oic_phases.length === ALL_OIC_PHASES.length
          ? 'entire application'
          : `${res.oic_phases.length}/5 OIC phases`;
      notify(
        res.mode === 'oic'
          ? `Switched ${scopeLabel} to Oracle Integration Cloud (OIC)`
          : 'Switched entire application to Oracle APEX (ORDS)',
        'success',
      );
      onChanged?.(res.mode);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not switch backend', 'error');
    } finally {
      setBusy(false);
    }
  };

  const base = compact
    ? 'px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
    : 'px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const on = 'bg-teal-700 text-white';
  const off = 'bg-white text-slate-700 hover:bg-slate-50';

  const oicTitle = oicConfigured
    ? `Route ${enabledPhases.length}/5 phases through Oracle Integration Cloud (OIC)`
    : 'Set OIC_BASE_URL, OIC_USERNAME, and OIC_PASSWORD in .env to enable OIC';

  return (
    <>
      {compact ? (
        <div className="flex items-center gap-1.5">
          <div
            className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white"
            role="group"
            aria-label="Global backend data source"
          >
            <button
              type="button"
              disabled={busy}
              aria-pressed={mode === 'ords'}
              onClick={() => void choose('ords')}
              className={`${base} ${mode === 'ords' ? on : off}`}
            >
              ORDS
            </button>
            <button
              type="button"
              disabled={busy || !oicConfigured}
              aria-pressed={mode === 'oic'}
              title={oicTitle}
              onClick={() => void choose('oic')}
              className={`${base} border-l border-slate-200 ${mode === 'oic' ? on : off}`}
            >
              OIC
            </button>
          </div>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            aria-label="OIC phase rollout guide and endpoint tester"
            title="OIC 5-Phase Integration Guide & Endpoint Tester"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Layers className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span className="hidden xl:inline">OIC Phases</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Data source
            </span>
            <div
              className="inline-flex overflow-hidden rounded-lg border border-slate-300"
              role="group"
              aria-label="Application backend data source"
            >
              <button
                type="button"
                disabled={busy}
                aria-pressed={mode === 'ords'}
                onClick={() => void choose('ords')}
                className={`${base} ${mode === 'ords' ? on : off}`}
              >
                ORDS (APEX)
              </button>
              <button
                type="button"
                disabled={busy || !oicConfigured}
                aria-pressed={mode === 'oic'}
                title={oicTitle}
                onClick={() => void choose('oic')}
                className={`${base} border-l border-slate-300 ${mode === 'oic' ? on : off}`}
              >
                OIC
              </button>
            </div>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
              Active: {mode === 'oic' ? `OIC (${enabledPhases.length}/5 phases)` : 'ORDS'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Layers className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span>OIC 5-Phase Guide &amp; Tester</span>
          </button>
        </div>
      )}

      <OicBlueprintModal
        open={guideOpen}
        mode={mode}
        oicConfigured={oicConfigured}
        oicHostPreview={oicHostPreview}
        enabledPhases={enabledPhases}
        onClose={() => setGuideOpen(false)}
        onStateUpdated={(next) => {
          setMode(next.mode);
          setEnabledPhases(next.oic_phases);
          if (next.mode === 'oic') {
            onChanged?.(next.mode);
          }
        }}
      />
    </>
  );
}