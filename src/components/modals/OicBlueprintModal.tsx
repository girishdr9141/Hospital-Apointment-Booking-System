import React, { useState } from 'react';
import { CheckCircle2, Layers, Play, Server, XCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import {
  ALL_OIC_PHASES,
  OIC_PHASE_SPECS,
  type BackendMode,
  type OicPhaseId,
} from '../../utils/backendRouter';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';

interface OicProbeResult {
  phaseId: OicPhaseId;
  endpointId: string;
  oicPath: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  itemCount: number | null;
  error?: string;
}

interface OicBlueprintModalProps {
  open: boolean;
  mode: BackendMode;
  oicConfigured: boolean;
  oicHostPreview?: string | null;
  enabledPhases: OicPhaseId[];
  onClose: () => void;
  onStateUpdated: (next: { mode: BackendMode; oic_phases: OicPhaseId[] }) => void;
}

export function OicBlueprintModal({
  open,
  mode,
  oicConfigured,
  oicHostPreview,
  enabledPhases,
  onClose,
  onStateUpdated,
}: OicBlueprintModalProps) {
  const { notify } = useToast();
  const [savingPhases, setSavingPhases] = useState(false);
  const [testingPhase, setTestingPhase] = useState<OicPhaseId | 'all' | null>(null);
  const [probeMap, setProbeMap] = useState<Record<string, OicProbeResult>>({});

  const togglePhase = async (phaseId: OicPhaseId) => {
    const exists = enabledPhases.includes(phaseId);
    const nextPhases = exists
      ? enabledPhases.filter((p) => p !== phaseId)
      : [...enabledPhases, phaseId];
    if (nextPhases.length === 0) {
      notify('Keep at least one phase selected for OIC routing.', 'info');
      return;
    }
    setSavingPhases(true);
    try {
      const res = await apiClient.setBackendMode({ oic_phases: nextPhases });
      onStateUpdated({ mode: res.mode, oic_phases: res.oic_phases });
      notify('Updated OIC phase rollout scope', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update OIC phases', 'error');
    } finally {
      setSavingPhases(false);
    }
  };

  const selectAllPhases = async () => {
    setSavingPhases(true);
    try {
      const res = await apiClient.setBackendMode({ oic_phases: ALL_OIC_PHASES });
      onStateUpdated({ mode: res.mode, oic_phases: res.oic_phases });
      notify('All 5 phases enabled for full-application OIC mode', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to enable all phases', 'error');
    } finally {
      setSavingPhases(false);
    }
  };

  const runProbe = async (phaseId?: OicPhaseId) => {
    if (!oicConfigured) {
      notify('Configure OIC_BASE_URL, OIC_USERNAME, and OIC_PASSWORD in .env first.', 'info');
      return;
    }
    setTestingPhase(phaseId || 'all');
    try {
      const res = await apiClient.testOicEndpoints(phaseId);
      setProbeMap((prev) => {
        const next = { ...prev };
        for (const item of res.results) {
          next[item.endpointId] = item;
        }
        return next;
      });
      const passed = res.results.filter((r) => r.ok).length;
      notify(
        `OIC probe finished: ${passed}/${res.results.length} endpoints responded cleanly`,
        passed === res.results.length ? 'success' : 'error',
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'OIC connectivity test failed', 'error');
    } finally {
      setTestingPhase(null);
    }
  };

  const allSelected = ALL_OIC_PHASES.every((p) => enabledPhases.includes(p));

  return (
    <Modal
      open={open}
      title="ORDS ↔ OIC Full-Application Integration Guide"
      subtitle="Build and verify your Oracle Integration Cloud REST triggers phase by phase, or switch the entire app between ORDS and OIC."
      onClose={onClose}
      maxWidth="xl"
    >
      <div className="space-y-4">
        {/* Status & Environment Summary */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-900">
              <Server className="h-4 w-4 text-teal-700" aria-hidden="true" />
              <span>
                Active Global Source:{' '}
                <span className={mode === 'oic' ? 'text-teal-700' : 'text-slate-800'}>
                  {mode === 'oic' ? 'Oracle Integration Cloud (OIC)' : 'Oracle APEX (ORDS)'}
                </span>
              </span>
              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600">
                {enabledPhases.length}/5 phases in OIC scope
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {oicConfigured
                ? `OIC Base URL configured (${oicHostPreview || 'connected'}). Every proxied response exposes X-Backend: ords | oic in Network headers.`
                : 'OIC credentials not configured yet. Add OIC_BASE_URL, OIC_USERNAME, and OIC_PASSWORD to .env (see .env.example) and restart the server.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!allSelected && (
              <button
                type="button"
                disabled={savingPhases}
                onClick={selectAllPhases}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Enable All 5 Phases
              </button>
            )}
            <button
              type="button"
              disabled={!oicConfigured || testingPhase !== null}
              onClick={() => void runProbe()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{testingPhase === 'all' ? 'Testing All...' : 'Test All Read Endpoints'}</span>
            </button>
          </div>
        </div>

        {/* 5-Phase Rollout List */}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {OIC_PHASE_SPECS.map((phase) => {
            const isIncluded = enabledPhases.includes(phase.id);
            const hasProbe = phase.endpoints.some((e) => Boolean(e.probePath));
            return (
              <div
                key={phase.id}
                className={`rounded-xl border p-4 transition-colors ${
                  isIncluded ? 'border-teal-200 bg-white' : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Layers className="h-4 w-4 text-teal-700" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-slate-900">{phase.title}</h3>
                      <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {phase.effortHint}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{phase.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasProbe && (
                      <button
                        type="button"
                        disabled={!oicConfigured || testingPhase !== null}
                        onClick={() => void runProbe(phase.id)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {testingPhase === phase.id ? 'Testing...' : 'Test Phase'}
                      </button>
                    )}
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800">
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        disabled={savingPhases}
                        onChange={() => void togglePhase(phase.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                      />
                      <span>Route in OIC mode</span>
                    </label>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">OIC Trigger Path</th>
                        <th className="px-3 py-2">ORDS Backend Target</th>
                        <th className="px-3 py-2">Contract</th>
                        <th className="px-3 py-2 text-right">Probe</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {phase.endpoints.map((ep) => {
                        const probe = probeMap[ep.id];
                        return (
                          <tr key={ep.id}>
                            <td className="px-3 py-2 font-mono text-slate-900 whitespace-nowrap">
                              <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                                {ep.method}
                              </span>
                              {ep.oicPath}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                              {ep.ordsTarget}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              <p className="font-medium text-slate-800">{ep.summary}</p>
                              <p className="text-[11px] text-slate-500">{ep.contractHint}</p>
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {probe ? (
                                probe.ok ? (
                                  <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    {probe.status} · {probe.latencyMs}ms
                                    {probe.itemCount !== null ? ` (${probe.itemCount})` : ''}
                                  </span>
                                ) : (
                                  <span
                                    title={probe.error}
                                    className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-red-700"
                                  >
                                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                    {probe.error || `HTTP ${probe.status}`}
                                  </span>
                                )
                              ) : (
                                <span className="text-[11px] text-slate-400">
                                  {ep.probePath ? 'Ready' : 'Write/Action'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
