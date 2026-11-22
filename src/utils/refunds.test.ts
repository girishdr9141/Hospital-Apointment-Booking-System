import test from 'node:test';
import assert from 'node:assert/strict';
import type { CancellationRule } from '../types/opd.ts';
import {
  REFUND_COMPLETION_WINDOW_MS,
  evaluateCancellationRefund,
  formatRefundRemaining,
  isRefundCompletionDue,
  parseSlotStartMs,
  resolveEffectiveRefundStatus,
  selectApplicableCancellationRule,
} from './refunds.ts';

const SAMPLE_RULES: CancellationRule[] = [
  {
    rule_id: 1,
    rule_name: 'Early Cancel (>=24h)',
    min_hours_before: 24,
    max_hours_before: null,
    refund_percentage: 100,
    cancellation_fee: 0,
    is_active: 'Y',
  },
  {
    rule_id: 2,
    rule_name: 'Standard Cancel (4h-24h)',
    min_hours_before: 4,
    max_hours_before: 24,
    refund_percentage: 50,
    cancellation_fee: 0,
    is_active: 'Y',
  },
  {
    rule_id: 3,
    rule_name: 'Late Cancel (<4h)',
    min_hours_before: 0,
    max_hours_before: 4,
    refund_percentage: 0,
    cancellation_fee: 0,
    is_active: 'Y',
  },
];

test('parseSlotStartMs resolves Asia/Kolkata slot timestamps accurately', () => {
  // 2026-11-22 13:00 IST == 2026-11-22 07:30:00Z
  assert.equal(
    parseSlotStartMs('2026-11-22', '13:00', 'Asia/Kolkata'),
    Date.parse('2026-11-22T07:30:00.000Z'),
  );
});

test('selectApplicableCancellationRule picks correct tier across hoursBefore bounds', () => {
  assert.equal(selectApplicableCancellationRule(SAMPLE_RULES, 30)?.rule_id, 1);
  assert.equal(selectApplicableCancellationRule(SAMPLE_RULES, 24)?.rule_id, 1);
  assert.equal(selectApplicableCancellationRule(SAMPLE_RULES, 12)?.rule_id, 2);
  assert.equal(selectApplicableCancellationRule(SAMPLE_RULES, 4)?.rule_id, 2);
  assert.equal(selectApplicableCancellationRule(SAMPLE_RULES, 2)?.rule_id, 3);
  assert.equal(selectApplicableCancellationRule(SAMPLE_RULES, -0.25)?.rule_id, 3);
});

test('evaluateCancellationRefund sets REFUND_PENDING with +2h deadline when refund > 0', () => {
  // Slot at 2026-11-23 13:00 IST (07:30Z); cancel 10 hours before (2026-11-22T21:30:00Z)
  const cancelledAt = '2026-11-22T21:30:00.000Z';
  const evalRes = evaluateCancellationRefund({
    rules: SAMPLE_RULES,
    slotDate: '2026-11-23',
    startTime: '13:00',
    cancelledAtIso: cancelledAt,
    paidAmount: 800,
    timeZone: 'Asia/Kolkata',
  });

  assert.equal(evalRes.applicable, true);
  assert.equal(evalRes.rule_name, 'Standard Cancel (4h-24h)');
  assert.equal(evalRes.refund_percentage, 50);
  assert.equal(evalRes.refund_amount, 400);
  assert.equal(evalRes.refund_status, 'REFUND_PENDING');
  assert.equal(
    evalRes.refund_due_at,
    new Date(Date.parse(cancelledAt) + REFUND_COMPLETION_WINDOW_MS).toISOString(),
  );
});

test('evaluateCancellationRefund transitions cleanly from REFUND_PENDING to REFUNDED after 2 hours', () => {
  const cancelledAt = '2026-11-22T07:35:00.000Z';
  const evalRes = evaluateCancellationRefund({
    rules: SAMPLE_RULES,
    slotDate: '2026-11-25',
    startTime: '10:00',
    cancelledAtIso: cancelledAt,
    paidAmount: 600,
    timeZone: 'Asia/Kolkata',
  });

  assert.equal(evalRes.refund_percentage, 100);
  assert.equal(evalRes.refund_amount, 600);
  assert.equal(evalRes.refund_status, 'REFUND_PENDING');

  // Immediately and 1h 59m later -> still REFUND_PENDING ("will refund within 2 hours")
  const at1h59m = Date.parse(cancelledAt) + (119 * 60 * 1000);
  assert.equal(isRefundCompletionDue(evalRes.refund_status, evalRes.refund_due_at, at1h59m), false);
  const pendingState = resolveEffectiveRefundStatus(
    { refund_status: evalRes.refund_status, refund_due_at: evalRes.refund_due_at },
    at1h59m,
  );
  assert.equal(pendingState.status, 'REFUND_PENDING');
  assert.equal(formatRefundRemaining(evalRes.refund_due_at, at1h59m), '01:00');

  // At exactly 2 hours -> completed refund ("REFUNDED")
  const at2h = Date.parse(cancelledAt) + REFUND_COMPLETION_WINDOW_MS;
  assert.equal(isRefundCompletionDue(evalRes.refund_status, evalRes.refund_due_at, at2h), true);
  const completedState = resolveEffectiveRefundStatus(
    { refund_status: evalRes.refund_status, refund_due_at: evalRes.refund_due_at },
    at2h,
  );
  assert.equal(completedState.status, 'REFUNDED');
  assert.equal(formatRefundRemaining(evalRes.refund_due_at, at2h), 'Completed');
});

test('evaluateCancellationRefund returns NO_REFUND for 0% cancellation tier and null for unpaid', () => {
  const zeroEval = evaluateCancellationRefund({
    rules: SAMPLE_RULES,
    slotDate: '2026-11-22',
    startTime: '13:00',
    cancelledAtIso: '2026-11-22T07:00:00.000Z', // 30 mins before 13:00 IST
    paidAmount: 500,
    timeZone: 'Asia/Kolkata',
  });
  assert.equal(zeroEval.refund_percentage, 0);
  assert.equal(zeroEval.refund_amount, 0);
  assert.equal(zeroEval.refund_status, 'NO_REFUND');
  assert.equal(zeroEval.refund_due_at, null);

  const unpaidEval = evaluateCancellationRefund({
    rules: SAMPLE_RULES,
    slotDate: '2026-11-25',
    startTime: '10:00',
    cancelledAtIso: '2026-11-22T07:00:00.000Z',
    paidAmount: 0,
    timeZone: 'Asia/Kolkata',
  });
  assert.equal(unpaidEval.applicable, false);
  assert.equal(unpaidEval.refund_status, null);
});
