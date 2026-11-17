import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichAppointments,
  enrichSlots,
  formatCurrencyInr,
  formatDisplayDate,
  formatHoldRemaining,
  normalizeOrdsError,
  paginateItems,
  sortSlotTemplates,
} from './rules';

test('enrichSlots joins template, doctor, and department details', () => {
  const slots = enrichSlots(
    [
      {
        slot_id: 10,
        template_id: 2,
        slot_date: '2026-11-13T00:00:00Z',
        start_time: '09:00',
        end_time: '09:30',
        max_patients_per_slot: 1,
        booked_patients: 0,
        status: 'AVAILABLE',
      },
    ],
    [
      {
        template_id: 2,
        doctor_id: 3,
        day_of_week: 'FRIDAY',
        start_time: '09:00',
        end_time: '12:00',
        slot_duration_mins: 30,
        max_patients_per_slot: 1,
        is_active: 'Y',
      },
    ],
    [
      {
        doctor_id: 3,
        department_id: 2,
        first_name: 'Anil',
        last_name: 'Mehta',
        specialization: 'Joint Replacement',
        consultation_fee: 450,
        tele_consult_flag: 'N',
      },
    ],
    [{ department_id: 2, department_name: 'Orthopedics' }],
  );

  assert.equal(slots[0].doctor_name, 'Dr. Anil Mehta');
  assert.equal(slots[0].department_name, 'Orthopedics');
});

test('enrichAppointments attaches slot date, time, doctor, and fee', () => {
  const enrichedSlots = enrichSlots(
    [
      {
        slot_id: 10,
        template_id: 2,
        slot_date: '2026-11-13T00:00:00Z',
        start_time: '09:00',
        end_time: '09:30',
        max_patients_per_slot: 1,
        booked_patients: 1,
        status: 'SOLD_OUT',
      },
    ],
    [
      {
        template_id: 2,
        doctor_id: 3,
        day_of_week: 'FRIDAY',
        start_time: '09:00',
        end_time: '12:00',
        slot_duration_mins: 30,
        max_patients_per_slot: 1,
        is_active: 'Y',
      },
    ],
    [
      {
        doctor_id: 3,
        department_id: 2,
        first_name: 'Anil',
        last_name: 'Mehta',
        consultation_fee: 450,
        tele_consult_flag: 'N',
      },
    ],
    [{ department_id: 2, department_name: 'Orthopedics' }],
  );

  const appts = enrichAppointments(
    [
      {
        appointment_id: 81,
        appointment_ref: 'APT123',
        patient_id: 1,
        patient_name: 'John Doe',
        slot_id: 10,
        status: 'CONFIRMED',
      },
    ],
    enrichedSlots,
    [
      {
        doctor_id: 3,
        department_id: 2,
        first_name: 'Anil',
        last_name: 'Mehta',
        consultation_fee: 450,
        tele_consult_flag: 'N',
      },
    ],
  );

  assert.equal(appts[0].doctor_name, 'Dr. Anil Mehta');
  assert.equal(appts[0].department_name, 'Orthopedics');
  assert.equal(appts[0].start_time, '09:00');
  assert.equal(appts[0].consultation_fee, 450);
});

test('formatDisplayDate, formatCurrencyInr, and normalizeOrdsError behave cleanly', () => {
  assert.equal(formatDisplayDate('2026-11-13T00:00:00Z'), '13 Nov 2026');
  assert.match(formatCurrencyInr(450), /450\.00/);
  assert.equal(
    normalizeOrdsError({ status: 'error', message: 'ORA-20004: Slot is not available' }),
    'Slot is not available',
  );
});

test('paginateItems slices accurately and clamps out-of-range pages', () => {
  const list = [1, 2, 3, 4, 5, 6, 7];
  const p2 = paginateItems(list, 2, 3);
  assert.deepEqual(p2.pageItems, [4, 5, 6]);
  assert.equal(p2.totalPages, 3);
  assert.equal(p2.currentPage, 2);

  const clamped = paginateItems(list, 99, 3);
  assert.deepEqual(clamped.pageItems, [7]);
  assert.equal(clamped.currentPage, 3);
});

test('formatHoldRemaining formats remaining mm:ss and detects expired holds', () => {
  const base = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(formatHoldRemaining('2026-11-13T10:09:05Z', base), '09:05');
  assert.equal(formatHoldRemaining('2026-11-13T09:59:50Z', base), 'Expired');
  assert.equal(formatHoldRemaining(null, base), null);
});

test('sortSlotTemplates orders MONDAY through SUNDAY and then by start_time', () => {
  const sorted = sortSlotTemplates([
    { template_id: 1, doctor_id: 3, day_of_week: 'FRIDAY', start_time: '15:00', end_time: '17:00', slot_duration_mins: 30, max_patients_per_slot: 1, is_active: 'Y' },
    { template_id: 2, doctor_id: 3, day_of_week: 'MONDAY', start_time: '15:00', end_time: '17:00', slot_duration_mins: 30, max_patients_per_slot: 1, is_active: 'Y' },
    { template_id: 3, doctor_id: 3, day_of_week: 'MONDAY', start_time: '10:00', end_time: '13:00', slot_duration_mins: 30, max_patients_per_slot: 1, is_active: 'Y' },
  ]);
  assert.deepEqual(sorted.map((s) => s.template_id), [3, 2, 1]);
});

import { doesLoginNameMatch, normalizePersonName } from './rules';

test('normalizePersonName and doesLoginNameMatch validate personal names accurately', () => {
  assert.equal(normalizePersonName('  Dr. Priya   Sharma ', true), 'priya sharma');
  assert.equal(doesLoginNameMatch('Priya Sharma', 'Dr. Priya Sharma', 'DOCTOR'), true);
  assert.equal(doesLoginNameMatch('Dr. Priya Sharma', 'Priya Sharma', 'DOCTOR'), true);
  assert.equal(doesLoginNameMatch('john doe', 'John Doe', 'PATIENT'), true);
  assert.equal(doesLoginNameMatch('Jane Doe', 'John Doe', 'PATIENT'), false);
  assert.equal(doesLoginNameMatch('Girish DR', 'Girish DR', 'ADMIN'), true);
  assert.equal(doesLoginNameMatch('Other Admin', 'Girish DR', 'ADMIN'), false);
});

test('enrichAppointments normalizes consultation_mode and rescheduled_from_id', () => {
  const enriched = enrichAppointments(
    [
      {
        appointment_id: 101,
        appointment_ref: 'APT-ONLINE',
        patient_id: 1,
        patient_name: 'John Doe',
        slot_id: 10,
        status: 'CONFIRMED',
        consultation_mode: 'ONLINE',
      },
      {
        appointment_id: 102,
        appointment_ref: 'APT-LEGACY',
        patient_id: 1,
        patient_name: 'John Doe',
        slot_id: 10,
        status: 'COMPLETED',
      },
    ],
    [],
    [],
  );
  assert.equal(enriched[0].consultation_mode, 'ONLINE');
  assert.equal(enriched[1].consultation_mode, 'FACE_TO_FACE');
  assert.equal(enriched[0].rescheduled_from_id, null);
});
