import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, RefreshCw, RotateCcw, UserCheck, Video } from 'lucide-react';
import type {
  AnalyticsDatasetResponse,
  AnalyticsSourceTag,
  ConsultationMode,
} from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { formatCurrencyInr } from '../../utils/rules';
import {
  computeHospitalAnalytics,
  filterAnalyticsRecords,
  formatMonthShort,
  type AnalyticsFilterState,
} from '../../utils/analytics';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';

type DoctorSortKey = 'visits' | 'revenue' | 'completion';

const DEFAULT_FILTERS: AnalyticsFilterState = {
  source: 'ALL',
  fromMonth: '',
  toMonth: '',
  department: 'ALL',
  city: 'ALL',
  consultationMode: 'ALL',
};

export function AnalyticsPage() {
  const { notify } = useToast();
  const [dataset, setDataset] = useState<AnalyticsDatasetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<AnalyticsFilterState>(DEFAULT_FILTERS);
  const [doctorSort, setDoctorSort] = useState<DoctorSortKey>('visits');
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getAnalytics();
      setDataset(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load hospital analytics';
      setErrorMsg(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const records = dataset?.records ?? [];

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.visit_month) set.add(r.visit_month);
    }
    return Array.from(set).sort();
  }, [records]);

  const availableDepartments = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.department_name) set.add(r.department_name);
    }
    return Array.from(set).sort();
  }, [records]);

  const availableCities = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.city && r.city !== 'Unspecified') set.add(r.city);
    }
    return Array.from(set).sort();
  }, [records]);

  const filteredRecords = useMemo(
    () => filterAnalyticsRecords(records, filters),
    [records, filters],
  );

  const report = useMemo(() => computeHospitalAnalytics(filteredRecords), [filteredRecords]);

  const sortedDoctors = useMemo(() => {
    const list = [...report.topDoctors];
    if (doctorSort === 'revenue') {
      list.sort((a, b) => b.revenue - a.revenue || b.totalVisits - a.totalVisits);
    } else if (doctorSort === 'completion') {
      list.sort((a, b) => b.completionRatePct - a.completionRatePct || b.totalVisits - a.totalVisits);
    } else {
      list.sort((a, b) => b.totalVisits - a.totalVisits || b.revenue - a.revenue);
    }
    return list;
  }, [report.topDoctors, doctorSort]);

  const allowed = dataset?.allowed_sections ?? {
    revenue: true,
    doctor: true,
    department: true,
    geographic: true,
    export_revenue: true,
    export_doctor: true,
    export_department: true,
    export_geographic: true,
  };
  const canExportAny =
    allowed.export_revenue ||
    allowed.export_doctor ||
    allowed.export_department ||
    allowed.export_geographic;

  useEffect(() => {
    if (!allowed.revenue && doctorSort === 'revenue') {
      setDoctorSort('visits');
    }
  }, [allowed.revenue, doctorSort]);

  useEffect(() => {
    if (!allowed.geographic && filters.city !== 'ALL') {
      setFilters((prev) => ({ ...prev, city: 'ALL' }));
    }
  }, [allowed.geographic, filters.city]);

  const activeMonthPoint = useMemo(() => {
    if (report.monthlyTrends.length === 0) return null;
    if (hoveredMonth) {
      const match = report.monthlyTrends.find((m) => m.month === hoveredMonth);
      if (match) return match;
    }
    return report.monthlyTrends[report.monthlyTrends.length - 1];
  }, [report.monthlyTrends, hoveredMonth]);

  const hasActiveFilters =
    filters.source !== 'ALL' ||
    filters.fromMonth !== '' ||
    filters.toMonth !== '' ||
    filters.department !== 'ALL' ||
    filters.city !== 'ALL' ||
    (Boolean(filters.consultationMode) && filters.consultationMode !== 'ALL');

  const handleExportCsv = () => {
    if (!canExportAny) {
      notify('You do not have export permission for any analytics section', 'error');
      return;
    }
    if (filteredRecords.length === 0) {
      notify('No records in the current filter to export', 'info');
      return;
    }
    const includeRev = allowed.export_revenue && allowed.revenue;
    const headers = [
      'Section',
      'Name',
      'Subgroup',
      'Visits',
      'Unique Patients',
      'Share %',
      ...(includeRev ? ['Revenue INR'] : []),
    ];
    const rows: Array<Array<unknown>> = [];
    if (includeRev) {
      rows.push([
        'Revenue Summary',
        'Total OPD Revenue Collected',
        `Avg fee ${report.avgTicketRevenue} INR`,
        report.totalVisits,
        report.uniquePatients,
        '100%',
        report.totalRevenue,
      ]);
      for (const pm of report.paymentMethods) {
        rows.push([
          'Payment Method',
          pm.label,
          'Paid Visits',
          pm.count,
          '',
          `${pm.sharePct}%`,
          pm.revenue,
        ]);
      }
    }
    if (allowed.export_doctor) {
      for (const d of report.topDoctors) {
        rows.push([
          'Top Doctor',
          d.doctor_name,
          d.department_name,
          d.totalVisits,
          d.uniquePatients,
          `${d.completionRatePct}%`,
          ...(includeRev ? [d.revenue] : []),
        ]);
      }
    }
    if (allowed.export_department) {
      for (const dept of report.topDepartments) {
        rows.push([
          'Top Department',
          dept.department_name,
          `Top: ${dept.topDoctorName}`,
          dept.totalVisits,
          '',
          `${dept.sharePct}%`,
          ...(includeRev ? [dept.revenue] : []),
        ]);
      }
    }
    if (allowed.export_geographic) {
      for (const c of report.topCities) {
        rows.push([
          'Top City',
          c.city,
          `Top Locality: ${c.topLocality}`,
          c.totalVisits,
          c.uniquePatients,
          `${c.sharePct}%`,
          ...(includeRev ? [c.revenue] : []),
        ]);
      }
      for (const l of report.topLocalities) {
        rows.push([
          'Top Locality',
          l.locality,
          l.city,
          l.totalVisits,
          l.uniquePatients,
          `${l.sharePct}%`,
          ...(includeRev ? [l.revenue] : []),
        ]);
      }
    }
    for (const cm of report.consultationModes) {
      rows.push([
        'Consultation Mode',
        cm.label,
        'Active Consultations (Excludes Cancelled)',
        cm.count,
        '',
        `${cm.sharePct}%`,
        ...(includeRev ? [cm.revenue] : []),
      ]);
    }
    const csv = buildCsvString(headers, rows);
    downloadCsvFile('carepulse-opd-analytics-nov2025-nov2026.csv', csv);
    notify('Permitted analytics summary exported as CSV', 'success');
  };

  if (loading && !dataset) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-80 animate-pulse rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

  if (errorMsg && !dataset) {
    return (
      <div className="rounded-xl border border-red-200 bg-white p-6">
        <h2 className="text-base font-semibold text-red-900">Unable to load OPD Analytics</h2>
        <p className="mt-1 text-sm text-red-700">{errorMsg}</p>
        <button
          type="button"
          onClick={() => void loadAnalytics()}
          className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Retry
        </button>
      </div>
    );
  }

  const maxMonthlyVisits = Math.max(1, ...report.monthlyTrends.map((m) => m.total));
  const maxModeMonthly = Math.max(
    1,
    ...report.monthlyTrends.map((m) => Math.max(m.online, m.faceToFace)),
  );
  const maxDayCount = Math.max(1, ...report.peakDays.map((d) => d.count));
  const maxHourCount = Math.max(1, ...report.peakHours.map((h) => h.count));
  const topCitiesSlice = report.topCities.slice(0, 8);
  const topLocalitiesSlice = report.topLocalities.slice(0, 10);
  const maxCityVisits = Math.max(1, ...topCitiesSlice.map((c) => c.totalVisits));
  const maxLocVisits = Math.max(1, ...topLocalitiesSlice.map((l) => l.totalVisits));
  const activeModeDenominator = Math.max(1, report.onlineConsultations + report.faceToFaceConsultations);
  const onlineSharePct =
    report.activeVisits > 0
      ? Math.round((report.onlineConsultations / activeModeDenominator) * 1000) / 10
      : 0;
  const faceToFaceSharePct =
    report.activeVisits > 0
      ? Math.round((report.faceToFaceConsultations / activeModeDenominator) * 1000) / 10
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Hospital OPD Analytics &amp; Regional Insights
          </h2>
          <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
            Nov 2025 – Nov 2026 · {dataset?.historical_count ?? 0} historical records ·{' '}
            {dataset?.live_count ?? 0} live Oracle appointments · Showing {filteredRecords.length}{' '}
            consultations
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadAnalytics()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          {canExportAny && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div
          className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
            allowed.geographic ? 'lg:grid-cols-6' : 'lg:grid-cols-5'
          }`}
        >
          <div>
            <label htmlFor="ana-source" className="block text-xs font-medium text-slate-500">
              Dataset Scope
            </label>
            <select
              id="ana-source"
              value={filters.source}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  source: e.target.value as 'ALL' | AnalyticsSourceTag,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All (Nov 25 – Nov 26)</option>
              <option value="HISTORICAL">Historical Seed Only</option>
              <option value="LIVE">Live Oracle Only</option>
            </select>
          </div>

          <div>
            <label htmlFor="ana-mode" className="block text-xs font-medium text-slate-500">
              Consultation Mode
            </label>
            <select
              id="ana-mode"
              value={filters.consultationMode || 'ALL'}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  consultationMode: e.target.value as 'ALL' | ConsultationMode,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Modes</option>
              <option value="ONLINE">Online Consultation</option>
              <option value="FACE_TO_FACE">Face-to-Face Consultation</option>
            </select>
          </div>

          <div>
            <label htmlFor="ana-from" className="block text-xs font-medium text-slate-500">
              From Month
            </label>
            <select
              id="ana-from"
              value={filters.fromMonth}
              onChange={(e) => setFilters((prev) => ({ ...prev, fromMonth: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="">Nov 2025 (Start)</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthShort(m)} ({m})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ana-to" className="block text-xs font-medium text-slate-500">
              To Month
            </label>
            <select
              id="ana-to"
              value={filters.toMonth}
              onChange={(e) => setFilters((prev) => ({ ...prev, toMonth: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="">Nov 2026 (Latest)</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthShort(m)} ({m})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ana-dept" className="block text-xs font-medium text-slate-500">
              Department
            </label>
            <select
              id="ana-dept"
              value={filters.department}
              onChange={(e) => setFilters((prev) => ({ ...prev, department: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">All Departments</option>
              {availableDepartments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {allowed.geographic ? (
            <div>
              <label htmlFor="ana-city" className="block text-xs font-medium text-slate-500">
                Patient City
              </label>
              <div className="mt-1 flex items-center gap-2">
                <select
                  id="ana-city"
                  value={filters.city}
                  onChange={(e) => setFilters((prev) => ({ ...prev, city: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none"
                >
                  <option value="ALL">All Cities</option>
                  {availableCities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                    title="Reset analytics filters"
                    aria-label="Reset filters"
                    className="shrink-0 rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            hasActiveFilters && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset Filters</span>
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">
            No consultations match these filters
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Clear active month, department, or city filters to inspect the full 1-year OPD dataset.
          </p>
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <>
          {/* KPI Strip */}
          <div
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
              allowed.revenue ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
            }`}
          >
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Total OPD Consultations</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {report.totalVisits.toLocaleString('en-IN')}
              </p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                {report.completedVisits} completed · {report.cancelledVisits} cancelled ·{' '}
                {report.noShowVisits} no-show
              </p>
            </div>

            {allowed.revenue && (
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">OPD Revenue Collected</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {formatCurrencyInr(report.totalRevenue)}
                </p>
                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                  Avg fee {formatCurrencyInr(report.avgTicketRevenue)} per paid visit
                </p>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Fulfillment &amp; Repeat Visits</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {report.completionRatePct}%
              </p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                {report.uniquePatients} unique patients · {report.repeatVisitRatePct}% repeat rate
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              {allowed.doctor ? (
                <>
                  <p className="text-xs font-medium text-slate-500">
                    {allowed.geographic ? 'Top Doctor & Patient Origin' : 'Top Performing Doctor'}
                  </p>
                  <p className="mt-2 truncate text-lg font-semibold text-slate-900">
                    {report.topDoctor ? report.topDoctor.doctor_name : '—'}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500 tabular-nums">
                    {report.topDoctor
                      ? allowed.geographic && report.topLocality
                        ? `${report.topDoctor.totalVisits} visits · ${report.topLocality.locality}, ${report.topLocality.city}`
                        : `${report.topDoctor.totalVisits} visits · ${report.topDoctor.department_name}`
                      : '—'}
                  </p>
                </>
              ) : allowed.geographic ? (
                <>
                  <p className="text-xs font-medium text-slate-500">Top Patient Origin</p>
                  <p className="mt-2 truncate text-lg font-semibold text-slate-900">
                    {report.topLocality
                      ? `${report.topLocality.locality}, ${report.topLocality.city}`
                      : report.topCity?.city || '—'}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500 tabular-nums">
                    {report.topLocality
                      ? `${report.topLocality.totalVisits} visits · ${report.topLocality.uniquePatients} patients`
                      : '—'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-medium text-slate-500">Top Clinical Department</p>
                  <p className="mt-2 truncate text-lg font-semibold text-slate-900">
                    {report.topDepartment ? report.topDepartment.department_name : '—'}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500 tabular-nums">
                    {report.topDepartment
                      ? `${report.topDepartment.totalVisits} visits (${report.topDepartment.sharePct}%)`
                      : '—'}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Consultation Mode KPIs & Visual Comparison Chart */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Total Online Consultations</span>
                  <Video className="h-4 w-4 text-sky-600" aria-hidden="true" />
                </div>
                <p className="mt-2 font-mono text-2xl font-semibold text-sky-900 tabular-nums">
                  {report.onlineConsultations.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                  {onlineSharePct}% of active consultations · Excludes cancelled
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Total Face-to-Face Consultations</span>
                  <UserCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
                </div>
                <p className="mt-2 font-mono text-2xl font-semibold text-teal-900 tabular-nums">
                  {report.faceToFaceConsultations.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                  {faceToFaceSharePct}% of active consultations · Rescheduled deduplicated
                </p>
              </div>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
              <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Consultation Mode Comparison (Online vs Face-to-Face)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Active consultations excluding cancelled records and deduplicating rescheduled appointments.
                  </p>
                </div>
                {activeMonthPoint && (
                  <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                    <span className="font-semibold text-slate-900">
                      {formatMonthShort(activeMonthPoint.month)}:
                    </span>
                    <span className="font-medium text-sky-700">
                      {activeMonthPoint.online} online
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-teal-700">
                      {activeMonthPoint.faceToFace} face-to-face
                    </span>
                  </div>
                )}
              </div>

              {/* Proportional Split Bar */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs font-medium tabular-nums">
                  <span className="text-sky-800">
                    Online ({report.onlineConsultations.toLocaleString('en-IN')} · {onlineSharePct}%)
                  </span>
                  <span className="text-teal-800">
                    Face-to-Face ({report.faceToFaceConsultations.toLocaleString('en-IN')} ·{' '}
                    {faceToFaceSharePct}%)
                  </span>
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-sky-600 transition-all"
                    style={{ width: `${onlineSharePct}%` }}
                  />
                  <div
                    className="h-full bg-teal-700 transition-all"
                    style={{ width: `${faceToFaceSharePct}%` }}
                  />
                </div>
              </div>

              {/* Monthly Grouped Comparison Bars */}
              <div className="mt-5 overflow-x-auto">
                <div className="min-w-[540px]">
                  <div
                    className="grid items-end gap-2 h-40 pt-3"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(1, report.monthlyTrends.length)}, minmax(0, 1fr))`,
                    }}
                  >
                    {report.monthlyTrends.map((m) => {
                      const onlinePct =
                        m.online > 0 ? Math.max(8, Math.round((m.online / maxModeMonthly) * 100)) : 0;
                      const f2fPct =
                        m.faceToFace > 0
                          ? Math.max(8, Math.round((m.faceToFace / maxModeMonthly) * 100))
                          : 0;
                      const isFocused = activeMonthPoint?.month === m.month;
                      return (
                        <button
                          key={`mode-${m.month}`}
                          type="button"
                          onMouseEnter={() => setHoveredMonth(m.month)}
                          onFocus={() => setHoveredMonth(m.month)}
                          onClick={() => setHoveredMonth(m.month)}
                          aria-label={`${formatMonthShort(m.month)}: ${m.online} online, ${m.faceToFace} face-to-face`}
                          className={`flex h-full flex-col justify-end rounded-lg px-1 pt-2 pb-1 text-center transition-colors ${
                            isFocused ? 'bg-slate-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="mx-auto flex h-28 w-full max-w-[32px] items-end justify-center gap-1">
                            <div
                              className="w-3 rounded-t bg-sky-600 transition-all"
                              style={{ height: `${onlinePct}%` }}
                              title={`Online: ${m.online}`}
                            />
                            <div
                              className="w-3 rounded-t bg-teal-700 transition-all"
                              style={{ height: `${f2fPct}%` }}
                              title={`Face-to-Face: ${m.faceToFace}`}
                            />
                          </div>
                          <span className="mt-1.5 font-mono text-[10px] text-slate-600 whitespace-nowrap">
                            {m.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-5 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-600" />
                      Online Consultation
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-teal-700" />
                      Face-to-Face Consultation
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Monthly Trend Chart (Nov 2025 – Nov 2026) */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {allowed.revenue ? 'Monthly OPD Volume & Revenue Trend' : 'Monthly OPD Volume Trend'}
                </h3>
                <p className="text-xs text-slate-500">
                  {allowed.revenue
                    ? 'Hover or tap any month bar to inspect consultations, cancellations, and revenue.'
                    : 'Hover or tap any month bar to inspect consultations and cancellations.'}
                </p>
              </div>
              {activeMonthPoint && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 tabular-nums">
                  <span className="font-semibold text-slate-900">
                    {formatMonthShort(activeMonthPoint.month)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeMonthPoint.total} total</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-teal-700 font-medium">
                    {activeMonthPoint.completed} completed
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeMonthPoint.cancelledOrNoShow} cancelled/no-show</span>
                  {allowed.revenue && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatCurrencyInr(activeMonthPoint.revenue)}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 overflow-x-auto">
              <div className="min-w-[680px]">
                <div className="grid grid-cols-13 gap-2 items-end h-52 pt-4" style={{ gridTemplateColumns: `repeat(${report.monthlyTrends.length}, minmax(0, 1fr))` }}>
                  {report.monthlyTrends.map((m) => {
                    const totalPct = Math.max(8, Math.round((m.total / maxMonthlyVisits) * 100));
                    const completedPct = Math.max(
                      4,
                      Math.round((m.completed / maxMonthlyVisits) * 100),
                    );
                    const isFocused = activeMonthPoint?.month === m.month;
                    return (
                      <button
                        key={m.month}
                        type="button"
                        onMouseEnter={() => setHoveredMonth(m.month)}
                        onFocus={() => setHoveredMonth(m.month)}
                        onClick={() => setHoveredMonth(m.month)}
                        aria-label={
                          allowed.revenue
                            ? `${formatMonthShort(m.month)}: ${m.total} visits, ${formatCurrencyInr(m.revenue)}`
                            : `${formatMonthShort(m.month)}: ${m.total} visits`
                        }
                        className={`group flex h-full flex-col justify-end rounded-lg px-1 pt-2 pb-1 text-center transition-colors ${
                          isFocused ? 'bg-slate-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="mb-1 font-mono text-[11px] font-medium text-slate-700 tabular-nums">
                          {m.total}
                        </span>
                        <div className="relative mx-auto flex h-36 w-full max-w-[34px] items-end justify-center rounded-t bg-slate-100">
                          <div
                            className="w-full rounded-t bg-slate-300 transition-all"
                            style={{ height: `${totalPct}%` }}
                          />
                          <div
                            className={`absolute bottom-0 w-full rounded-t transition-all ${
                              isFocused ? 'bg-teal-700' : 'bg-teal-600 group-hover:bg-teal-700'
                            }`}
                            style={{ height: `${completedPct}%` }}
                          />
                        </div>
                        <span className="mt-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-end gap-5 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-teal-600" />
                    Completed / Confirmed
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" />
                    Cancelled / No-Show portion
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Top Doctors + Top Departments */}
          {(allowed.doctor || allowed.department) && (
            <div
              className={`grid grid-cols-1 gap-6 ${
                allowed.doctor && allowed.department ? 'lg:grid-cols-3' : 'lg:grid-cols-1'
              }`}
            >
              {allowed.doctor && (
                <section
                  className={`rounded-xl border border-slate-200 bg-white ${
                    allowed.department ? 'lg:col-span-2' : ''
                  }`}
                >
                  <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Top Doctors Leaderboard</h3>
                      <p className="text-xs text-slate-500">
                        {allowed.revenue
                          ? 'Ranked across consultations, unique patient reach, fulfillment rate, and revenue.'
                          : 'Ranked across consultations, unique patient reach, and fulfillment rate.'}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                      {(
                        [
                          { key: 'visits', label: 'Visits' },
                          ...(allowed.revenue ? ([{ key: 'revenue', label: 'Revenue' }] as const) : []),
                          { key: 'completion', label: 'Completion %' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setDoctorSort(tab.key)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                            doctorSort === tab.key
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5">#</th>
                          <th className="px-4 py-2.5">Doctor</th>
                          <th className="px-4 py-2.5">Department</th>
                          <th className="px-4 py-2.5 text-right">Visits</th>
                          <th className="px-4 py-2.5 text-right">Patients</th>
                          <th className="px-4 py-2.5 text-right">Completion</th>
                          {allowed.revenue && <th className="px-4 py-2.5 text-right">Revenue</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedDoctors.map((doc, idx) => (
                          <tr key={`${doc.doctor_id}-${doc.doctor_name}`} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums">
                              {idx + 1}
                            </td>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-900">{doc.doctor_name}</p>
                              <p className="text-xs text-slate-500">{doc.specialization}</p>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">{doc.department_name}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              {doc.totalVisits}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums">
                              {doc.uniquePatients}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                              {doc.completionRatePct}%
                            </td>
                            {allowed.revenue && (
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-medium text-slate-900 tabular-nums">
                                {formatCurrencyInr(doc.revenue)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Top Departments */}
              {allowed.department && (
                <section className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-5 py-4">
                    <h3 className="text-base font-semibold text-slate-900">Top Departments</h3>
                    <p className="text-xs text-slate-500">
                      {allowed.revenue
                        ? 'Consultation share, revenue, and leading specialist per specialty.'
                        : 'Consultation share and leading specialist per specialty.'}
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {report.topDepartments.map((dept) => (
                      <div key={dept.department_name} className="px-5 py-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {dept.department_name}
                          </span>
                          <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums shrink-0">
                            {dept.totalVisits} ({dept.sharePct}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-teal-700"
                            style={{ width: `${Math.max(3, dept.sharePct)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="truncate">Top: {dept.topDoctorName}</span>
                          {allowed.revenue && (
                            <span className="font-mono shrink-0">{formatCurrencyInr(dept.revenue)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Top Patient Regions: Cities & Localities */}
          {allowed.geographic && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Top Patient Cities</h3>
                    <p className="text-xs text-slate-500">
                      Click any city row to drill down into its top localities and metrics.
                    </p>
                  </div>
                  {filters.city !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setFilters((prev) => ({ ...prev, city: 'ALL' }))}
                      className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap"
                    >
                      Show all cities
                    </button>
                  )}
                </div>
                <div className="divide-y divide-slate-100">
                  {topCitiesSlice.map((c) => {
                    const barWidth = Math.max(4, Math.round((c.totalVisits / maxCityVisits) * 100));
                    const isSelected = filters.city.toLowerCase() === c.city.toLowerCase();
                    return (
                      <button
                        key={c.city}
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            city: isSelected ? 'ALL' : c.city,
                          }))
                        }
                        className={`w-full px-5 py-3 text-left transition-colors ${
                          isSelected ? 'bg-teal-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{c.city}</span>
                          <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                            {c.totalVisits} visits · {c.sharePct}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-teal-700" style={{ width: `${barWidth}%` }} />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <span>
                            {c.uniquePatients} patients · Top locality: {c.topLocality}
                          </span>
                          {allowed.revenue && <span className="font-mono">{formatCurrencyInr(c.revenue)}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-base font-semibold text-slate-900">
                    Top Patient Localities{filters.city !== 'ALL' ? ` in ${filters.city}` : ''}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Highest-volume neighborhoods and their most-visited clinical department.
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {topLocalitiesSlice.map((loc) => {
                    const barWidth = Math.max(4, Math.round((loc.totalVisits / maxLocVisits) * 100));
                    return (
                      <div key={`${loc.city}-${loc.locality}`} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900">
                            {loc.locality}{' '}
                            <span className="text-xs font-normal text-slate-500">· {loc.city}</span>
                          </span>
                          <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                            {loc.totalVisits} visits ({loc.sharePct}%)
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-slate-700" style={{ width: `${barWidth}%` }} />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <span>
                            {loc.uniquePatients} unique patients · Top dept: {loc.topDepartment}
                          </span>
                          {allowed.revenue && <span className="font-mono">{formatCurrencyInr(loc.revenue)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* Operational & Patient Behavior Grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {/* Peak Days */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">Peak OPD Days</h3>
              <p className="mt-0.5 text-xs text-slate-500">Volume by day of week</p>
              <div className="mt-4 space-y-2.5">
                {report.peakDays.map((d) => (
                  <div key={d.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-medium text-slate-700">{d.label}</span>
                      <span className="font-mono text-slate-900">
                        {d.count} ({d.sharePct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-teal-700"
                        style={{ width: `${Math.max(4, Math.round((d.count / maxDayCount) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Peak Hours */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">Peak Consultation Hours</h3>
              <p className="mt-0.5 text-xs text-slate-500">Busiest shift windows</p>
              <div className="mt-4 space-y-3">
                {report.peakHours.map((h) => (
                  <div key={h.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-mono text-slate-700">{h.label}</span>
                      <span className="font-mono text-slate-900">
                        {h.count} ({h.sharePct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-slate-700"
                        style={{ width: `${Math.max(4, Math.round((h.count / maxHourCount) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Booking Channels & Payment Mix */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Booking Source Mix</h3>
                <div className="mt-3 space-y-2">
                  {report.bookingSources.map((b) => (
                    <div key={b.label} className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-medium text-slate-700">{b.label}</span>
                      <span className="font-mono text-slate-900">
                        {b.count} · {b.sharePct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {allowed.revenue && (
                <div className="border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-semibold text-slate-900">Payment Method Mix</h3>
                  <div className="mt-3 space-y-2">
                    {report.paymentMethods.map((pm) => (
                      <div key={pm.label} className="flex items-center justify-between text-xs tabular-nums">
                        <span className="font-medium text-slate-700">{pm.label}</span>
                        <span className="font-mono text-slate-900">
                          {pm.sharePct}% · {formatCurrencyInr(pm.revenue)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Patient Demographics */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Gender Distribution</h3>
                <div className="mt-3 space-y-2">
                  {report.genderBreakdown.map((g) => (
                    <div key={g.label} className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-medium text-slate-700">{g.label}</span>
                      <span className="font-mono text-slate-900">
                        {g.count} ({g.sharePct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-900">Patient Age Groups</h3>
                <div className="mt-3 space-y-2">
                  {report.ageGroups.map((a) => (
                    <div key={a.label} className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-mono text-slate-700">{a.label} yrs</span>
                      <span className="font-mono text-slate-900">
                        {a.count} ({a.sharePct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
