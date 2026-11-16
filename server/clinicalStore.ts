import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MedicalRecordEntry, PrescriptionEntry } from '../src/types/opd.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CLINICAL_PATH = path.join(DATA_DIR, 'clinical_records.json');

interface ClinicalStoreData {
  medical_records: MedicalRecordEntry[];
  prescriptions: PrescriptionEntry[];
}

const INITIAL_CLINICAL_DATA: ClinicalStoreData = {
  medical_records: [
    {
      record_id: 'MR-1001',
      patient_id: 1,
      patient_name: 'John Doe',
      doctor_id: 2,
      doctor_name: 'Dr. Priya Sharma',
      appointment_ref: 'APT-2026-001',
      visit_date: '2026-11-10',
      chief_complaint: 'Intermittent tension headaches and morning dizziness for 5 days',
      diagnosis: 'Primary Tension-Type Headache / Mild Cervical Strain',
      vitals_summary: 'BP 118/76 mmHg · Pulse 74 bpm · Temp 98.4°F · SpO2 99%',
      clinical_notes:
        'Neurological exam intact; cranial nerves II-XII normal. Advised hydration, screen ergonomics, and follow-up if aura or photophobia develops.',
      updated_at: '2026-11-10T10:30:00.000Z',
    },
    {
      record_id: 'MR-1002',
      patient_id: 22,
      patient_name: 'Amit Verma',
      doctor_id: 3,
      doctor_name: 'Dr. Anil Mehta',
      appointment_ref: 'APT-2026-014',
      visit_date: '2026-11-12',
      chief_complaint: 'Right knee stiffness and pain when climbing stairs',
      diagnosis: 'Early Patellofemoral Chondromalacia',
      vitals_summary: 'BP 124/80 mmHg · Pulse 78 bpm · BMI 24.6',
      clinical_notes:
        'Mild crepitus on extension without joint effusion. Recommended quadriceps strengthening physiotherapy for 3 weeks and reduced high-impact running.',
      updated_at: '2026-11-12T11:45:00.000Z',
    },
    {
      record_id: 'MR-1003',
      patient_id: 23,
      patient_name: 'Sneha Reddy',
      doctor_id: 2,
      doctor_name: 'Dr. Priya Sharma',
      appointment_ref: 'APT-2026-019',
      visit_date: '2026-11-14',
      chief_complaint: 'Recurring migraine episodes triggered by sleep disruption',
      diagnosis: 'Episodic Migraine without Aura',
      vitals_summary: 'BP 112/72 mmHg · Pulse 70 bpm · SpO2 99%',
      clinical_notes:
        'Reviewed trigger diary. Prescribed acute abortive therapy and regular sleep hygiene routine. Schedule review after 14 days.',
      updated_at: '2026-11-14T15:10:00.000Z',
    },
    {
      record_id: 'MR-1004',
      patient_id: 61,
      patient_name: 'Arjun Nair',
      doctor_id: 3,
      doctor_name: 'Dr. Anil Mehta',
      appointment_ref: 'APT-2026-022',
      visit_date: '2026-11-15',
      chief_complaint: 'Post-sprain left ankle follow-up evaluation',
      diagnosis: 'Recovering Grade I Lateral Ankle Sprain',
      vitals_summary: 'BP 120/78 mmHg · Pulse 72 bpm · Temp 98.2°F',
      clinical_notes:
        'Swelling markedly subsided; full weight-bearing achieved without antalgic gait. Cleared for light walking and gradual ankle proprioception exercises.',
      updated_at: '2026-11-15T16:20:00.000Z',
    },
  ],
  prescriptions: [
    {
      prescription_id: 'RX-2001',
      patient_id: 1,
      patient_name: 'John Doe',
      doctor_id: 2,
      doctor_name: 'Dr. Priya Sharma',
      appointment_ref: 'APT-2026-001',
      prescribed_date: '2026-11-10',
      diagnosis: 'Primary Tension-Type Headache',
      medications: [
        {
          name: 'Paracetamol 650mg',
          dosage: '1 tablet',
          frequency: 'SOS (max 3/day)',
          duration: '5 days',
        },
        {
          name: 'Magnesium Glycinate 200mg',
          dosage: '1 capsule',
          frequency: 'Once nightly',
          duration: '14 days',
        },
      ],
      instructions: 'Take after meals with water. Maintain 2.5L daily fluid intake and 15-minute screen breaks.',
      status: 'ACTIVE',
      updated_at: '2026-11-10T10:35:00.000Z',
    },
    {
      prescription_id: 'RX-2002',
      patient_id: 22,
      patient_name: 'Amit Verma',
      doctor_id: 3,
      doctor_name: 'Dr. Anil Mehta',
      appointment_ref: 'APT-2026-014',
      prescribed_date: '2026-11-12',
      diagnosis: 'Early Patellofemoral Chondromalacia',
      medications: [
        {
          name: 'Diclofenac Gel 1%',
          dosage: 'Topical thin layer',
          frequency: 'Twice daily',
          duration: '10 days',
        },
        {
          name: 'Calcium + Vitamin D3',
          dosage: '1 tablet',
          frequency: 'Once daily after lunch',
          duration: '30 days',
        },
      ],
      instructions: 'Apply topical gel gently around knee cap without vigorous massage. Continue isometric quad sets.',
      status: 'ACTIVE',
      updated_at: '2026-11-12T11:50:00.000Z',
    },
    {
      prescription_id: 'RX-2003',
      patient_id: 23,
      patient_name: 'Sneha Reddy',
      doctor_id: 2,
      doctor_name: 'Dr. Priya Sharma',
      appointment_ref: 'APT-2026-019',
      prescribed_date: '2026-11-14',
      diagnosis: 'Episodic Migraine without Aura',
      medications: [
        {
          name: 'Sumatriptan 50mg',
          dosage: '1 tablet',
          frequency: 'At headache onset (max 2/day)',
          duration: 'As needed',
        },
        {
          name: 'Riboflavin (Vit B2) 400mg',
          dosage: '1 capsule',
          frequency: 'Once daily morning',
          duration: '30 days',
        },
      ],
      instructions: 'Rest in a quiet dark room after taking abortive dose. Avoid skipping meals.',
      status: 'ACTIVE',
      updated_at: '2026-11-14T15:15:00.000Z',
    },
  ],
};

export function readClinicalStore(): ClinicalStoreData {
  try {
    if (!fs.existsSync(CLINICAL_PATH)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CLINICAL_PATH, JSON.stringify(INITIAL_CLINICAL_DATA, null, 2), 'utf8');
      return INITIAL_CLINICAL_DATA;
    }
    const parsed = JSON.parse(fs.readFileSync(CLINICAL_PATH, 'utf8')) as Partial<ClinicalStoreData>;
    return {
      medical_records: Array.isArray(parsed.medical_records)
        ? parsed.medical_records
        : INITIAL_CLINICAL_DATA.medical_records,
      prescriptions: Array.isArray(parsed.prescriptions)
        ? parsed.prescriptions
        : INITIAL_CLINICAL_DATA.prescriptions,
    };
  } catch {
    return INITIAL_CLINICAL_DATA;
  }
}

export function writeClinicalStore(data: ClinicalStoreData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CLINICAL_PATH, JSON.stringify(data, null, 2), 'utf8');
}
