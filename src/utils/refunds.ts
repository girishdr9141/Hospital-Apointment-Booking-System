import type { CancellationRule } from '../types/opd.ts';
import { DEFAULT_HOSPITAL_TIMEZONE } from './calendar.ts';

export const REFUND_COMPLETION_WINDOW_MS = 2 * 60 * 60 * 1000;

export type RefundLifecycleStatus = 'REFUND_PENDING' | 'REFUNDED' | 'NO_REFUND';

export interface CancellationRefundEvaluation {
  applicable: boolean;
  paid_amount: number;
  hours_before_slot: number;
  rule_id: number | null;
  rule_name: string;
  refund_percentage: number;
  cancellation_fee: number;
  refund_amount: number;
  refund_status: RefundLifecycleStatus | null;
  cancelled_at: string;
  refund_due_at: string | null;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeHHMM(time?: string | null): string {
  const raw = String(time || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '09:00';
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  if (timeZone === 'Asia/Kolkata') return 330 * 60 * 1000;
  if (timeZone === 'UTC') return 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const val = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
    const asUtc = Date.UTC(
      val('year'),
      val('month') - 1,
      val('day'),
      val('hour') % 24,
      val('minute'),
      val('second'),
    );
    return asUtc - date.getTime();
  } catch {
    return 330 * 60 * 1000;
  }
}

export function parseSlotStartMs(
  slotDate?: string | null,
  startTime?: string | null,
  timeZone = DEFAULT_HOSPITAL_TIMEZONE,
): number | null {
  const datePart = String(slotDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const hhmm = normalizeHHMM(startTime);
  if (timeZone === 'Asia/Kolkata') {
    const ms = Date.parse(`${datePart}T${hhmm}:00+05:30`);
    return Number.isNaN(ms) ? null : ms;
  }
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const utcApprox = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = getTimeZoneOffsetMs(new Date(utcApprox), timeZone);
  return utcApprox - offset;
}

export function selectApplicableCancellationRule(
  rules: CancellationRule[],
  hoursBeforeSlot: number,
): CancellationRule | null {
  const active = rules.filter((r) => (r.is_active || 'Y') === 'Y');
  if (active.length === 0) return null;

  const effectiveHours = Math.max(0, hoursBeforeSlot);
  const sortedDesc = [...active].sort(
    (a, b) => Number(b.min_hours_before || 0) - Number(a.min_hours_before || 0),
  );

  // First try strict range match: effectiveHours >= min && (max == null || effectiveHours < max)
  for (const rule of sortedDesc) {
    const minH = Number(rule.min_hours_before ?? 0);
    const maxH =
      rule.max_hours_before === null || rule.max_hours_before === undefined
        ? null
        : Number(rule.max_hours_before);
    if (effectiveHours >= minH && (maxH === null || effectiveHours < maxH)) {
      return rule;
    }
  }

  // Fallback inclusive upper bound check (e.g. exact boundary equality)
  for (const rule of sortedDesc) {
    const minH = Number(rule.min_hours_before ?? 0);
    const maxH =
      rule.max_hours_before === null || rule.max_hours_before === undefined
        ? null
        : Number(rule.max_hours_before);
    if (effectiveHours >= minH && (maxH === null || effectiveHours <= maxH)) {
      return rule;
    }
  }

  // Lowest threshold rule when hours are below the lowest configured minimum
  return sortedDesc[sortedDesc.length - 1] ?? null;
}

export function evaluateCancellationRefund(params: {
  rules: CancellationRule[];
  slotDate?: string | null;
  startTime?: string | null;
  cancelledAtIso?: string | null;
  paidAmount?: number | null;
  timeZone?: string;
}): CancellationRefundEvaluation {
  const paidAmount = roundCurrency(Math.max(0, Number(params.paidAmount || 0)));
  const cancelledAtMs = params.cancelledAtIso ? Date.parse(params.cancelledAtIso) : Date.now();
  const safeCancelledMs = Number.isNaN(cancelledAtMs) ? Date.now() : cancelledAtMs;
  const cancelledAt = new Date(safeCancelledMs).toISOString();
  const timeZone = params.timeZone || DEFAULT_HOSPITAL_TIMEZONE;

  const slotStartMs = parseSlotStartMs(params.slotDate, params.startTime, timeZone);
  const rawHoursBefore =
    slotStartMs !== null ? (slotStartMs - safeCancelledMs) / 3_600_000 : 0;
  const hoursBefore = roundCurrency(Math.max(0, rawHoursBefore));

  const matchedRule = selectApplicableCancellationRule(params.rules, rawHoursBefore);
  const refundPct = matchedRule ? Math.min(100, Math.max(0, Number(matchedRule.refund_percentage ?? 0))) : 0;
  const cancellationFee = matchedRule ? roundCurrency(Math.max(0, Number(matchedRule.cancellation_fee ?? 0))) : 0;
  const ruleName = matchedRule?.rule_name || 'Hospital Cancellation Policy';

  if (paidAmount <= 0) {
    return {
      applicable: false,
      paid_amount: 0,
      hours_before_slot: hoursBefore,
      rule_id: matchedRule?.rule_id ?? null,
      rule_name: ruleName,
      refund_percentage: refundPct,
      cancellation_fee: cancellationFee,
      refund_amount: 0,
      refund_status: null,
      cancelled_at: cancelledAt,
      refund_due_at: null,
    };
  }

  const percentageAmount = (paidAmount * refundPct) / 100;
  const computedRefund =
    refundPct <= 0 ? 0 : roundCurrency(Math.max(0, percentageAmount - cancellationFee));

  if (computedRefund <= 0) {
    return {
      applicable: true,
      paid_amount: paidAmount,
      hours_before_slot: hoursBefore,
      rule_id: matchedRule?.rule_id ?? null,
      rule_name: ruleName,
      refund_percentage: refundPct,
      cancellation_fee: cancellationFee,
      refund_amount: 0,
      refund_status: 'NO_REFUND',
      cancelled_at: cancelledAt,
      refund_due_at: null,
    };
  }

  return {
    applicable: true,
    paid_amount: paidAmount,
    hours_before_slot: hoursBefore,
    rule_id: matchedRule?.rule_id ?? null,
    rule_name: ruleName,
    refund_percentage: refundPct,
    cancellation_fee: cancellationFee,
    refund_amount: computedRefund,
    refund_status: 'REFUND_PENDING',
    cancelled_at: cancelledAt,
    refund_due_at: new Date(safeCancelledMs + REFUND_COMPLETION_WINDOW_MS).toISOString(),
  };
}

export function isRefundCompletionDue(
  refundStatus?: string | null,
  refundDueAt?: string | null,
  nowMs = Date.now(),
): boolean {
  if (refundStatus !== 'REFUND_PENDING' || !refundDueAt) return false;
  const dueMs = Date.parse(refundDueAt);
  if (Number.isNaN(dueMs)) return false;
  return nowMs >= dueMs;
}

export function resolveEffectiveRefundStatus(
  record: {
    refund_status?: RefundLifecycleStatus | null;
    refund_due_at?: string | null;
    refund_completed_at?: string | null;
  },
  nowMs = Date.now(),
): {
  status: RefundLifecycleStatus | null;
  completed_at: string | null;
  remaining_ms: number;
} {
  if (!record.refund_status) {
    return { status: null, completed_at: null, remaining_ms: 0 };
  }
  if (record.refund_status === 'REFUNDED') {
    return {
      status: 'REFUNDED',
      completed_at: record.refund_completed_at || record.refund_due_at || null,
      remaining_ms: 0,
    };
  }
  if (record.refund_status === 'NO_REFUND') {
    return { status: 'NO_REFUND', completed_at: null, remaining_ms: 0 };
  }

  const dueMs = record.refund_due_at ? Date.parse(record.refund_due_at) : NaN;
  if (!Number.isNaN(dueMs) && nowMs >= dueMs) {
    return {
      status: 'REFUNDED',
      completed_at: new Date(dueMs).toISOString(),
      remaining_ms: 0,
    };
  }
  return {
    status: 'REFUND_PENDING',
    completed_at: null,
    remaining_ms: Number.isNaN(dueMs) ? REFUND_COMPLETION_WINDOW_MS : Math.max(0, dueMs - nowMs),
  };
}

export function formatRefundRemaining(refundDueAt?: string | null, nowMs = Date.now()): string | null {
  if (!refundDueAt) return null;
  const dueMs = Date.parse(refundDueAt);
  if (Number.isNaN(dueMs)) return null;
  const diffSec = Math.ceil((dueMs - nowMs) / 1000);
  if (diffSec <= 0) return 'Completed';
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
