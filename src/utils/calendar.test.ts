import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysIso,
  buildWorkingHourWindows,
  doesDoctorNeedDailySlotsPrompt,
  formatShiftSummary,
  getMonthGridDates,
  getWeekdayName,
  isDateCoveredByApprovedLeave,
  mergeDayWorkingSlots,
} from './calendar';
import type { DoctorLeave, DoctorShiftConfig, Slot, SlotTemplate } from '../types/opd';

test('getMonthGridDates returns 42 cells with accurate today and past flags', () => {
  const cells = getMonthGridDates(2026, 10, '2026-11-14'); // Nov 2026
  assert.equal(cells.length, 42);
  const nov14 = cells.find((c) => c.isoDate === '2026-11-14');
  const nov13 = cells.find((c) => c.isoDate === '2026-11-13');
  const nov16 = cells.find((c) => c.isoDate === '2026-11-16');
  assert.ok(nov14);
  assert.equal(nov14.isToday, true);
  assert.equal(nov14.isPast, false);
  assert.equal(nov14.weekday, 'SATURDAY');
  assert.equal(nov13?.isPast, true);
  assert.equal(nov16?.isPast, false);
  assert.equal(getWeekdayName('2026-11-16'), 'MONDAY');
  assert.equal(addDaysIso('2026-11-14', 6), '2026-11-20');
});

test('buildWorkingHourWindows generates slots from matching template or default working hours', () => {
  const templates: SlotTemplate[] = [
    {
      template_id: 10,
      doctor_id: 2,
      day_of_week: 'MONDAY',
      start_time: '09:00',
      end_time: '11:00',
      slot_duration_mins: 30,
      max_patients_per_slot: 1,
      is_active: 'Y',
    },
    {
      template_id: 11,
      doctor_id: 2,
      day_of_week: 'MONDAY',
      start_time: '14:00',
      end_time: '15:00',
      slot_duration_mins: 30,
      max_patients_per_slot: 1,
      is_active: 'Y',
    },
  ];

  // Monday uses matching templates (4 morning + 2 afternoon = 6 windows)
  const monWindows = buildWorkingHourWindows('2026-11-16', templates);
  assert.equal(monWindows.length, 6);
  assert.equal(monWindows[0].start_time, '09:00');
  assert.equal(monWindows[0].template_id, 10);
  assert.equal(monWindows[5].start_time, '14:30');
  assert.equal(monWindows[5].template_id, 11);

  // Saturday (no template for SATURDAY) still gets working-hours slots derived from doctor schedule
  const satWindows = buildWorkingHourWindows('2026-11-14', templates);
  assert.equal(satWindows.length, 6);
  assert.equal(satWindows[0].source, 'working_hours');
});

test('mergeDayWorkingSlots tracks UNCONFIRMED, AVAILABLE, BOOKED, and extra custom slots', () => {
  const windows = buildWorkingHourWindows('2026-11-16', [], {
    workStart: '09:00',
    workEnd: '10:00',
    durationMins: 30,
  });
  const slots: Slot[] = [
    {
      slot_id: 1,
      template_id: 10,
      slot_date: '2026-11-16T00:00:00Z',
      start_time: '09:00',
      end_time: '09:30',
      max_patients_per_slot: 1,
      booked_patients: 1,
      status: 'SOLD_OUT',
    },
    {
      slot_id: 2,
      template_id: 10,
      slot_date: '2026-11-16T00:00:00Z',
      start_time: '17:00',
      end_time: '17:20',
      max_patients_per_slot: 1,
      booked_patients: 0,
      status: 'AVAILABLE',
    },
  ];
  const merged = mergeDayWorkingSlots('2026-11-16', windows, slots);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].status, 'BOOKED');
  assert.equal(merged[1].status, 'UNCONFIRMED');
  assert.equal(merged[2].start_time, '17:00');
  assert.equal(merged[2].status, 'AVAILABLE');
});

test('doesDoctorNeedDailySlotsPrompt requires daily slots unless on approved leave', () => {
  const leaves: DoctorLeave[] = [
    {
      leave_id: 1,
      doctor_id: 2,
      requested_by: 21,
      start_date: '2026-11-20T00:00:00Z',
      end_date: '2026-11-21T00:00:00Z',
      leave_status: 'APPROVED',
    },
  ];
  assert.equal(isDateCoveredByApprovedLeave('2026-11-20', leaves, 2), true);
  assert.equal(isDateCoveredByApprovedLeave('2026-11-14', leaves, 2), false);

  // 0 slots today -> prompt required
  assert.equal(doesDoctorNeedDailySlotsPrompt([], leaves, 2, '2026-11-14'), true);

  // On approved leave -> prompt not required
  assert.equal(doesDoctorNeedDailySlotsPrompt([], leaves, 2, '2026-11-20'), false);

  // Has an available slot today -> prompt satisfied
  const todaySlot: Slot = {
    slot_id: 99,
    template_id: 10,
    doctor_id: 2,
    slot_date: '2026-11-14T00:00:00Z',
    start_time: '09:00',
    end_time: '09:30',
    max_patients_per_slot: 1,
    booked_patients: 0,
    status: 'AVAILABLE',
  };
  assert.equal(doesDoctorNeedDailySlotsPrompt([todaySlot], leaves, 2, '2026-11-14'), false);
});

test('buildWorkingHourWindows respects per-doctor shiftConfig sessions and duration', () => {
  const shiftConfig: DoctorShiftConfig = {
    doctor_id: 5,
    sessions: [
      { start_time: '08:00', end_time: '10:00' },
      { start_time: '15:00', end_time: '16:30' },
    ],
    slot_duration_mins: 30,
    working_days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    is_registered: true,
  };
  assert.equal(
    formatShiftSummary(shiftConfig.sessions, shiftConfig.slot_duration_mins),
    '08:00–10:00 · 15:00–16:30 (30 min)',
  );
  const windows = buildWorkingHourWindows('2026-11-15', [], { shiftConfig });
  assert.equal(windows.length, 7); // 4 morning + 3 afternoon
  assert.equal(windows[0].start_time, '08:00');
  assert.equal(windows[4].start_time, '15:00');
  assert.equal(windows[6].end_time, '16:30');
});
