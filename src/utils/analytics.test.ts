import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHistoricalAnalyticsSeed } from './analyticsSeed.ts';
import {
  buildAnalyticsCsv,
  computeHospitalAnalytics,
  deduplicateRescheduledRecords,
  filterAnalyticsRecords,
  formatMonthShort,
} from './analytics.ts';
import { formatPatientRegion, getLocalitiesForCity, normalizeRegionText } from './regions.ts';
import type { AnalyticsVisitRecord } from '../types/opd.ts';

test('historical analytics seed covers Nov 2025 through Nov 2026 with valid doctor, department, and region data', () => {
  const records = generateHistoricalAnalyticsSeed([], []);
  assert.ok(records.length >= 1400);

  const months = Array.from(new Set(records.map((r) => r.visit_month))).sort();
  assert.equal(months.length, 13);
  assert.equal(months[0], '2025-11');
  assert.equal(months[months.length - 1], '2026-11');

  for (const r of records) {
    assert.ok(r.doctor_name.startsWith('Dr. '));
    assert.ok(r.department_name.length > 0);
    assert.ok(r.city.length > 0);
    assert.ok(r.locality.length > 0);
    assert.equal(r.source, 'HISTORICAL');
  }
});

test('computeHospitalAnalytics ranks top doctor, department, city, locality and keeps peak totals aligned', () => {
  const records = generateHistoricalAnalyticsSeed([], []);
  const report = computeHospitalAnalytics(records);

  assert.equal(report.totalVisits, records.length);
  assert.equal(report.monthlyTrends.length, 13);
  assert.ok(report.topDoctor);
  assert.ok(report.topDepartment);
  assert.ok(report.topCity);
  assert.ok(report.topLocality);

  // Sum of monthly totals equals totalVisits
  const monthlyTotal = report.monthlyTrends.reduce((s, m) => s + m.total, 0);
  assert.equal(monthlyTotal, report.totalVisits);

  // Sum of peakDays equals totalVisits
  const dayTotal = report.peakDays.reduce((s, d) => s + d.count, 0);
  assert.equal(dayTotal, report.totalVisits);

  // Top doctors sorted descending by visits
  assert.ok(report.topDoctors[0].totalVisits >= report.topDoctors[1].totalVisits);
  assert.equal(report.topCity.city, 'Bengaluru');

  const csv = buildAnalyticsCsv(report);
  assert.ok(csv.includes('Top Doctor'));
  assert.ok(csv.includes('Top City'));
  assert.ok(csv.includes('Bengaluru'));
});

test('filterAnalyticsRecords scopes by source, month range, department, and city', () => {
  const records = generateHistoricalAnalyticsSeed([], []);
  const filtered = filterAnalyticsRecords(records, {
    source: 'HISTORICAL',
    fromMonth: '2026-01',
    toMonth: '2026-06',
    department: 'ALL',
    city: 'Mysuru',
  });

  assert.ok(filtered.length > 0);
  assert.ok(filtered.length < records.length);
  for (const r of filtered) {
    assert.equal(r.city, 'Mysuru');
    assert.ok(r.visit_month >= '2026-01' && r.visit_month <= '2026-06');
  }
});

test('region helpers normalize, list localities by city, and format display strings', () => {
  assert.equal(normalizeRegionText('  HSR   Layout '), 'HSR Layout');
  assert.equal(formatPatientRegion('Bengaluru', 'Indiranagar'), 'Indiranagar, Bengaluru');
  assert.equal(formatPatientRegion('Mysuru', ''), 'Mysuru');
  assert.equal(formatPatientRegion('', ''), '—');
  assert.ok(getLocalitiesForCity('bengaluru').includes('Indiranagar'));
  assert.deepEqual(getLocalitiesForCity('UnknownCity'), []);
  assert.equal(formatMonthShort('2025-11'), 'Nov 25');
  assert.equal(formatMonthShort('2026-11'), 'Nov 26');
});

test('consultation mode analytics excludes CANCELLED, deduplicates rescheduled records, and filters cleanly', () => {
  const sample: AnalyticsVisitRecord[] = [
    {
      id: 'LIVE-10',
      source: 'LIVE',
      visit_date: '2026-11-16',
      visit_month: '2026-11',
      start_time: '10:00',
      doctor_id: 2,
      doctor_name: 'Dr. Priya Sharma',
      department_id: 1,
      department_name: 'Neurology',
      specialization: 'Neurology',
      patient_id: 1,
      patient_name: 'John Doe',
      patient_gender: 'MALE',
      patient_age_group: '19-35',
      city: 'Bengaluru',
      locality: 'Indiranagar',
      status: 'CONFIRMED',
      booking_source: 'ONLINE',
      consultation_mode: 'ONLINE',
      payment_method: 'UPI',
      amount: 600,
    },
    {
      id: 'LIVE-11',
      source: 'LIVE',
      visit_date: '2026-11-16',
      visit_month: '2026-11',
      start_time: '11:00',
      doctor_id: 3,
      doctor_name: 'Dr. Anil Mehta',
      department_id: 2,
      department_name: 'Orthopedics',
      specialization: 'Ortho',
      patient_id: 22,
      patient_name: 'Amit Verma',
      patient_gender: 'MALE',
      patient_age_group: '36-55',
      city: 'Mysuru',
      locality: 'Vijayanagar',
      status: 'CANCELLED',
      booking_source: 'ONLINE',
      consultation_mode: 'ONLINE',
      payment_method: 'UNPAID',
      amount: 0,
    },
    {
      id: 'LIVE-12',
      source: 'LIVE',
      visit_date: '2026-11-16',
      visit_month: '2026-11',
      start_time: '12:00',
      doctor_id: 2,
      doctor_name: 'Dr. Priya Sharma',
      department_id: 1,
      department_name: 'Neurology',
      specialization: 'Neurology',
      patient_id: 23,
      patient_name: 'Sneha Reddy',
      patient_gender: 'FEMALE',
      patient_age_group: '19-35',
      city: 'Bengaluru',
      locality: 'Koramangala',
      status: 'CONFIRMED',
      booking_source: 'WALK_IN',
      consultation_mode: 'FACE_TO_FACE',
      payment_method: 'CASH',
      amount: 600,
    },
    {
      id: 'LIVE-13',
      source: 'LIVE',
      visit_date: '2026-11-17',
      visit_month: '2026-11',
      start_time: '14:00',
      doctor_id: 2,
      doctor_name: 'Dr. Priya Sharma',
      department_id: 1,
      department_name: 'Neurology',
      specialization: 'Neurology',
      patient_id: 23,
      patient_name: 'Sneha Reddy',
      patient_gender: 'FEMALE',
      patient_age_group: '19-35',
      city: 'Bengaluru',
      locality: 'Koramangala',
      status: 'CONFIRMED',
      booking_source: 'ONLINE',
      consultation_mode: 'ONLINE',
      rescheduled_from_id: 12,
      payment_method: 'UPI',
      amount: 600,
    },
  ];

  // LIVE-12 was rescheduled to LIVE-13 -> deduplicated out, leaving LIVE-10 (ONLINE), LIVE-11 (CANCELLED), LIVE-13 (ONLINE)
  const deduped = deduplicateRescheduledRecords(sample);
  assert.deepEqual(
    deduped.map((r) => r.id),
    ['LIVE-10', 'LIVE-11', 'LIVE-13'],
  );

  const report = computeHospitalAnalytics(sample);
  assert.equal(report.activeVisits, 2); // LIVE-10 and LIVE-13 (LIVE-11 CANCELLED excluded, LIVE-12 rescheduled out)
  assert.equal(report.onlineConsultations, 2);
  assert.equal(report.faceToFaceConsultations, 0);

  const onlineOnly = filterAnalyticsRecords(sample, {
    source: 'ALL',
    fromMonth: '',
    toMonth: '',
    department: 'ALL',
    city: 'ALL',
    consultationMode: 'ONLINE',
  });
  assert.equal(onlineOnly.length, 3);
});
