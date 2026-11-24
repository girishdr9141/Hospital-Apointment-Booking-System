import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeByIdWithOraclePriority,
  mergeShiftMaps,
  parseOracleDoctorShiftRow,
  parseOracleMedicalRecordRow,
  parseOraclePrescriptionRow,
  parseOracleShiftChangeRequestRow,
  parseWorkingDays,
  serializeDoctorShiftForOracle,
  serializeMedicalRecordForOracle,
  serializePrescriptionForOracle,
  serializeShiftChangeRequestForOracle,
} from './clinicalAndShifts';
import type {
  DoctorShiftConfig,
  MedicalRecordEntry,
  PrescriptionEntry,
  ShiftChangeRequest,
} from '../types/opd';

test('medical record Oracle row round-trips cleanly', () => {
  const entry: MedicalRecordEntry = {
    record_id: 'MR-1001',
    patient_id: 1,
    patient_name: 'John Doe',
    doctor_id: 2,
    doctor_name: 'Dr. Priya Sharma',
    appointment_ref: 'APT-2026-001',
    visit_date: '2026-11-10',
    chief_complaint: 'Headache',
    diagnosis: 'Tension headache',
    vitals_summary: 'BP 118/76',
    clinical_notes: 'Advised hydration',
    updated_at: '2026-11-10T10:30:00.000Z',
  };

  const payload = serializeMedicalRecordForOracle(entry);
  const parsed = parseOracleMedicalRecordRow({
    ...payload,
    visit_date: '2026-11-10T00:00:00Z',
    updated_on: '2026-11-10T10:30:00.000Z',
  });

  assert.deepEqual(parsed, entry);
});

test('prescription Oracle row parses JSON CLOB medications_json cleanly', () => {
  const rx: PrescriptionEntry = {
    prescription_id: 'RX-2001',
    patient_id: 1,
    patient_name: 'John Doe',
    doctor_id: 2,
    doctor_name: 'Dr. Priya Sharma',
    appointment_ref: 'APT-2026-001',
    prescribed_date: '2026-11-10',
    diagnosis: 'Tension headache',
    medications: [
      {
        name: 'Paracetamol 650mg',
        dosage: '1 tablet',
        frequency: 'SOS',
        duration: '5 days',
      },
    ],
    instructions: 'Take after meals',
    status: 'ACTIVE',
    updated_at: '2026-11-10T10:35:00.000Z',
  };

  const payload = serializePrescriptionForOracle(rx, 'idem-123');
  assert.equal(payload.idempotency_key, 'idem-123');

  const parsedFromOracle = parseOraclePrescriptionRow({
    PRESCRIPTION_ID: 'RX-2001',
    PATIENT_ID: 1,
    PATIENT_NAME: 'John Doe',
    DOCTOR_ID: 2,
    DOCTOR_NAME: 'Dr. Priya Sharma',
    APPOINTMENT_REF: 'APT-2026-001',
    PRESCRIBED_DATE: '2026-11-10T00:00:00Z',
    DIAGNOSIS: 'Tension headache',
    MEDICATIONS_JSON: payload.medications_json,
    INSTRUCTIONS: 'Take after meals',
    STATUS: 'ACTIVE',
    UPDATED_ON: '2026-11-10T10:35:00.000Z',
  });

  assert.deepEqual(parsedFromOracle, rx);
});

test('doctor shift window Oracle row parses sessions_json, working_days CSV, and Y/N flag', () => {
  const shift: DoctorShiftConfig = {
    doctor_id: 2,
    doctor_name: 'Dr. Priya Sharma',
    sessions: [
      { start_time: '09:00', end_time: '12:00' },
      { start_time: '14:00', end_time: '17:00' },
    ],
    slot_duration_mins: 30,
    working_days: ['MONDAY', 'TUESDAY', 'WEDNESDAY'],
    is_registered: true,
    registered_at: '2026-11-15T17:03:01.708Z',
    updated_at: '2026-11-15T17:03:01.708Z',
  };

  const payload = serializeDoctorShiftForOracle(shift);
  assert.equal(payload.working_days, 'MONDAY,TUESDAY,WEDNESDAY');
  assert.equal(payload.working_days_csv, 'MONDAY,TUESDAY,WEDNESDAY');
  assert.equal(payload.is_registered, 'Y');

  const parsed = parseOracleDoctorShiftRow({
    doctor_id: 2,
    doctor_name: 'Dr. Priya Sharma',
    sessions_json: payload.sessions_json,
    slot_duration_mins: 30,
    working_days: payload.working_days_csv,
    is_registered: 'Y',
    registered_at: '2026-11-15T17:03:01.708Z',
    updated_on: '2026-11-15T17:03:01.708Z',
  });

  assert.deepEqual(parsed, shift);
  assert.deepEqual(parseWorkingDays('["MONDAY","FRIDAY"]'), ['MONDAY', 'FRIDAY']);
});

test('shift change request Oracle row round-trips and Oracle wins on merge', () => {
  const req: ShiftChangeRequest = {
    request_id: 'SCR-1794762901927',
    doctor_id: 46,
    doctor_name: 'Dr. Rohit Ramachandra',
    current_sessions: [{ start_time: '13:00', end_time: '14:20' }],
    current_slot_duration_mins: 20,
    current_working_days: ['MONDAY', 'TUESDAY'],
    requested_sessions: [{ start_time: '10:00', end_time: '15:20' }],
    requested_slot_duration_mins: 20,
    requested_working_days: ['MONDAY', 'TUESDAY', 'WEDNESDAY'],
    reason: 'Personal',
    status: 'APPROVED',
    requested_on: '2026-11-15T17:15:01.927Z',
    decided_on: '2026-11-15T17:15:52.297Z',
    decided_by: 'Girish DR',
    decision_comments: 'ok',
  };

  const payload = serializeShiftChangeRequestForOracle(req);
  const parsed = parseOracleShiftChangeRequestRow({
    ...payload,
    requested_on: req.requested_on,
    decided_on: req.decided_on,
    decided_by: req.decided_by,
    decision_comments: req.decision_comments,
  });

  assert.deepEqual(parsed, req);

  const mergedReqs = mergeByIdWithOraclePriority(
    [req],
    [{ ...req, status: 'PENDING', decided_by: null, decided_on: null }],
    (r) => r.request_id,
    (r) => r.requested_on,
  );
  assert.equal(mergedReqs.length, 1);
  assert.equal(mergedReqs[0].status, 'APPROVED');

  const mergedShifts = mergeShiftMaps(
    [
      {
        doctor_id: 2,
        doctor_name: 'Dr. Priya Sharma',
        sessions: [{ start_time: '10:00', end_time: '13:00' }],
        slot_duration_mins: 30,
        working_days: ['MONDAY'],
        is_registered: true,
      },
    ],
    {
      '2': {
        doctor_id: 2,
        doctor_name: 'Dr. Priya Sharma',
        sessions: [{ start_time: '09:00', end_time: '12:00' }],
        slot_duration_mins: 30,
        working_days: ['MONDAY'],
        is_registered: true,
      },
    },
  );
  assert.equal(mergedShifts['2'].sessions[0].start_time, '10:00');
});
