import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GlobalBranch,
  GlobalBranchDepartment,
  GlobalCountry,
  GlobalDoctorBranch,
  GlobalPatientProfile,
  GlobalPaymentBranchLink,
} from '../src/types/opd.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const GLOBAL_STORE_PATH = path.join(DATA_DIR, 'global_sidecar.json');

export interface GlobalSidecarStoreData {
  countries: GlobalCountry[];
  branches: GlobalBranch[];
  branch_departments: GlobalBranchDepartment[];
  doctor_branches: GlobalDoctorBranch[];
  slot_branch_map: Record<string, number>;
  appt_branch_map: Record<string, { branch_id: number; consultation_mode?: string }>;
  patient_profiles: Record<string, GlobalPatientProfile>;
  payment_branch_map: Record<string, GlobalPaymentBranchLink>;
}

const INITIAL_GLOBAL_SIDECAR: GlobalSidecarStoreData = {
  countries: [
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
    {
      country_id: 3,
      country_code: 'SG',
      country_name: 'Singapore',
      currency_code: 'SGD',
      currency_symbol: 'S$',
      phone_dial_code: '+65',
      default_timezone: 'Asia/Singapore',
      fx_rate_to_inr: 62.5,
      is_active: 'Y',
    },
    {
      country_id: 4,
      country_code: 'GB',
      country_name: 'United Kingdom',
      currency_code: 'GBP',
      currency_symbol: '£',
      phone_dial_code: '+44',
      default_timezone: 'Europe/London',
      fx_rate_to_inr: 106.4,
      is_active: 'Y',
    },
    {
      country_id: 5,
      country_code: 'US',
      country_name: 'United States',
      currency_code: 'USD',
      currency_symbol: '$',
      phone_dial_code: '+1',
      default_timezone: 'America/New_York',
      fx_rate_to_inr: 84.1,
      is_active: 'Y',
    },
  ],
  branches: [
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
      address_line: '12 MG Road, Indiranagar',
      postal_code: '560038',
      phone: '+91-80-4000-1000',
      email: 'hq-blr@carepulse.global',
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
      address_line: 'Building 64, Al Razi Medical Complex',
      postal_code: '505001',
      phone: '+971-4-500-2200',
      email: 'dubai@carepulse.global',
      timezone_iana: 'Asia/Dubai',
      currency_code: 'AED',
      is_headquarters: 'N',
      is_active: 'Y',
    },
    {
      branch_id: 3,
      country_id: 3,
      country_code: 'SG',
      country_name: 'Singapore',
      currency_symbol: 'S$',
      fx_rate_to_inr: 62.5,
      branch_code: 'SG-ORC-01',
      branch_name: 'CarePulse Singapore Orchard',
      city: 'Singapore',
      address_line: '290 Orchard Road, Paragon Medical',
      postal_code: '238859',
      phone: '+65-6500-3300',
      email: 'singapore@carepulse.global',
      timezone_iana: 'Asia/Singapore',
      currency_code: 'SGD',
      is_headquarters: 'N',
      is_active: 'Y',
    },
    {
      branch_id: 4,
      country_id: 4,
      country_code: 'GB',
      country_name: 'United Kingdom',
      currency_symbol: '£',
      fx_rate_to_inr: 106.4,
      branch_code: 'GB-LON-01',
      branch_name: 'CarePulse London Harley Street',
      city: 'London',
      address_line: '88 Harley Street, Marylebone',
      postal_code: 'W1G 7HR',
      phone: '+44-20-7946-0911',
      email: 'london@carepulse.global',
      timezone_iana: 'Europe/London',
      currency_code: 'GBP',
      is_headquarters: 'N',
      is_active: 'Y',
    },
    {
      branch_id: 5,
      country_id: 5,
      country_code: 'US',
      country_name: 'United States',
      currency_symbol: '$',
      fx_rate_to_inr: 84.1,
      branch_code: 'US-NYC-01',
      branch_name: 'CarePulse New York Midtown',
      city: 'New York',
      address_line: '535 Madison Avenue, Suite 400',
      postal_code: '10022',
      phone: '+1-212-555-0190',
      email: 'nyc@carepulse.global',
      timezone_iana: 'America/New_York',
      currency_code: 'USD',
      is_headquarters: 'N',
      is_active: 'Y',
    },
  ],
  branch_departments: [
    { branch_dept_id: 1, branch_id: 1, department_id: 1, is_specialized: 'Y', local_consultation_fee: 800, is_active: 'Y' },
    { branch_dept_id: 2, branch_id: 1, department_id: 2, is_specialized: 'N', local_consultation_fee: 600, is_active: 'Y' },
    { branch_dept_id: 3, branch_id: 2, department_id: 1, is_specialized: 'Y', local_consultation_fee: 240, is_active: 'Y' },
    { branch_dept_id: 4, branch_id: 3, department_id: 1, is_specialized: 'Y', local_consultation_fee: 110, is_active: 'Y' },
    { branch_dept_id: 5, branch_id: 3, department_id: 2, is_specialized: 'Y', local_consultation_fee: 95, is_active: 'Y' },
    { branch_dept_id: 6, branch_id: 4, department_id: 1, is_specialized: 'Y', local_consultation_fee: 85, is_active: 'Y' },
    { branch_dept_id: 7, branch_id: 5, department_id: 2, is_specialized: 'Y', local_consultation_fee: 140, is_active: 'Y' },
  ],
  doctor_branches: [
    { doc_branch_id: 1, doctor_id: 2, branch_id: 1, is_primary_branch: 'Y', local_consultation_fee: 800, is_active: 'Y' },
    { doc_branch_id: 2, doctor_id: 2, branch_id: 2, is_primary_branch: 'N', local_consultation_fee: 250, is_active: 'Y' },
    { doc_branch_id: 3, doctor_id: 2, branch_id: 3, is_primary_branch: 'N', local_consultation_fee: 115, is_active: 'Y' },
    { doc_branch_id: 4, doctor_id: 3, branch_id: 1, is_primary_branch: 'Y', local_consultation_fee: 600, is_active: 'Y' },
    { doc_branch_id: 5, doctor_id: 3, branch_id: 5, is_primary_branch: 'N', local_consultation_fee: 145, is_active: 'Y' },
    { doc_branch_id: 6, doctor_id: 4, branch_id: 1, is_primary_branch: 'Y', local_consultation_fee: 700, is_active: 'Y' },
    { doc_branch_id: 7, doctor_id: 4, branch_id: 4, is_primary_branch: 'N', local_consultation_fee: 85, is_active: 'Y' },
  ],
  slot_branch_map: {},
  appt_branch_map: {},
  patient_profiles: {},
  payment_branch_map: {},
};

export function readGlobalStore(): GlobalSidecarStoreData {
  try {
    if (fs.existsSync(GLOBAL_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(GLOBAL_STORE_PATH, 'utf8')) as Partial<GlobalSidecarStoreData>;
      return {
        countries: Array.isArray(parsed.countries) && parsed.countries.length > 0 ? parsed.countries : [...INITIAL_GLOBAL_SIDECAR.countries],
        branches: Array.isArray(parsed.branches) && parsed.branches.length > 0 ? parsed.branches : [...INITIAL_GLOBAL_SIDECAR.branches],
        branch_departments: Array.isArray(parsed.branch_departments) ? parsed.branch_departments : [...INITIAL_GLOBAL_SIDECAR.branch_departments],
        doctor_branches: Array.isArray(parsed.doctor_branches) ? parsed.doctor_branches : [...INITIAL_GLOBAL_SIDECAR.doctor_branches],
        slot_branch_map: parsed.slot_branch_map && typeof parsed.slot_branch_map === 'object' ? parsed.slot_branch_map : {},
        appt_branch_map: parsed.appt_branch_map && typeof parsed.appt_branch_map === 'object' ? parsed.appt_branch_map : {},
        patient_profiles: parsed.patient_profiles && typeof parsed.patient_profiles === 'object' ? parsed.patient_profiles : {},
        payment_branch_map: parsed.payment_branch_map && typeof parsed.payment_branch_map === 'object' ? parsed.payment_branch_map : {},
      };
    }
  } catch {
    // Fall back to initial seed
  }
  return structuredClone(INITIAL_GLOBAL_SIDECAR);
}

export function writeGlobalStore(data: GlobalSidecarStoreData): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Ignore read-only filesystem edge cases
  }
}

export function getNextNumericId(items: Array<{ [key: string]: unknown }>, key: string): number {
  let max = 0;
  for (const item of items) {
    const val = Number(item[key] || 0);
    if (val > max) max = val;
  }
  return max + 1;
}
