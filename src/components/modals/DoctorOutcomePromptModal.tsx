import { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, UserX } from 'lucide-react';
import type { Appointment } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { formatDisplayDate } from '../../utils/rules';
import { Modal } from '../common/Modal';
import { ConsultationModeBadge } from '../layout/StatusIndicator';

interface DoctorOutcomePromptModalProps {
  open: boolean;
  doctorName: string;
  appointments: Appointment[];
  onClose: () => void;
  onOutcomeSubmitted: () => Promise<void> | void;
}

export function DoctorOutcomePromptModal({
  open,
  doctorName,
  appointments,
  onClose,
  onOutcomeSubmitted,
}: DoctorOutcomePromptModalProps) {
  const { notify } = useToast();
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const handleSubmitOutcome = async (
    appt: Appointment,
    outcome: 'COMPLETED' | 'NO_SHOW',
  ) => {
    const key = `${appt.appointment_id}:${outcome}`;
    setSubmittingKey(key);
    try {
      await apiClient.updateAppointmentOutcome(appt.appointment_id, outcome);
      notify(
        outcome === 'COMPLETED'
          ? `Marked ${appt.appointment_ref} (${appt.patient_name}) as Completed`
          : `Marked ${appt.appointment_ref} (${appt.patient_name}) as No-Show`,
        'success',
      );
      await onOutcomeSubmitted();
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Unable to record appointment outcome',
        'error',
      );
    } finally {
      setSubmittingKey(null);
    }
  };

  return (
    <Modal
      open={open && appointments.length > 0}
      title={`Post-Consultation Outcome Required (${appointments.length})`}
      subtitle={`${doctorName} · Explicit outcome confirmation keeps hospital analytics accurate`}
      onClose={onClose}
      maxWidth="xl"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-950">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              Slot time has completed for {appointments.length} confirmed appointment
              {appointments.length === 1 ? '' : 's'}
            </p>
            <p className="mt-1 text-xs text-amber-900">
              Please explicitly mark each visit as <strong>Completed</strong> (patient attended) or{' '}
              <strong>No-Show</strong> (patient did not show up). Unconfirmed past visits are held out
              of hospital analytics until you confirm their outcome.
            </p>
          </div>
        </div>

        <div className="max-h-80 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {appointments.map((appt) => {
            const isBusy = submittingKey?.startsWith(`${appt.appointment_id}:`) ?? false;
            return (
              <div
                key={appt.appointment_id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {appt.patient_name}
                    </span>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {appt.appointment_ref}
                    </span>
                    <ConsultationModeBadge mode={appt.consultation_mode} />
                  </div>
                  <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-600 tabular-nums">
                    <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>
                      {formatDisplayDate(appt.slot_date)} · {appt.start_time || '—'} –{' '}
                      {appt.end_time || '—'}
                    </span>
                    {appt.department_name ? <span>· {appt.department_name}</span> : null}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleSubmitOutcome(appt, 'COMPLETED')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {submittingKey === `${appt.appointment_id}:COMPLETED`
                        ? 'Saving...'
                        : 'Completed'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleSubmitOutcome(appt, 'NO_SHOW')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:opacity-60"
                  >
                    <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {submittingKey === `${appt.appointment_id}:NO_SHOW`
                        ? 'Saving...'
                        : 'No-Show'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Remind Me Later
          </button>
        </div>
      </div>
    </Modal>
  );
}
