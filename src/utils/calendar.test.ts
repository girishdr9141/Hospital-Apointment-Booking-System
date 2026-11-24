import test from 'node:test';
import assert from 'node:assert/strict';
import type { DoctorShiftConfig, Slot } from '../types/opd.ts';
import {
  buildWorkingHourWindows,
  computeShiftSession,
  doesSessionCrossMidnight,
  filterBookableSlots,
  formatMinutesToHHMM,
  formatShiftSummary,
  getAppointmentsAwaitingOutcome,
  isSlotEndExpired,
  isSlotFutureOrActive,
  isSlotStartExpired,
  isValidSlotTimeRange,
  mergeDayWorkingSlots,
  validateShiftSessions,
} from './calendar.ts';

function makeShift(sessions: Array<{ start_time: string; end_time: string }>, duration = 30): DoctorShiftConfig {
  return {
    doctor_id: 99,
    sessions,
    slot_duration_mins: duration,
    working_days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    is_registered: true,
  };
}

test('formatMinutesToHHMM wraps cleanly past 24:00', () => {
  assert.equal(formatMinutesToHHMM(0), '00:00');
  assert.equal(formatMinutesToHHMM(1320), '22:00');
  assert.equal(formatMinutesToHHMM(1440), '00:00');
  assert.equal(formatMinutesToHHMM(1470), '00:30');
  assert.equal(formatMinutesToHHMM(1740), '05:00');
});

test('validateShiftSessions accepts overnight shifts 10 PM-12 AM, 9 PM-5 AM, 11 PM-7 AM, and daytime 9 AM-5 PM', () => {
  // 10:00 PM - 12:00 AM (22:00 - 00:00)
  const r1 = validateShiftSessions([{ start_time: '22:00', end_time: '00:00' }]);
  assert.equal(r1.valid, true);
  assert.equal(doesSessionCrossMidnight('22:00', '00:00'), true);
  assert.equal(computeShiftSession('22:00', '00:00')?.durationMinutes, 120);

  // 9:00 PM - 5:00 AM (21:00 - 05:00)
  const r2 = validateShiftSessions([{ start_time: '21:00', end_time: '05:00' }]);
  assert.equal(r2.valid, true);
  assert.equal(doesSessionCrossMidnight('21:00', '05:00'), true);
  assert.equal(computeShiftSession('21:00', '05:00')?.durationMinutes, 480);

  // 11:00 PM - 7:00 AM (23:00 - 07:00)
  const r3 = validateShiftSessions([{ start_time: '23:00', end_time: '07:00' }]);
  assert.equal(r3.valid, true);
  assert.equal(doesSessionCrossMidnight('23:00', '07:00'), true);
  assert.equal(computeShiftSession('23:00', '07:00')?.durationMinutes, 480);

  // Normal daytime 9:00 AM - 5:00 PM (09:00 - 17:00)
  const r4 = validateShiftSessions([{ start_time: '09:00', end_time: '17:00' }]);
  assert.equal(r4.valid, true);
  assert.equal(doesSessionCrossMidnight('09:00', '17:00'), false);
  assert.equal(computeShiftSession('09:00', '17:00')?.durationMinutes, 480);
});

test('validateShiftSessions supports multi-session evening + overnight shifts and rejects overlaps/identical times', () => {
  // User screenshot scenario: Primary 17:00-21:00 + Second Session 22:00-01:00
  const screenshotRes = validateShiftSessions([
    { start_time: '17:00', end_time: '21:00' },
    { start_time: '22:00', end_time: '01:00' },
  ]);
  assert.equal(screenshotRes.valid, true);

  // Evening + 22:00-00:00 midnight ending
  const midRes = validateShiftSessions([
    { start_time: '17:00', end_time: '21:00' },
    { start_time: '22:00', end_time: '00:00' },
  ]);
  assert.equal(midRes.valid, true);

  // Two overnight split sessions: 21:00-01:00 + 02:00-05:00
  const splitNightRes = validateShiftSessions([
    { start_time: '21:00', end_time: '01:00' },
    { start_time: '02:00', end_time: '05:00' },
  ]);
  assert.equal(splitNightRes.valid, true);

  // Reject identical start and end times
  const sameTime = validateShiftSessions([{ start_time: '22:00', end_time: '22:00' }]);
  assert.equal(sameTime.valid, false);

  // Reject overlapping overnight sessions
  const overlapNight = validateShiftSessions([
    { start_time: '21:00', end_time: '05:00' },
    { start_time: '23:00', end_time: '02:00' },
  ]);
  assert.equal(overlapNight.valid, false);

  const overlapPostMidnight = validateShiftSessions([
    { start_time: '21:00', end_time: '05:00' },
    { start_time: '02:00', end_time: '06:00' },
  ]);
  assert.equal(overlapPostMidnight.valid, false);
});

test('isValidSlotTimeRange handles 23:30-00:00 and rejects invalid ranges', () => {
  assert.equal(isValidSlotTimeRange('23:30', '00:00'), true);
  assert.equal(isValidSlotTimeRange('23:30', '00:30'), true);
  assert.equal(isValidSlotTimeRange('09:00', '09:30'), true);
  assert.equal(isValidSlotTimeRange('22:00', '22:00'), false);
  assert.equal(isValidSlotTimeRange('17:00', '09:00'), false);
});

test('buildWorkingHourWindows generates accurate slots for 22:00-00:00 (10 PM - 12 AM)', () => {
  const windows = buildWorkingHourWindows('2026-11-16', [], {
    shiftConfig: makeShift([{ start_time: '22:00', end_time: '00:00' }], 30),
  });
  assert.equal(windows.length, 4);
  assert.deepEqual(
    windows.map((w) => [w.slot_date, w.start_time, w.end_time, w.dayOffset]),
    [
      ['2026-11-16', '22:00', '22:30', 0],
      ['2026-11-16', '22:30', '23:00', 0],
      ['2026-11-16', '23:00', '23:30', 0],
      ['2026-11-16', '23:30', '00:00', 0],
    ],
  );
});

test('buildWorkingHourWindows generates cross-midnight slots with next-day calendar dates for 21:00-05:00 and 23:00-07:00', () => {
  const w9to5 = buildWorkingHourWindows('2026-11-16', [], {
    shiftConfig: makeShift([{ start_time: '21:00', end_time: '05:00' }], 30),
  });
  assert.equal(w9to5.length, 16);
  // First 6 slots on 2026-11-16 (21:00 .. 23:30-00:00)
  assert.equal(w9to5[0].slot_date, '2026-11-16');
  assert.equal(w9to5[0].start_time, '21:00');
  assert.equal(w9to5[5].slot_date, '2026-11-16');
  assert.equal(w9to5[5].start_time, '23:30');
  assert.equal(w9to5[5].end_time, '00:00');
  // Next 10 slots on 2026-11-17 (00:00 .. 04:30-05:00)
  assert.equal(w9to5[6].slot_date, '2026-11-17');
  assert.equal(w9to5[6].start_time, '00:00');
  assert.equal(w9to5[6].end_time, '00:30');
  assert.equal(w9to5[6].dayOffset, 1);
  assert.equal(w9to5[15].slot_date, '2026-11-17');
  assert.equal(w9to5[15].start_time, '04:30');
  assert.equal(w9to5[15].end_time, '05:00');

  const w11to7 = buildWorkingHourWindows('2026-11-16', [], {
    shiftConfig: makeShift([{ start_time: '23:00', end_time: '07:00' }], 30),
  });
  assert.equal(w11to7.length, 16);
  assert.equal(w11to7[0].slot_date, '2026-11-16');
  assert.equal(w11to7[0].start_time, '23:00');
  assert.equal(w11to7[2].slot_date, '2026-11-17');
  assert.equal(w11to7[2].start_time, '00:00');
  assert.equal(w11to7[15].slot_date, '2026-11-17');
  assert.equal(w11to7[15].start_time, '06:30');
  assert.equal(w11to7[15].end_time, '07:00');
});

test('buildWorkingHourWindows preserves daytime 09:00-17:00 behavior', () => {
  const wDay = buildWorkingHourWindows('2026-11-16', [], {
    shiftConfig: makeShift([{ start_time: '09:00', end_time: '17:00' }], 30),
  });
  assert.equal(wDay.length, 16);
  assert.equal(wDay.every((w) => w.slot_date === '2026-11-16' && w.dayOffset === 0), true);
  assert.equal(wDay[0].start_time, '09:00');
  assert.equal(wDay[15].end_time, '17:00');
});

test('mergeDayWorkingSlots matches post-midnight slots by exact calendar date and sorts chronologically', () => {
  const shift = makeShift([{ start_time: '21:00', end_time: '05:00' }], 30);
  const windows = buildWorkingHourWindows('2026-11-16', [], { shiftConfig: shift });
  const existing: Slot[] = [
    {
      slot_id: 101,
      template_id: 1,
      slot_date: '2026-11-16',
      start_time: '23:30',
      end_time: '00:00',
      max_patients_per_slot: 1,
      booked_patients: 0,
      status: 'AVAILABLE',
    },
    {
      slot_id: 102,
      template_id: 1,
      slot_date: '2026-11-17',
      start_time: '00:00',
      end_time: '00:30',
      max_patients_per_slot: 1,
      booked_patients: 1,
      status: 'SOLD_OUT',
    },
  ];
  const merged = mergeDayWorkingSlots('2026-11-16', windows, existing);
  assert.equal(merged.length, 16);
  assert.equal(merged[0].start_time, '21:00');
  assert.equal(merged[5].status, 'AVAILABLE');
  assert.equal(merged[5].slot_date, '2026-11-16');
  assert.equal(merged[6].start_time, '00:00');
  assert.equal(merged[6].slot_date, '2026-11-17');
  assert.equal(merged[6].status, 'BOOKED');
  assert.equal(merged[6].dayOffset, 1);

  // Expiry check on post-midnight slot at 2026-11-16 22:30 IST (17:00 UTC)
  const at2230IST = new Date('2026-11-16T17:00:00.000Z');
  assert.equal(isSlotStartExpired('2026-11-16', '22:00', at2230IST, 'Asia/Kolkata'), true);
  assert.equal(isSlotStartExpired('2026-11-16', '23:30', at2230IST, 'Asia/Kolkata'), false);
  assert.equal(isSlotStartExpired('2026-11-17', '00:00', at2230IST, 'Asia/Kolkata'), false);
});

test('formatShiftSummary indicates overnight next-day sessions clearly', () => {
  assert.equal(
    formatShiftSummary([{ start_time: '22:00', end_time: '00:00' }], 30),
    '22:00–00:00 (+1d) (30 min)',
  );
  assert.equal(
    formatShiftSummary([{ start_time: '09:00', end_time: '17:00' }], 30),
    '09:00–17:00 (30 min)',
  );
});

test('isSlotEndExpired and isSlotFutureOrActive handle daytime, overnight, and past booked slots', () => {
  // 2026-11-16 14:30 IST = 09:00 UTC
  const at1430IST = new Date('2026-11-16T09:00:00.000Z');
  // Daytime slot 14:00-14:30 has completed at 14:30
  assert.equal(isSlotEndExpired('2026-11-16', '14:00', '14:30', at1430IST, 'Asia/Kolkata'), true);
  // Daytime slot 14:15-14:45 is still ongoing at 14:30
  assert.equal(isSlotEndExpired('2026-11-16', '14:15', '14:45', at1430IST, 'Asia/Kolkata'), false);
  // Past day booked slot is expired
  assert.equal(isSlotEndExpired('2026-11-15', '10:00', '10:30', at1430IST, 'Asia/Kolkata'), true);
  // Cross-midnight slot 23:30-00:00 on 2026-11-16 at 23:45 IST (18:15 UTC) is NOT expired yet
  const at2345IST = new Date('2026-11-16T18:15:00.000Z');
  assert.equal(isSlotEndExpired('2026-11-16', '23:30', '00:00', at2345IST, 'Asia/Kolkata'), false);
  // At 2026-11-17 00:00 IST (2026-11-16T18:30:00Z), 23:30-00:00 HAS expired
  const atMidnightIST = new Date('2026-11-16T18:30:00.000Z');
  assert.equal(isSlotEndExpired('2026-11-16', '23:30', '00:00', atMidnightIST, 'Asia/Kolkata'), true);

  // isSlotFutureOrActive filters out past booked slots and ongoing/future booked slots remain visible
  assert.equal(
    isSlotFutureOrActive(
      { slot_date: '2026-11-15', start_time: '09:00', end_time: '09:30', status: 'SOLD_OUT', booked_patients: 1 },
      at1430IST,
      'Asia/Kolkata',
    ),
    false,
  );
  assert.equal(
    isSlotFutureOrActive(
      { slot_date: '2026-11-16', start_time: '14:15', end_time: '14:45', status: 'SOLD_OUT', booked_patients: 1 },
      at1430IST,
      'Asia/Kolkata',
    ),
    true,
  );
});

test('getAppointmentsAwaitingOutcome selects only CONFIRMED appointments past slot end time', () => {
  // 2026-11-16 14:30 IST
  const now = new Date('2026-11-16T09:00:00.000Z');
  const pending = getAppointmentsAwaitingOutcome(
    [
      { appointment_id: 1, doctor_id: 2, status: 'CONFIRMED', slot_date: '2026-11-15', start_time: '10:00', end_time: '10:30' },
      { appointment_id: 2, doctor_id: 2, status: 'COMPLETED', slot_date: '2026-11-15', start_time: '11:00', end_time: '11:30' },
      { appointment_id: 3, doctor_id: 2, status: 'CONFIRMED', slot_date: '2026-11-16', start_time: '14:15', end_time: '14:45' },
      { appointment_id: 4, doctor_id: 2, status: 'HELD', slot_date: '2026-11-15', start_time: '09:00', end_time: '09:30' },
      { appointment_id: 5, doctor_id: 3, status: 'CONFIRMED', slot_date: '2026-11-16', start_time: '13:00', end_time: '13:30' },
      { appointment_id: 6, doctor_id: 2, status: 'CONFIRMED', slot_date: '2026-11-16', start_time: '14:00', end_time: '14:30' },
    ],
    2,
    now,
    'Asia/Kolkata',
  );
  assert.deepEqual(
    pending.map((a) => a.appointment_id),
    [1, 6],
  );
});

test('13:00-13:20 slot remains bookable and re-bookable until 13:20 IST and expires only at 13:20', () => {
  // 2026-11-22 13:10 IST = 2026-11-22 07:40 UTC
  const at1310IST = new Date('2026-11-22T07:40:00.000Z');
  // 2026-11-22 13:20 IST = 2026-11-22 07:50 UTC
  const at1320IST = new Date('2026-11-22T07:50:00.000Z');

  const middaySlot: Slot = {
    slot_id: 901,
    template_id: 1,
    slot_date: '2026-11-22',
    start_time: '13:00',
    end_time: '13:20',
    max_patients_per_slot: 1,
    booked_patients: 0,
    status: 'AVAILABLE',
  };

  assert.equal(isSlotEndExpired('2026-11-22', '13:00', '13:20', at1310IST, 'Asia/Kolkata'), false);
  assert.equal(isSlotFutureOrActive(middaySlot, at1310IST, 'Asia/Kolkata'), true);
  assert.deepEqual(
    filterBookableSlots([middaySlot], at1310IST, 'Asia/Kolkata').map((s) => s.slot_id),
    [901],
  );

  // At 13:20 IST (end_time reached), slot expires and is no longer bookable
  assert.equal(isSlotEndExpired('2026-11-22', '13:00', '13:20', at1320IST, 'Asia/Kolkata'), true);
  assert.equal(isSlotFutureOrActive(middaySlot, at1320IST, 'Asia/Kolkata'), false);
  assert.deepEqual(filterBookableSlots([middaySlot], at1320IST, 'Asia/Kolkata'), []);
});

test('mergeDayWorkingSlots matches doctor_id slots when template_id is null and templates array is empty', () => {
  const shift = makeShift([{ start_time: '09:00', end_time: '11:00' }], 30);
  const windows = buildWorkingHourWindows('2026-11-25', [], { shiftConfig: shift });
  const existing: Slot[] = [
    {
      slot_id: 501,
      doctor_id: 7,
      template_id: null,
      slot_date: '2026-11-25',
      start_time: '09:30',
      end_time: '10:00',
      max_patients_per_slot: 1,
      booked_patients: 0,
      status: 'AVAILABLE',
    },
  ];
  const merged = mergeDayWorkingSlots('2026-11-25', windows, existing);
  assert.equal(merged.length, 4);
  assert.equal(merged[0].status, 'UNCONFIRMED');
  assert.equal(merged[1].status, 'AVAILABLE');
  assert.equal(merged[1].existingSlot?.doctor_id, 7);
});


