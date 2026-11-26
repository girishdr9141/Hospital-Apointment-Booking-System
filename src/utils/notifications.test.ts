import test from 'node:test';
import assert from 'node:assert/strict';
import type { Appointment, DoctorLeave, ShiftChangeRequest } from '../types/opd';
import {
  buildScopedPortalNotifications,
  canDecideLeaveOrShiftRequest,
  canViewAllShiftChangeRequests,
  scopeLeavesForUser,
  shouldIncludePendingApprovalsCount,
  type PatientNotificationLike,
} from './notifications';

const SHIFT_REQUESTS: ShiftChangeRequest[] = [
  {
    request_id: 'SCR-101',
    doctor_id: 2,
    doctor_name: 'Dr. Priya Sharma',
    current_sessions: [{ start_time: '09:00', end_time: '13:00' }],
    current_slot_duration_mins: 30,
    current_working_days: ['MON', 'TUE'],
    requested_sessions: [{ start_time: '10:00', end_time: '14:00' }],
    requested_slot_duration_mins: 20,
    requested_working_days: ['MON', 'TUE', 'WED'],
    reason: 'Morning ward rounds',
    status: 'PENDING',
    requested_on: '2026-11-25T09:00:00.000Z',
    decided_on: null,
    decided_by: null,
    decision_comments: null,
  },
  {
    request_id: 'SCR-102',
    doctor_id: 3,
    doctor_name: 'Dr. Anil Mehta',
    current_sessions: [{ start_time: '09:00', end_time: '13:00' }],
    current_slot_duration_mins: 30,
    current_working_days: ['MON', 'TUE'],
    requested_sessions: [{ start_time: '15:00', end_time: '18:00' }],
    requested_slot_duration_mins: 15,
    requested_working_days: ['MON', 'TUE'],
    reason: 'Evening OPD',
    status: 'APPROVED',
    requested_on: '2026-11-24T09:00:00.000Z',
    decided_on: '2026-11-25T10:00:00.000Z',
    decided_by: 'Girish DR',
    decision_comments: 'Approved',
  },
];

const LEAVES: DoctorLeave[] = [
  {
    leave_id: 501,
    doctor_id: 2,
    doctor_name: 'Dr. Priya Sharma',
    requested_by: 21,
    start_date: '2026-11-27',
    end_date: '2026-11-28',
    leave_reason: 'Conference',
    leave_status: 'PENDING',
    requested_on: '2026-11-25T08:00:00.000Z',
  },
  {
    leave_id: 502,
    doctor_id: 2,
    doctor_name: 'Dr. Priya Sharma',
    requested_by: 21,
    start_date: '2026-11-20',
    end_date: '2026-11-20',
    leave_reason: 'Family event',
    leave_status: 'REJECTED',
    requested_on: '2026-11-18T08:00:00.000Z',
    approved_on: '2026-11-19T11:00:00.000Z',
  },
  {
    leave_id: 503,
    doctor_id: 3,
    doctor_name: 'Dr. Anil Mehta',
    requested_by: 41,
    start_date: '2026-11-29',
    end_date: '2026-11-29',
    leave_reason: 'Personal',
    leave_status: 'APPROVED',
    requested_on: '2026-11-24T08:00:00.000Z',
    approved_on: '2026-11-25T12:00:00.000Z',
  },
];

const APPOINTMENTS: Appointment[] = [
  {
    appointment_id: 701,
    appointment_ref: 'APT701',
    patient_id: 1,
    patient_name: 'John Doe',
    doctor_id: 2,
    slot_id: 91,
    slot_date: '2026-11-26',
    start_time: '10:00',
    status: 'CONFIRMED',
    booking_source: 'ONLINE',
    created_on: '2026-11-25T11:00:00.000Z',
  },
  {
    appointment_id: 702,
    appointment_ref: 'APT702',
    patient_id: 9,
    patient_name: 'Riya Patel',
    doctor_id: 3,
    slot_id: 92,
    slot_date: '2026-11-26',
    start_time: '15:00',
    status: 'HELD',
    booking_source: 'ONLINE',
    created_on: '2026-11-25T11:30:00.000Z',
  },
];

const PATIENT_NOTIFS: PatientNotificationLike[] = [
  {
    id: 'rx-notif-1',
    patient_id: 1,
    prescription_id: 'RX-1',
    event_type: 'CREATED',
    title: 'New Prescription Issued',
    message: 'Check prescriptions',
    doctor_name: 'Dr. Priya Sharma',
    appointment_ref: 'APT701',
    created_at: '2026-11-25T13:00:00.000Z',
  },
  {
    id: 'rx-notif-2',
    patient_id: 9,
    prescription_id: 'RX-2',
    event_type: 'UPDATED',
    title: 'Prescription Updated',
    message: 'Check prescriptions',
    doctor_name: 'Dr. Anil Mehta',
    appointment_ref: 'APT702',
    created_at: '2026-11-25T13:05:00.000Z',
  },
];

test('ADMIN receives only pending leave and shift change requests', () => {
  const adminNotifs = buildScopedPortalNotifications({
    user: { user_id: 1, role: 'ADMIN', doctor_id: null, patient_id: null },
    shiftChangeRequests: SHIFT_REQUESTS,
    leaves: LEAVES,
    doctorAppointments: APPOINTMENTS,
    patientNotifications: PATIENT_NOTIFS,
    dismissedIds: new Set(),
  });

  assert.equal(adminNotifs.length, 2);
  assert.deepEqual(
    adminNotifs.map((n) => n.category).sort(),
    ['LEAVE_REQUEST', 'SHIFT_REQUEST'],
  );
  assert.ok(adminNotifs.every((n) => n.title.includes('Dr. Priya Sharma')));
});

test('DOCTOR receives only own decisions and own appointments, never other doctors requests or decisions', () => {
  const priyaNotifs = buildScopedPortalNotifications({
    user: { user_id: 21, role: 'DOCTOR', doctor_id: 2, patient_id: null },
    shiftChangeRequests: SHIFT_REQUESTS,
    leaves: LEAVES,
    doctorAppointments: APPOINTMENTS,
    patientNotifications: PATIENT_NOTIFS,
    dismissedIds: new Set(['doc-appt-701-CONFIRMED']),
  });

  // Dr. Priya (doctor_id=2): gets own CONFIRMED appt (marked read) and own REJECTED leave response.
  // Never gets PENDING shift/leave requests, never gets Dr. Anil's APPROVED shift/leave or appt.
  assert.equal(priyaNotifs.length, 2);
  assert.equal(priyaNotifs.filter((n) => n.category === 'SHIFT_REQUEST' || n.category === 'LEAVE_REQUEST').length, 0);
  assert.ok(priyaNotifs.some((n) => n.id === 'leave-resp-502-REJECTED' && n.read === false));
  assert.ok(priyaNotifs.some((n) => n.id === 'doc-appt-701-CONFIRMED' && n.read === true));

  const anilNotifs = buildScopedPortalNotifications({
    user: { user_id: 41, role: 'DOCTOR', doctor_id: 3, patient_id: null },
    shiftChangeRequests: SHIFT_REQUESTS,
    leaves: LEAVES,
    doctorAppointments: APPOINTMENTS,
    patientNotifications: PATIENT_NOTIFS,
    dismissedIds: new Set(),
  });
  assert.equal(anilNotifs.length, 3);
  assert.ok(anilNotifs.some((n) => n.id === 'leave-resp-503-APPROVED'));
  assert.ok(anilNotifs.some((n) => n.id === 'shift-resp-SCR-102-APPROVED'));
  assert.ok(anilNotifs.some((n) => n.id === 'doc-appt-702-HELD'));
  assert.equal(anilNotifs.some((n) => n.id.includes('501') || n.id.includes('502') || n.id.includes('101') || n.id.includes('701')), false);

  const unlinkedDoctorNotifs = buildScopedPortalNotifications({
    user: { user_id: 99, role: 'DOCTOR', doctor_id: null, patient_id: null },
    shiftChangeRequests: SHIFT_REQUESTS,
    leaves: LEAVES,
    doctorAppointments: APPOINTMENTS,
    patientNotifications: PATIENT_NOTIFS,
    dismissedIds: new Set(),
  });
  assert.equal(unlinkedDoctorNotifs.length, 0);
});

test('PATIENT receives only own prescriptions; RECEPTIONIST and SUPER_ADMIN receive zero notifications', () => {
  const patNotifs = buildScopedPortalNotifications({
    user: { user_id: 42, role: 'PATIENT', doctor_id: null, patient_id: 1 },
    shiftChangeRequests: SHIFT_REQUESTS,
    leaves: LEAVES,
    doctorAppointments: APPOINTMENTS,
    patientNotifications: PATIENT_NOTIFS,
    dismissedIds: new Set(),
  });
  assert.equal(patNotifs.length, 1);
  assert.equal(patNotifs[0].id, 'rx-notif-1');
  assert.equal(patNotifs[0].patient_id, 1);

  const receptNotifs = buildScopedPortalNotifications({
    user: { user_id: 43, role: 'RECEPTIONIST', doctor_id: null, patient_id: null },
    shiftChangeRequests: SHIFT_REQUESTS,
    leaves: LEAVES,
    doctorAppointments: APPOINTMENTS,
    patientNotifications: PATIENT_NOTIFS,
    dismissedIds: new Set(),
  });
  assert.equal(receptNotifs.length, 0);

  const superAdminNotifs = buildScopedPortalNotifications({
    user: { user_id: 9001, role: 'SUPER_ADMIN', doctor_id: null, patient_id: null },
    shiftChangeRequests: SHIFT_REQUESTS,
    leaves: LEAVES,
    doctorAppointments: APPOINTMENTS,
    patientNotifications: PATIENT_NOTIFS,
    dismissedIds: new Set(),
  });
  assert.equal(superAdminNotifs.length, 0);
});

test('queue and dashboard helpers strictly block doctors, receptionists, and patients from cross-user leaves/approvals', () => {
  assert.equal(shouldIncludePendingApprovalsCount({ role: 'ADMIN' }), true);
  assert.equal(shouldIncludePendingApprovalsCount({ role: 'DOCTOR' }), false);
  assert.equal(shouldIncludePendingApprovalsCount({ role: 'RECEPTIONIST' }), false);
  assert.equal(shouldIncludePendingApprovalsCount({ role: 'PATIENT' }), false);

  assert.equal(canViewAllShiftChangeRequests({ role: 'ADMIN' }), true);
  assert.equal(canViewAllShiftChangeRequests({ role: 'SUPER_ADMIN' }), true);
  assert.equal(canViewAllShiftChangeRequests({ role: 'DOCTOR' }), false);
  assert.equal(canViewAllShiftChangeRequests({ role: 'RECEPTIONIST' }), false);
  assert.equal(canViewAllShiftChangeRequests({ role: 'PATIENT' }), false);

  assert.equal(canDecideLeaveOrShiftRequest({ role: 'ADMIN' }), true);
  assert.equal(canDecideLeaveOrShiftRequest({ role: 'DOCTOR' }), false);
  assert.equal(canDecideLeaveOrShiftRequest({ role: 'RECEPTIONIST' }), false);
  assert.equal(canDecideLeaveOrShiftRequest({ role: 'PATIENT' }), false);

  assert.equal(scopeLeavesForUser(LEAVES, { role: 'ADMIN', doctor_id: null }).length, 3);
  assert.deepEqual(
    scopeLeavesForUser(LEAVES, { role: 'DOCTOR', doctor_id: 2 }).map((l) => l.leave_id),
    [501, 502],
  );
  assert.equal(scopeLeavesForUser(LEAVES, { role: 'RECEPTIONIST', doctor_id: null }).length, 0);
  assert.equal(scopeLeavesForUser(LEAVES, { role: 'PATIENT', doctor_id: null }).length, 0);
});
