import test from 'node:test';
import assert from 'node:assert/strict';
import type { RbacAuditLogEntry } from '../types/opd';
import {
  ALL_AUDIT_CATEGORIES,
  describeBookingAuditDetails,
  describeCancellationAuditDetails,
  filterAuditLogs,
  formatAuditActorLabel,
  getAuditCategoryLabel,
} from './auditLogs';

const SAMPLE_LOGS: RbacAuditLogEntry[] = [
  {
    id: '1',
    actor_user_id: 1001,
    actor_name: 'Karan Tulsani',
    actor_email: 'karan.tulsani@hospital.com',
    actor_role: 'SUPER_ADMIN',
    target_label: 'karan.tulsani@hospital.com',
    action: 'LOGIN_SUCCESS',
    category: 'AUTH',
    details: 'Signed in via system portal.',
    timestamp: '2026-11-24T10:00:00.000Z',
    severity: 'info',
  },
  {
    id: '2',
    actor_user_id: 4001,
    actor_name: 'Meera Kulkarni',
    actor_email: 'meera.kulkarni@hospital.com',
    actor_role: 'RECEPTIONIST',
    target_label: 'APT20261124001',
    action: 'APPOINTMENT_CANCELLED',
    category: 'APPOINTMENTS',
    previous_value: 'CONFIRMED',
    new_value: 'CANCELLED',
    details: 'Cancelled by Meera Kulkarni (RECEPTIONIST): APT20261124001.',
    timestamp: '2026-11-24T10:05:00.000Z',
    severity: 'warning',
  },
  {
    id: '3',
    actor_user_id: 3002,
    actor_name: 'Dr. Priya Sharma',
    actor_email: 'priya@hospital.com',
    actor_role: 'DOCTOR',
    target_label: 'Dr. Priya Sharma · 2026-11-25 to 2026-11-26',
    action: 'LEAVE_REQUEST_SUBMITTED',
    category: 'SHIFTS_LEAVES',
    new_value: 'PENDING',
    details: 'Leave request submitted.',
    timestamp: '2026-11-24T10:10:00.000Z',
    severity: 'info',
  },
];

test('audit category filter and labels cover all operational categories', () => {
  assert.ok(ALL_AUDIT_CATEGORIES.includes('AUTH'));
  assert.ok(ALL_AUDIT_CATEGORIES.includes('APPOINTMENTS'));
  assert.ok(ALL_AUDIT_CATEGORIES.includes('SHIFTS_LEAVES'));
  assert.ok(ALL_AUDIT_CATEGORIES.includes('BILLING'));
  assert.ok(ALL_AUDIT_CATEGORIES.includes('OPERATIONS'));
  assert.equal(getAuditCategoryLabel('APPOINTMENTS'), 'Appointments & Holds');
  assert.equal(getAuditCategoryLabel('SHIFTS_LEAVES'), 'Shifts & Leaves');
});

test('filterAuditLogs filters by category and searches actor email/details', () => {
  assert.equal(filterAuditLogs(SAMPLE_LOGS, 'ALL', '').length, 3);
  assert.equal(filterAuditLogs(SAMPLE_LOGS, 'AUTH', '').length, 1);
  assert.equal(filterAuditLogs(SAMPLE_LOGS, 'ALL', 'meera.kulkarni@hospital.com').length, 1);
  assert.equal(filterAuditLogs(SAMPLE_LOGS, 'SHIFTS_LEAVES', '2026-11-25').length, 1);
  assert.equal(filterAuditLogs(SAMPLE_LOGS, 'BILLING', '').length, 0);
});

test('formatAuditActorLabel includes name, role, and optional email', () => {
  assert.equal(
    formatAuditActorLabel(SAMPLE_LOGS[0]),
    'Karan Tulsani (SUPER_ADMIN) · karan.tulsani@hospital.com',
  );
  assert.equal(
    formatAuditActorLabel({ actor_name: 'Hold Expiry Scheduler', actor_role: 'SYSTEM', actor_email: null }),
    'Hold Expiry Scheduler (SYSTEM)',
  );
});

test('describeBookingAuditDetails captures booking source, mode, hold state, and reschedule ref', () => {
  const details = describeBookingAuditDetails({
    actorName: 'John Doe',
    actorRole: 'PATIENT',
    appointmentRef: 'APT9001',
    patientName: 'John Doe',
    doctorName: 'Dr. Priya Sharma',
    slotDate: '2026-11-24',
    startTime: '17:00',
    endTime: '17:30',
    bookingSource: 'ONLINE',
    consultationMode: 'ONLINE',
    initialStatus: 'HELD',
    rescheduledFromId: 88,
  });
  assert.match(details, /John Doe \(PATIENT\) booked APT9001/);
  assert.match(details, /Dr\. Priya Sharma/);
  assert.match(details, /ONLINE, ONLINE/);
  assert.match(details, /rescheduled from #88/);
  assert.match(details, /10-min unpaid hold/);
});

test('describeCancellationAuditDetails records exact cancelling actor for both unpaid and paid bookings', () => {
  const unpaid = describeCancellationAuditDetails({
    actorName: 'John Doe',
    actorRole: 'PATIENT',
    appointmentRef: 'APT1001',
    patientName: 'John Doe',
    doctorName: 'Dr. Priya Sharma',
    slotDate: '2026-11-24',
    startTime: '17:00',
    previousStatus: 'HELD',
    paidAmount: 0,
  });
  assert.match(unpaid, /Cancelled by John Doe \(PATIENT\)/);
  assert.match(unpaid, /Unpaid booking cancelled and slot released/);

  const paidRefund = describeCancellationAuditDetails({
    actorName: 'Girish DR',
    actorRole: 'ADMIN',
    appointmentRef: 'APT1002',
    patientName: 'John Doe',
    doctorName: 'Dr. Priya Sharma',
    slotDate: '2026-11-25',
    startTime: '10:00',
    previousStatus: 'CONFIRMED',
    paidAmount: 500,
    refundStatus: 'REFUND_PENDING',
    refundAmount: 500,
    refundPercentage: 100,
    ruleName: 'Full Refund >24h',
  });
  assert.match(paidRefund, /Cancelled by Girish DR \(ADMIN\)/);
  assert.match(paidRefund, /refund ₹500\.00 \(100% via Full Refund >24h\) scheduled within 2 hours/);
});
