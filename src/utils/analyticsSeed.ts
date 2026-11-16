import type { AnalyticsVisitRecord, Department, Doctor } from '../types/opd.ts';

interface HistoricalPatientTemplate {
  patient_id: number;
  name: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  age_group: '0-18' | '19-35' | '36-55' | '56+';
  city: string;
  locality: string;
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, items: Array<{ item: T; weight: number }>): T {
  const total = items.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = rng() * total;
  for (const entry of items) {
    threshold -= entry.weight;
    if (threshold <= 0) return entry.item;
  }
  return items[items.length - 1].item;
}

const FIRST_NAMES_MALE = [
  'Aarav', 'Rohan', 'Karthik', 'Siddharth', 'Vivek', 'Aditya', 'Pranav', 'Nikhil',
  'Manoj', 'Suresh', 'Deepak', 'Varun', 'Harish', 'Gaurav', 'Chetan', 'Rakesh',
  'Tejas', 'Naveen', 'Santosh', 'Abhishek', 'Tarun', 'Kiran', 'Ashwin', 'Yash',
];

const FIRST_NAMES_FEMALE = [
  'Ananya', 'Divya', 'Kavya', 'Megha', 'Nandini', 'Pooja', 'Shruti', 'Swathi',
  'Rashmi', 'Lakshmi', 'Bhavana', 'Deepika', 'Aishwarya', 'Pavithra', 'Spoorthi',
  'Keerthi', 'Pallavi', 'Vaishnavi', 'Archana', 'Rekha', 'Neha', 'Sindhu',
];

const LAST_NAMES = [
  'Sharma', 'Rao', 'Nair', 'Kulkarni', 'Reddy', 'Patel', 'Deshpande', 'Joshi',
  'Hegde', 'Bhat', 'Shetty', 'Gowda', 'Menon', 'Iyer', 'Verma', 'Gupta',
  'Murthy', 'Kamath', 'Prasad', 'Chaudhary', 'Agarwal', 'Krishnan',
];

const REGIONAL_WEIGHTS: Array<{ city: string; weight: number; localities: Array<{ name: string; weight: number }> }> = [
  {
    city: 'Bengaluru',
    weight: 56,
    localities: [
      { name: 'Indiranagar', weight: 18 },
      { name: 'Koramangala', weight: 16 },
      { name: 'Whitefield', weight: 15 },
      { name: 'Jayanagar', weight: 13 },
      { name: 'HSR Layout', weight: 12 },
      { name: 'Malleshwaram', weight: 9 },
      { name: 'JP Nagar', weight: 7 },
      { name: 'Hebbal', weight: 6 },
      { name: 'Electronic City', weight: 4 },
    ],
  },
  {
    city: 'Mysuru',
    weight: 14,
    localities: [
      { name: 'Vijayanagar', weight: 34 },
      { name: 'Kuvempunagar', weight: 28 },
      { name: 'Gokulam', weight: 22 },
      { name: 'Saraswathipuram', weight: 16 },
    ],
  },
  {
    city: 'Hyderabad',
    weight: 10,
    localities: [
      { name: 'Gachibowli', weight: 35 },
      { name: 'Madhapur', weight: 28 },
      { name: 'Banjara Hills', weight: 20 },
      { name: 'Kondapur', weight: 17 },
    ],
  },
  {
    city: 'Mumbai',
    weight: 8,
    localities: [
      { name: 'Bandra', weight: 30 },
      { name: 'Andheri', weight: 28 },
      { name: 'Powai', weight: 24 },
      { name: 'Dadar', weight: 18 },
    ],
  },
  {
    city: 'Pune',
    weight: 7,
    localities: [
      { name: 'Koregaon Park', weight: 32 },
      { name: 'Kothrud', weight: 28 },
      { name: 'Baner', weight: 22 },
      { name: 'Viman Nagar', weight: 18 },
    ],
  },
  {
    city: 'Chennai',
    weight: 5,
    localities: [
      { name: 'Adyar', weight: 34 },
      { name: 'Anna Nagar', weight: 30 },
      { name: 'Velachery', weight: 20 },
      { name: 'Mylapore', weight: 16 },
    ],
  },
];

// Monthly volume multiplier from 2025-11 through 2026-11 (seasonal clinical curve)
const MONTHLY_TARGET_COUNTS: Array<{ month: string; days: number; targetVisits: number }> = [
  { month: '2025-11', days: 30, targetVisits: 92 },
  { month: '2025-12', days: 31, targetVisits: 108 },
  { month: '2026-01', days: 31, targetVisits: 118 },
  { month: '2026-02', days: 28, targetVisits: 96 },
  { month: '2026-03', days: 31, targetVisits: 106 },
  { month: '2026-04', days: 30, targetVisits: 102 },
  { month: '2026-05', days: 31, targetVisits: 112 },
  { month: '2026-06', days: 30, targetVisits: 120 },
  { month: '2026-07', days: 31, targetVisits: 134 },
  { month: '2026-08', days: 31, targetVisits: 138 },
  { month: '2026-09', days: 30, targetVisits: 126 },
  { month: '2026-10', days: 31, targetVisits: 132 },
  { month: '2026-11', days: 15, targetVisits: 68 },
];

const FALLBACK_DOCTORS: Doctor[] = [
  { doctor_id: 2, department_id: 21, first_name: 'Priya', last_name: 'Sharma', specialization: 'Electrophysiology', consultation_fee: 600, tele_consult_flag: 'Y', is_active: 'Y' },
  { doctor_id: 3, department_id: 2, first_name: 'Anil', last_name: 'Mehta', specialization: 'Joint Replacement', consultation_fee: 450, tele_consult_flag: 'Y', is_active: 'Y' },
  { doctor_id: 4, department_id: 3, first_name: 'Sneha', last_name: 'Patel', specialization: 'Cosmetic Dermatology', consultation_fee: 400, tele_consult_flag: 'Y', is_active: 'Y' },
  { doctor_id: 5, department_id: 4, first_name: 'Vikram', last_name: 'Rao', specialization: 'Internal Medicine', consultation_fee: 300, tele_consult_flag: 'Y', is_active: 'Y' },
  { doctor_id: 21, department_id: 21, first_name: 'Arjun', last_name: 'Nair', specialization: 'Neurology', consultation_fee: 800, tele_consult_flag: 'N', is_active: 'Y' },
  { doctor_id: 46, department_id: 3, first_name: 'Rohit', last_name: 'Ramachandra', specialization: 'Dermatology', consultation_fee: 800, tele_consult_flag: 'Y', is_active: 'Y' },
  { doctor_id: 61, department_id: 5, first_name: 'Suhas', last_name: 'G', specialization: 'General Pediatrics', consultation_fee: 500, tele_consult_flag: 'Y', is_active: 'Y' },
];

const TIME_SLOTS_WEIGHTED = [
  { item: '09:00', weight: 14 },
  { item: '09:30', weight: 15 },
  { item: '10:00', weight: 17 },
  { item: '10:30', weight: 16 },
  { item: '11:00', weight: 13 },
  { item: '11:30', weight: 9 },
  { item: '14:00', weight: 6 },
  { item: '15:00', weight: 5 },
  { item: '16:00', weight: 5 },
];

export function generateHistoricalAnalyticsSeed(
  doctorsInput: Doctor[],
  departmentsInput: Department[],
): AnalyticsVisitRecord[] {
  const rng = createMulberry32(20251101);
  const doctors = (doctorsInput.length > 0 ? doctorsInput : FALLBACK_DOCTORS).filter(
    (d) => d.is_active !== 'N',
  );
  const deptNameMap = new Map<number, string>(
    departmentsInput.map((d) => [d.department_id, d.department_name]),
  );
  // Ensure any fallback/legacy dept IDs resolve cleanly
  const fallbackDeptNames: Record<number, string> = {
    1: 'Neuroscience',
    2: 'Orthopedics',
    3: 'Dermatology',
    4: 'General Medicine',
    5: 'Pediatrics',
    21: 'Neurology',
    81: 'Radiology',
  };

  // Build 260 recurring historical patients across cities & localities
  const patientPool: HistoricalPatientTemplate[] = [];
  for (let i = 1; i <= 260; i++) {
    const gender = pickWeighted<'MALE' | 'FEMALE' | 'OTHER'>(rng, [
      { item: 'FEMALE', weight: 49 },
      { item: 'MALE', weight: 48 },
      { item: 'OTHER', weight: 3 },
    ]);
    const age_group = pickWeighted<'0-18' | '19-35' | '36-55' | '56+'>(rng, [
      { item: '0-18', weight: 16 },
      { item: '19-35', weight: 35 },
      { item: '36-55', weight: 31 },
      { item: '56+', weight: 18 },
    ]);
    const firstPool = gender === 'FEMALE' ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE;
    const first = firstPool[Math.floor(rng() * firstPool.length)];
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
    const region = pickWeighted(
      rng,
      REGIONAL_WEIGHTS.map((r) => ({ item: r, weight: r.weight })),
    );
    const locality = pickWeighted(
      rng,
      region.localities.map((l) => ({ item: l.name, weight: l.weight })),
    );

    patientPool.push({
      patient_id: 9000 + i,
      name: `${first} ${last}`,
      gender,
      age_group,
      city: region.city,
      locality,
    });
  }

  // Assign distinct realistic doctor demand weights so top-doctor rankings are clear & meaningful
  const doctorWeights = doctors.map((doc) => {
    const fullName = `${doc.first_name} ${doc.last_name}`.toLowerCase();
    let weight = 10;
    if (fullName.includes('priya')) weight = 24;
    else if (fullName.includes('vikram')) weight = 21;
    else if (fullName.includes('sneha')) weight = 18;
    else if (fullName.includes('anil')) weight = 16;
    else if (fullName.includes('arjun nair')) weight = 13;
    else if (fullName.includes('rohit')) weight = 11;
    else if (fullName.includes('suhas')) weight = 9;
    else weight = 8;
    return { item: doc, weight };
  });

  const records: AnalyticsVisitRecord[] = [];
  let seq = 1;

  for (const monthSpec of MONTHLY_TARGET_COUNTS) {
    for (let k = 0; k < monthSpec.targetVisits; k++) {
      // Slightly lower volume on Sundays (dayOfWeek === 0), higher Mon–Sat
      let dayNum = 1 + Math.floor(rng() * monthSpec.days);
      const candidateIso = `${monthSpec.month}-${String(dayNum).padStart(2, '0')}`;
      const dow = new Date(`${candidateIso}T00:00:00Z`).getUTCDay();
      if (dow === 0 && rng() < 0.72) {
        dayNum = dayNum < monthSpec.days ? dayNum + 1 : Math.max(1, dayNum - 1);
      }
      const visit_date = `${monthSpec.month}-${String(dayNum).padStart(2, '0')}`;

      const doctor = pickWeighted(rng, doctorWeights);
      // Pediatricians skew younger patients
      let patient = patientPool[Math.floor(rng() * patientPool.length)];
      if (doctor.department_id === 5 && rng() < 0.65) {
        const young = patientPool.filter((p) => p.age_group === '0-18');
        if (young.length > 0) patient = young[Math.floor(rng() * young.length)];
      }

      const booking_source = pickWeighted<'ONLINE' | 'WALK_IN'>(rng, [
        { item: 'ONLINE', weight: 64 },
        { item: 'WALK_IN', weight: 36 },
      ]);

      const status =
        monthSpec.month === '2026-11' && dayNum >= 14
          ? pickWeighted<AnalyticsVisitRecord['status']>(rng, [
              { item: 'COMPLETED', weight: 58 },
              { item: 'CONFIRMED', weight: 26 },
              { item: 'CANCELLED', weight: 10 },
              { item: 'NO_SHOW', weight: 6 },
            ])
          : pickWeighted<AnalyticsVisitRecord['status']>(rng, [
              { item: 'COMPLETED', weight: booking_source === 'WALK_IN' ? 84 : 76 },
              { item: 'CANCELLED', weight: 12 },
              { item: 'NO_SHOW', weight: booking_source === 'WALK_IN' ? 4 : 12 },
            ]);

      const fee = Number(doctor.consultation_fee || 500);
      const isPaid = status === 'COMPLETED' || status === 'CONFIRMED';
      const payment_method = isPaid
        ? pickWeighted<AnalyticsVisitRecord['payment_method']>(rng, [
            { item: 'UPI', weight: 54 },
            { item: 'CARD', weight: 22 },
            { item: 'CASH', weight: booking_source === 'WALK_IN' ? 28 : 10 },
            { item: 'NETBANKING', weight: 6 },
          ])
        : 'UNPAID';

      const department_name =
        deptNameMap.get(doctor.department_id) ||
        fallbackDeptNames[doctor.department_id] ||
        `Department #${doctor.department_id}`;

      records.push({
        id: `HIST-${monthSpec.month}-${String(seq++).padStart(4, '0')}`,
        source: 'HISTORICAL',
        visit_date,
        visit_month: monthSpec.month,
        start_time: pickWeighted(rng, TIME_SLOTS_WEIGHTED),
        doctor_id: doctor.doctor_id,
        doctor_name: `Dr. ${doctor.first_name} ${doctor.last_name}`,
        department_id: doctor.department_id,
        department_name,
        specialization: doctor.specialization || 'General OPD',
        patient_id: patient.patient_id,
        patient_name: patient.name,
        patient_gender: patient.gender,
        patient_age_group: patient.age_group,
        city: patient.city,
        locality: patient.locality,
        status,
        booking_source,
        payment_method,
        amount: isPaid ? fee : 0,
      });
    }
  }

  return records.sort((a, b) => b.visit_date.localeCompare(a.visit_date));
}
