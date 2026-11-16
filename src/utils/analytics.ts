import type { AnalyticsSourceTag, AnalyticsVisitRecord } from '../types/opd.ts';

export interface AnalyticsFilterState {
  source: 'ALL' | AnalyticsSourceTag;
  fromMonth: string; // YYYY-MM or ''
  toMonth: string; // YYYY-MM or ''
  department: string; // 'ALL' or department_name
  city: string; // 'ALL' or city
}

export interface MonthlyTrendPoint {
  month: string; // YYYY-MM
  label: string; // Nov 25
  total: number;
  completed: number;
  cancelledOrNoShow: number;
  revenue: number;
}

export interface DoctorLeaderboardRow {
  doctor_id: number;
  doctor_name: string;
  department_name: string;
  specialization: string;
  totalVisits: number;
  completedVisits: number;
  cancelledOrNoShow: number;
  completionRatePct: number;
  revenue: number;
  uniquePatients: number;
}

export interface DepartmentAnalyticsRow {
  department_name: string;
  totalVisits: number;
  completedVisits: number;
  sharePct: number;
  revenue: number;
  cancellationRatePct: number;
  topDoctorName: string;
}

export interface CityAnalyticsRow {
  city: string;
  totalVisits: number;
  uniquePatients: number;
  sharePct: number;
  revenue: number;
  topLocality: string;
}

export interface LocalityAnalyticsRow {
  city: string;
  locality: string;
  totalVisits: number;
  uniquePatients: number;
  sharePct: number;
  revenue: number;
  topDepartment: string;
}

export interface BreakdownRow {
  label: string;
  count: number;
  sharePct: number;
  revenue: number;
  completionRatePct?: number;
}

export interface HospitalAnalyticsReport {
  totalVisits: number;
  completedVisits: number;
  confirmedVisits: number;
  cancelledVisits: number;
  noShowVisits: number;
  completionRatePct: number;
  cancellationRatePct: number;
  noShowRatePct: number;
  totalRevenue: number;
  avgTicketRevenue: number;
  uniquePatients: number;
  repeatPatients: number;
  repeatVisitRatePct: number;
  topDoctor: DoctorLeaderboardRow | null;
  topDepartment: DepartmentAnalyticsRow | null;
  topCity: CityAnalyticsRow | null;
  topLocality: LocalityAnalyticsRow | null;
  monthlyTrends: MonthlyTrendPoint[];
  topDoctors: DoctorLeaderboardRow[];
  topDepartments: DepartmentAnalyticsRow[];
  topCities: CityAnalyticsRow[];
  topLocalities: LocalityAnalyticsRow[];
  bookingSources: BreakdownRow[];
  paymentMethods: BreakdownRow[];
  peakDays: BreakdownRow[];
  peakHours: BreakdownRow[];
  genderBreakdown: BreakdownRow[];
  ageGroups: BreakdownRow[];
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function formatMonthShort(yyyyMm: string): string {
  const [yStr, mStr] = yyyyMm.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) return yyyyMm;
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(-2)}`;
}

export function filterAnalyticsRecords(
  records: AnalyticsVisitRecord[],
  filters: AnalyticsFilterState,
): AnalyticsVisitRecord[] {
  return records.filter((rec) => {
    if (filters.source !== 'ALL' && rec.source !== filters.source) return false;
    if (filters.fromMonth && rec.visit_month < filters.fromMonth) return false;
    if (filters.toMonth && rec.visit_month > filters.toMonth) return false;
    if (filters.department !== 'ALL' && rec.department_name !== filters.department) return false;
    if (filters.city !== 'ALL' && rec.city.toLowerCase() !== filters.city.toLowerCase()) return false;
    return true;
  });
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

export function computeHospitalAnalytics(records: AnalyticsVisitRecord[]): HospitalAnalyticsReport {
  const totalVisits = records.length;
  const completedVisits = records.filter((r) => r.status === 'COMPLETED').length;
  const confirmedVisits = records.filter((r) => r.status === 'CONFIRMED').length;
  const cancelledVisits = records.filter((r) => r.status === 'CANCELLED').length;
  const noShowVisits = records.filter((r) => r.status === 'NO_SHOW').length;

  const totalRevenue = records.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const paidVisits = records.filter((r) => Number(r.amount || 0) > 0).length;
  const avgTicketRevenue = paidVisits > 0 ? Math.round(totalRevenue / paidVisits) : 0;

  // Patient repeat rate
  const patientVisitCounts = new Map<number, number>();
  for (const r of records) {
    patientVisitCounts.set(r.patient_id, (patientVisitCounts.get(r.patient_id) || 0) + 1);
  }
  const uniquePatients = patientVisitCounts.size;
  const repeatPatients = Array.from(patientVisitCounts.values()).filter((c) => c > 1).length;

  // Monthly Trends
  const monthMap = new Map<string, MonthlyTrendPoint>();
  for (const r of records) {
    const existing = monthMap.get(r.visit_month) || {
      month: r.visit_month,
      label: formatMonthShort(r.visit_month),
      total: 0,
      completed: 0,
      cancelledOrNoShow: 0,
      revenue: 0,
    };
    existing.total += 1;
    if (r.status === 'COMPLETED' || r.status === 'CONFIRMED') existing.completed += 1;
    if (r.status === 'CANCELLED' || r.status === 'NO_SHOW') existing.cancelledOrNoShow += 1;
    existing.revenue += Number(r.amount || 0);
    monthMap.set(r.visit_month, existing);
  }
  const monthlyTrends = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Doctors Leaderboard
  const docMap = new Map<
    string,
    {
      doctor_id: number;
      doctor_name: string;
      department_name: string;
      specialization: string;
      totalVisits: number;
      completedVisits: number;
      cancelledOrNoShow: number;
      revenue: number;
      patients: Set<number>;
    }
  >();
  for (const r of records) {
    const key = `${r.doctor_id}-${r.doctor_name}`;
    const entry = docMap.get(key) || {
      doctor_id: r.doctor_id,
      doctor_name: r.doctor_name,
      department_name: r.department_name,
      specialization: r.specialization,
      totalVisits: 0,
      completedVisits: 0,
      cancelledOrNoShow: 0,
      revenue: 0,
      patients: new Set<number>(),
    };
    entry.totalVisits += 1;
    if (r.status === 'COMPLETED' || r.status === 'CONFIRMED') entry.completedVisits += 1;
    if (r.status === 'CANCELLED' || r.status === 'NO_SHOW') entry.cancelledOrNoShow += 1;
    entry.revenue += Number(r.amount || 0);
    entry.patients.add(r.patient_id);
    docMap.set(key, entry);
  }
  const topDoctors: DoctorLeaderboardRow[] = Array.from(docMap.values())
    .filter((d) => d.doctor_id > 0)
    .map((d) => ({
      doctor_id: d.doctor_id,
      doctor_name: d.doctor_name,
      department_name: d.department_name,
      specialization: d.specialization,
      totalVisits: d.totalVisits,
      completedVisits: d.completedVisits,
      cancelledOrNoShow: d.cancelledOrNoShow,
      completionRatePct: pct(d.completedVisits, d.totalVisits),
      revenue: d.revenue,
      uniquePatients: d.patients.size,
    }))
    .sort((a, b) => b.totalVisits - a.totalVisits || b.revenue - a.revenue);

  // Departments
  const deptMap = new Map<
    string,
    {
      totalVisits: number;
      completedVisits: number;
      cancelledOrNoShow: number;
      revenue: number;
      doctorCounts: Map<string, number>;
    }
  >();
  for (const r of records) {
    const entry = deptMap.get(r.department_name) || {
      totalVisits: 0,
      completedVisits: 0,
      cancelledOrNoShow: 0,
      revenue: 0,
      doctorCounts: new Map<string, number>(),
    };
    entry.totalVisits += 1;
    if (r.status === 'COMPLETED' || r.status === 'CONFIRMED') entry.completedVisits += 1;
    if (r.status === 'CANCELLED' || r.status === 'NO_SHOW') entry.cancelledOrNoShow += 1;
    entry.revenue += Number(r.amount || 0);
    entry.doctorCounts.set(r.doctor_name, (entry.doctorCounts.get(r.doctor_name) || 0) + 1);
    deptMap.set(r.department_name, entry);
  }
  const topDepartments: DepartmentAnalyticsRow[] = Array.from(deptMap.entries())
    .map(([department_name, d]) => {
      const topDoc = Array.from(d.doctorCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
      return {
        department_name,
        totalVisits: d.totalVisits,
        completedVisits: d.completedVisits,
        sharePct: pct(d.totalVisits, totalVisits),
        revenue: d.revenue,
        cancellationRatePct: pct(d.cancelledOrNoShow, d.totalVisits),
        topDoctorName: topDoc,
      };
    })
    .sort((a, b) => b.totalVisits - a.totalVisits || b.revenue - a.revenue);

  // Cities & Localities
  const cityMap = new Map<
    string,
    { totalVisits: number; revenue: number; patients: Set<number>; localityCounts: Map<string, number> }
  >();
  const locMap = new Map<
    string,
    {
      city: string;
      locality: string;
      totalVisits: number;
      revenue: number;
      patients: Set<number>;
      deptCounts: Map<string, number>;
    }
  >();

  for (const r of records) {
    const city = r.city || 'Unspecified';
    const locality = r.locality || 'Unspecified';

    const cEntry = cityMap.get(city) || {
      totalVisits: 0,
      revenue: 0,
      patients: new Set<number>(),
      localityCounts: new Map<string, number>(),
    };
    cEntry.totalVisits += 1;
    cEntry.revenue += Number(r.amount || 0);
    cEntry.patients.add(r.patient_id);
    cEntry.localityCounts.set(locality, (cEntry.localityCounts.get(locality) || 0) + 1);
    cityMap.set(city, cEntry);

    const locKey = `${city}:::${locality}`;
    const lEntry = locMap.get(locKey) || {
      city,
      locality,
      totalVisits: 0,
      revenue: 0,
      patients: new Set<number>(),
      deptCounts: new Map<string, number>(),
    };
    lEntry.totalVisits += 1;
    lEntry.revenue += Number(r.amount || 0);
    lEntry.patients.add(r.patient_id);
    lEntry.deptCounts.set(r.department_name, (lEntry.deptCounts.get(r.department_name) || 0) + 1);
    locMap.set(locKey, lEntry);
  }

  const topCities: CityAnalyticsRow[] = Array.from(cityMap.entries())
    .map(([city, c]) => ({
      city,
      totalVisits: c.totalVisits,
      uniquePatients: c.patients.size,
      sharePct: pct(c.totalVisits, totalVisits),
      revenue: c.revenue,
      topLocality:
        Array.from(c.localityCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    }))
    .sort((a, b) => b.totalVisits - a.totalVisits || b.uniquePatients - a.uniquePatients);

  const topLocalities: LocalityAnalyticsRow[] = Array.from(locMap.values())
    .map((l) => ({
      city: l.city,
      locality: l.locality,
      totalVisits: l.totalVisits,
      uniquePatients: l.patients.size,
      sharePct: pct(l.totalVisits, totalVisits),
      revenue: l.revenue,
      topDepartment:
        Array.from(l.deptCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    }))
    .sort((a, b) => b.totalVisits - a.totalVisits || b.uniquePatients - a.uniquePatients);

  // Booking Sources
  const bookingSources = buildBreakdown(records, (r) =>
    r.booking_source === 'WALK_IN' ? 'Walk-in Desk' : 'Online Portal',
  );

  // Payment Methods (only paid or explicit method)
  const paidRecords = records.filter((r) => r.payment_method !== 'UNPAID');
  const paymentMethods = buildBreakdown(paidRecords, (r) => r.payment_method);

  // Peak Day of Week
  const dayBuckets = new Map<string, AnalyticsVisitRecord[]>();
  for (const day of DAY_ORDER) dayBuckets.set(day, []);
  for (const r of records) {
    const d = new Date(`${r.visit_date}T00:00:00Z`);
    const jsDay = d.getUTCDay(); // 0=Sun..6=Sat
    const label = DAY_ORDER[jsDay === 0 ? 6 : jsDay - 1];
    dayBuckets.get(label)?.push(r);
  }
  const peakDays: BreakdownRow[] = DAY_ORDER.map((label) => {
    const items = dayBuckets.get(label) || [];
    const completed = items.filter((i) => i.status === 'COMPLETED' || i.status === 'CONFIRMED').length;
    return {
      label,
      count: items.length,
      sharePct: pct(items.length, totalVisits),
      revenue: items.reduce((s, i) => s + Number(i.amount || 0), 0),
      completionRatePct: pct(completed, items.length),
    };
  });

  // Peak Hours
  const hourBuckets = [
    { label: '08:00 – 10:00', min: 8, max: 10 },
    { label: '10:00 – 12:00', min: 10, max: 12 },
    { label: '12:00 – 14:00', min: 12, max: 14 },
    { label: '14:00 – 16:00', min: 14, max: 16 },
    { label: '16:00 – 19:00', min: 16, max: 20 },
  ];
  const peakHours: BreakdownRow[] = hourBuckets.map((b) => {
    const items = records.filter((r) => {
      const hr = Number((r.start_time || '09:00').split(':')[0]);
      return hr >= b.min && hr < b.max;
    });
    return {
      label: b.label,
      count: items.length,
      sharePct: pct(items.length, totalVisits),
      revenue: items.reduce((s, i) => s + Number(i.amount || 0), 0),
    };
  });

  const genderBreakdown = buildBreakdown(records, (r) => {
    if (r.patient_gender === 'MALE') return 'Male';
    if (r.patient_gender === 'FEMALE') return 'Female';
    if (r.patient_gender === 'OTHER') return 'Other';
    return 'Unspecified';
  });

  const ageGroups = buildBreakdown(records, (r) => r.patient_age_group);

  return {
    totalVisits,
    completedVisits,
    confirmedVisits,
    cancelledVisits,
    noShowVisits,
    completionRatePct: pct(completedVisits + confirmedVisits, totalVisits),
    cancellationRatePct: pct(cancelledVisits, totalVisits),
    noShowRatePct: pct(noShowVisits, totalVisits),
    totalRevenue,
    avgTicketRevenue,
    uniquePatients,
    repeatPatients,
    repeatVisitRatePct: pct(repeatPatients, uniquePatients),
    topDoctor: topDoctors[0] || null,
    topDepartment: topDepartments[0] || null,
    topCity: topCities[0] || null,
    topLocality: topLocalities[0] || null,
    monthlyTrends,
    topDoctors,
    topDepartments,
    topCities,
    topLocalities,
    bookingSources,
    paymentMethods,
    peakDays,
    peakHours,
    genderBreakdown,
    ageGroups,
  };
}

function buildBreakdown(
  records: AnalyticsVisitRecord[],
  keyFn: (r: AnalyticsVisitRecord) => string,
): BreakdownRow[] {
  const total = records.length;
  const map = new Map<string, { count: number; completed: number; revenue: number }>();
  for (const r of records) {
    const key = keyFn(r);
    const entry = map.get(key) || { count: 0, completed: 0, revenue: 0 };
    entry.count += 1;
    if (r.status === 'COMPLETED' || r.status === 'CONFIRMED') entry.completed += 1;
    entry.revenue += Number(r.amount || 0);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([label, v]) => ({
      label,
      count: v.count,
      sharePct: pct(v.count, total),
      revenue: v.revenue,
      completionRatePct: pct(v.completed, v.count),
    }))
    .sort((a, b) => b.count - a.count);
}

export function buildAnalyticsCsv(report: HospitalAnalyticsReport): string {
  const lines: string[] = [];
  lines.push('Section,Name,Subgroup,Visits,Unique Patients,Share %,Revenue INR');
  for (const d of report.topDoctors) {
    lines.push(
      `Top Doctor,"${d.doctor_name}","${d.department_name}",${d.totalVisits},${d.uniquePatients},,${d.revenue}`,
    );
  }
  for (const dept of report.topDepartments) {
    lines.push(
      `Top Department,"${dept.department_name}","Top: ${dept.topDoctorName}",${dept.totalVisits},,${dept.sharePct}%,${dept.revenue}`,
    );
  }
  for (const c of report.topCities) {
    lines.push(
      `Top City,"${c.city}","Top Locality: ${c.topLocality}",${c.totalVisits},${c.uniquePatients},${c.sharePct}%,${c.revenue}`,
    );
  }
  for (const l of report.topLocalities) {
    lines.push(
      `Top Locality,"${l.locality}","${l.city}",${l.totalVisits},${l.uniquePatients},${l.sharePct}%,${l.revenue}`,
    );
  }
  return lines.join('\n');
}
