import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBranchUtilisation,
  convertInrToBranchCurrency,
  enrichAppointmentsWithBranch,
  enrichPaymentsWithBranch,
  enrichSlotsWithBranch,
  filterDepartmentsByBranch,
  filterDoctorsByBranch,
  getDoctorEffectiveBranchFee,
  resolveBranchForRecord,
} from './globalBranch.ts';
import type {
  Appointment,
  Department,
  Doctor,
  GlobalBranch,
  GlobalBranchDepartment,
  GlobalCountry,
  GlobalDoctorBranch,
  GlobalPaymentBranchLink,
  Payment,
  Slot,
} from '../types/opd.ts';

const COUNTRIES: GlobalCountry[] = [
  {
    country_id: 1,
    country_code: 'IN',
    country_name: 'India',
    currency_code: 'INR',
    currency_symbol: '₹',
    phone_dial_code: '+91',
    default_timezone: 'Asia/Kolkata',
    fx_rate_to_inr: 1,
    is_active: 'Y',
  },
  {
    country_id: 2,
    country_code: 'AE',
    country_name: 'United Arab Emirates',
    currency_code: 'AED',
    currency_symbol: 'AED',
    phone_dial_code: '+971',
    default_timezone: 'Asia/Dubai',
    fx_rate_to_inr: 22.85,
    is_active: 'Y',
  },
];

const BRANCHES: GlobalBranch[] = [
  {
    branch_id: 1,
    country_id: 1,
    country_code: 'IN',
    country_name: 'India',
    currency_symbol: '₹',
    fx_rate_to_inr: 1,
    branch_code: 'IN-BLR-HQ',
    branch_name: 'CarePulse Bengaluru Headquarters',
    city: 'Bengaluru',
    timezone_iana: 'Asia/Kolkata',
    currency_code: 'INR',
    is_headquarters: 'Y',
    is_active: 'Y',
  },
  {
    branch_id: 2,
    country_id: 2,
    country_code: 'AE',
    country_name: 'United Arab Emirates',
    currency_symbol: 'AED',
    fx_rate_to_inr: 22.85,
    branch_code: 'AE-DXB-01',
    branch_name: 'CarePulse Dubai Healthcare City',
    city: 'Dubai',
    timezone_iana: 'Asia/Dubai',
    currency_code: 'AED',
    is_headquarters: 'N',
    is_active: 'Y',
  },
];

const DEPARTMENTS: Department[] = [
  { department_id: 1, department_name: 'Neuroscience', is_active: 'Y' },
  { department_id: 2, department_name: 'Orthopedics', is_active: 'Y' },
];

const DOCTORS: Doctor[] = [
  {
    doctor_id: 2,
    department_id: 1,
    first_name: 'Priya',
    last_name: 'Sharma',
    consultation_fee: 800,
    tele_consult_flag: 'Y',
    is_active: 'Y',
  },
  {
    doctor_id: 3,
    department_id: 2,
    first_name: 'Anil',
    last_name: 'Mehta',
    consultation_fee: 600,
    tele_consult_flag: 'N',
    is_active: 'Y',
  },
];

const BRANCH_DEPTS: GlobalBranchDepartment[] = [
  { branch_id: 2, department_id: 1, is_specialized: 'Y', local_consultation_fee: 240, is_active: 'Y' },
];

const DOC_BRANCHES: GlobalDoctorBranch[] = [
  { doctor_id: 2, branch_id: 1, is_primary_branch: 'Y', local_consultation_fee: 800, is_active: 'Y' },
  { doctor_id: 2, branch_id: 2, is_primary_branch: 'N', local_consultation_fee: 250, is_active: 'Y' },
];

test('unlinked legacy/voice records resolve cleanly to Headquarters (HQ_DEFAULT)', () => {
  const meta = resolveBranchForRecord(undefined, BRANCHES, COUNTRIES);
  assert.equal(meta?.branch_id, 1);
  assert.equal(meta?.branch_code, 'IN-BLR-HQ');
  assert.equal(meta?.resolution, 'HQ_DEFAULT');

  const linked = resolveBranchForRecord(2, BRANCHES, COUNTRIES);
  assert.equal(linked?.branch_code, 'AE-DXB-01');
  assert.equal(linked?.resolution, 'LINKED');
});

test('branch filtering isolates specialized departments and multi-branch doctors', () => {
  const dubaiDepts = filterDepartmentsByBranch(DEPARTMENTS, BRANCH_DEPTS, 2, BRANCHES);
  assert.equal(dubaiDepts.length, 1);
  assert.equal(dubaiDepts[0].department_name, 'Neuroscience');
  assert.equal(dubaiDepts[0].is_specialized, true);

  const dubaiDocs = filterDoctorsByBranch(DOCTORS, DOC_BRANCHES, 2, BRANCHES);
  assert.equal(dubaiDocs.length, 1);
  assert.equal(dubaiDocs[0].doctor_id, 2);
  assert.equal(dubaiDocs[0].is_primary_branch, false);

  // HQ includes mapped HQ doctors and unmapped legacy doctors
  const hqDocs = filterDoctorsByBranch(DOCTORS, DOC_BRANCHES, 1, BRANCHES);
  assert.equal(hqDocs.length, 2);
});

test('branch fee calculation prefers doctor-branch override then dept-branch then FX conversion', () => {
  const fee = getDoctorEffectiveBranchFee({
    doctor: DOCTORS[0],
    branch: BRANCHES[1],
    countries: COUNTRIES,
    doctorBranches: DOC_BRANCHES,
    branchDepartments: BRANCH_DEPTS,
  });
  assert.equal(fee.currency_code, 'AED');
  assert.equal(fee.local_amount, 250);
  assert.equal(fee.base_inr_amount, 800);

  const fxFallback = convertInrToBranchCurrency(800, 22.85, 'AED');
  assert.equal(fxFallback, 35.01);
});

test('utilisation computation aggregates HQ fallback and branch-linked records accurately', () => {
  const slots: Slot[] = [
    {
      slot_id: 10,
      doctor_id: 3,
      slot_date: '2026-11-30',
      start_time: '09:00',
      end_time: '09:30',
      max_patients_per_slot: 1,
      booked_patients: 1,
      status: 'SOLD_OUT',
    },
    {
      slot_id: 11,
      doctor_id: 2,
      slot_date: '2026-11-30',
      start_time: '10:00',
      end_time: '10:30',
      max_patients_per_slot: 1,
      booked_patients: 1,
      status: 'SOLD_OUT',
    },
  ];
  const appts: Appointment[] = [
    {
      appointment_id: 100,
      appointment_ref: 'APT_LEGACY',
      patient_id: 1,
      patient_name: 'Legacy Patient',
      slot_id: 10,
      status: 'CONFIRMED',
    },
    {
      appointment_id: 101,
      appointment_ref: 'APT_DUBAI',
      patient_id: 1,
      patient_name: 'Dubai Patient',
      slot_id: 11,
      status: 'COMPLETED',
    },
  ];
  const payments: Payment[] = [
    {
      payment_id: 500,
      appointment_id: 100,
      appointment_ref: 'APT_LEGACY',
      payment_ref: 'PAY_LEGACY',
      amount: 600,
      status: 'SUCCESS',
      created_on: '2026-11-26T10:00:00Z',
    },
    {
      payment_id: 501,
      appointment_id: 101,
      appointment_ref: 'APT_DUBAI',
      payment_ref: 'PAY_DUBAI',
      amount: 800,
      status: 'SUCCESS',
      created_on: '2026-11-26T10:00:00Z',
    },
  ];

  const slotBranchMap = { '11': 2 };
  const apptBranchMap = { '101': { branch_id: 2 } };
  const payBranchMap: Record<string, GlobalPaymentBranchLink> = {
    '101': {
      payment_id: 501,
      appointment_id: 101,
      branch_id: 2,
      local_currency: 'AED',
      local_amount: 250,
      base_inr_amount: 800,
      fx_rate_to_inr: 22.85,
    },
  };

  const enrichedSlots = enrichSlotsWithBranch(slots, slotBranchMap, BRANCHES, COUNTRIES);
  const enrichedAppts = enrichAppointmentsWithBranch(
    appts,
    apptBranchMap,
    slotBranchMap,
    payBranchMap,
    BRANCHES,
    COUNTRIES,
  );
  const enrichedPays = enrichPaymentsWithBranch(
    payments,
    payBranchMap,
    apptBranchMap,
    BRANCHES,
    COUNTRIES,
  );

  const util = computeBranchUtilisation({
    branches: BRANCHES,
    countries: COUNTRIES,
    slots: enrichedSlots,
    appointments: enrichedAppts,
    payments: enrichedPays,
    doctorBranches: DOC_BRANCHES,
    branchDepartments: BRANCH_DEPTS,
  });

  const hqRow = util.find((u) => u.branch_id === 1)!;
  const dxbRow = util.find((u) => u.branch_id === 2)!;
  assert.equal(hqRow.total_appointments, 1);
  assert.equal(hqRow.total_local_revenue, 600);
  assert.equal(dxbRow.total_appointments, 1);
  assert.equal(dxbRow.completed_appointments, 1);
  assert.equal(dxbRow.total_local_revenue, 250);
  assert.equal(dxbRow.specialized_departments, 1);
});
