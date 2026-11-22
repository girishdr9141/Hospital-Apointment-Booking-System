import React, { useState } from 'react';
import { CreditCard, ShieldCheck, Stethoscope } from 'lucide-react';
import type { ConsultationMode } from '../../types/opd';
import { formatCurrencyInr, formatDisplayDate } from '../../utils/rules';
import { Modal } from '../common/Modal';

export interface PaymentModalAppointmentDetails {
  appointment_id: number;
  appointment_ref: string;
  doctor_name: string;
  department_name?: string | null;
  patient_name?: string | null;
  slot_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  consultation_mode?: ConsultationMode | string | null;
  consultation_fee: number;
}

interface AppointmentPaymentModalProps {
  open: boolean;
  appointment: PaymentModalAppointmentDetails | null;
  onPayAndConfirm: (paymentMethod: 'UPI' | 'CARD' | 'NET_BANKING' | 'CASH') => Promise<void>;
  onClose: () => void;
  allowPayLater?: boolean;
  onPayLater?: () => void;
  busy?: boolean;
}

const PAYMENT_METHODS: Array<{
  value: 'UPI' | 'CARD' | 'NET_BANKING' | 'CASH';
  label: string;
  hint: string;
}> = [
  { value: 'UPI', label: 'UPI', hint: 'Instant UPI / QR' },
  { value: 'CARD', label: 'Card', hint: 'Debit / Credit Card' },
  { value: 'NET_BANKING', label: 'Net Banking', hint: 'Bank Transfer' },
  { value: 'CASH', label: 'Cash', hint: 'OPD Counter Payment' },
];

export function AppointmentPaymentModal({
  open,
  appointment,
  onPayAndConfirm,
  onClose,
  allowPayLater = false,
  onPayLater,
  busy = false,
}: AppointmentPaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CARD' | 'NET_BANKING' | 'CASH'>('UPI');

  if (!appointment) return null;

  const feeAmount = Math.max(0, Number(appointment.consultation_fee || 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onPayAndConfirm(paymentMethod);
  };

  return (
    <Modal
      open={open}
      title="Pay Consultation Fee & Confirm Booking"
      subtitle={`Complete consultation fee payment for ${appointment.doctor_name} to finalize this slot.`}
      onClose={busy ? () => {} : onClose}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-950">
                <Stethoscope className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span>{appointment.doctor_name}</span>
              </p>
              <p className="mt-0.5 text-xs text-teal-800">
                {appointment.department_name || 'OPD'}
                {appointment.patient_name ? ` · Patient: ${appointment.patient_name}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-teal-800">
                Doctor Fee
              </p>
              <p className="font-mono text-lg font-bold text-teal-950 tabular-nums">
                {formatCurrencyInr(feeAmount)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-teal-200/80 pt-2.5 text-xs text-teal-900">
            <div>
              <span className="text-teal-700">Reference: </span>
              <span className="font-mono font-semibold tabular-nums">
                {appointment.appointment_ref}
              </span>
            </div>
            <div className="text-right">
              <span className="text-teal-700">Mode: </span>
              <span className="font-semibold">
                {appointment.consultation_mode === 'ONLINE' ? 'Online Consultation' : 'Face-to-Face'}
              </span>
            </div>
            {appointment.slot_date && (
              <div className="col-span-2">
                <span className="text-teal-700">Schedule: </span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatDisplayDate(appointment.slot_date)}
                  {appointment.start_time
                    ? ` · ${appointment.start_time}${appointment.end_time ? ` – ${appointment.end_time}` : ''}`
                    : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Select Payment Method *
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((pm) => {
              const selected = paymentMethod === pm.value;
              return (
                <button
                  key={pm.value}
                  type="button"
                  onClick={() => setPaymentMethod(pm.value)}
                  disabled={busy}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                    selected
                      ? 'border-teal-700 bg-teal-50 ring-2 ring-teal-700/20'
                      : 'border-slate-200 bg-white hover:border-teal-400'
                  }`}
                >
                  <CreditCard
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      selected ? 'text-teal-700' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-900">{pm.label}</p>
                    <p className="text-[11px] text-slate-500">{pm.hint}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
          <span>
            Payment is recorded in Oracle <span className="font-mono">GIRISH_PAYMENTS</span> and
            confirms your slot immediately. Post-payment cancellations follow hospital cancellation
            rules with refunds completed within 2 hours.
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {allowPayLater && onPayLater ? (
            <button
              type="button"
              disabled={busy}
              onClick={onPayLater}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Pay Later (Keep 10-min Hold)
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {busy ? 'Processing Payment...' : `Pay ${formatCurrencyInr(feeAmount)} & Finish Booking`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
