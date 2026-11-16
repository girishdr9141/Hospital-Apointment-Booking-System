export const CURATED_CITIES = [
  'Bengaluru',
  'Mysuru',
  'Mangaluru',
  'Hubballi',
  'Hyderabad',
  'Chennai',
  'Mumbai',
  'Pune',
  'Delhi',
] as const;

export const LOCALITIES_BY_CITY: Record<string, string[]> = {
  Bengaluru: [
    'Indiranagar',
    'Koramangala',
    'Whitefield',
    'Jayanagar',
    'HSR Layout',
    'Malleshwaram',
    'Rajajinagar',
    'JP Nagar',
    'Hebbal',
    'Yelahanka',
    'Electronic City',
    'Marathahalli',
  ],
  Mysuru: ['Vijayanagar', 'Kuvempunagar', 'Gokulam', 'Saraswathipuram', 'Jayalakshmipuram'],
  Mangaluru: ['Kadri', 'Bejai', 'Hampankatta', 'Surathkal', 'Kankanady'],
  Hubballi: ['Vidyanagar', 'Keshwapur', 'Gokul Road', 'Deshpande Nagar'],
  Hyderabad: ['Gachibowli', 'Madhapur', 'Banjara Hills', 'Jubilee Hills', 'Kondapur', 'Secunderabad'],
  Chennai: ['Adyar', 'Anna Nagar', 'T. Nagar', 'Velachery', 'Mylapore'],
  Mumbai: ['Bandra', 'Andheri', 'Powai', 'Dadar', 'Colaba', 'Borivali'],
  Pune: ['Koregaon Park', 'Kothrud', 'Hinjewadi', 'Viman Nagar', 'Baner'],
  Delhi: ['Saket', 'Dwarka', 'Rohini', 'Lajpat Nagar', 'Vasant Kunj'],
};

export interface PatientRegion {
  city: string;
  locality: string;
}

export const DEFAULT_SEEDED_PATIENT_REGIONS: Record<number, PatientRegion> = {
  1: { city: 'Bengaluru', locality: 'Indiranagar' },
  22: { city: 'Bengaluru', locality: 'Koramangala' },
  23: { city: 'Bengaluru', locality: 'Whitefield' },
  24: { city: 'Bengaluru', locality: 'Jayanagar' },
  61: { city: 'Mysuru', locality: 'Vijayanagar' },
  101: { city: 'Bengaluru', locality: 'Malleshwaram' },
  121: { city: 'Bengaluru', locality: 'HSR Layout' },
};

export function normalizeRegionText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function getLocalitiesForCity(city: string): string[] {
  const clean = normalizeRegionText(city).toLowerCase();
  const matchedKey = Object.keys(LOCALITIES_BY_CITY).find(
    (key) => key.toLowerCase() === clean,
  );
  return matchedKey ? LOCALITIES_BY_CITY[matchedKey] : [];
}

export function formatPatientRegion(city?: string | null, locality?: string | null): string {
  const c = normalizeRegionText(city);
  const l = normalizeRegionText(locality);
  if (l && c) return `${l}, ${c}`;
  if (c) return c;
  if (l) return l;
  return '—';
}
