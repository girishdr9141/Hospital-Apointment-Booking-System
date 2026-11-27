import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Globe2, Plus, RefreshCw, Stethoscope } from 'lucide-react';
import type { Department, Doctor, GlobalBranchUtilisationRow } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useBranchContext } from '../../context/BranchContext';
import { useToast } from '../../context/ToastContext';
import { formatBranchCurrency } from '../../utils/globalBranch';
import { Modal } from '../../components/common/Modal';

type TabKey = 'branches' | 'departments' | 'doctors' | 'utilisation';

export function BranchesPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const {
    countries,
    branches,
    branchDepartments,
    doctorBranches,
    selectedBranchId,
    headquartersBranch,
    setSelectedBranchId,
    refreshGlobalContext,
    globalOrdsLive,
  } = useBranchContext();

  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<TabKey>('branches');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [utilisation, setUtilisation] = useState<GlobalBranchUtilisationRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Branch filter for specialization & doctor mapping tabs
  const [mappingBranchId, setMappingBranchId] = useState<number>(() =>
    selectedBranchId !== 'ALL' ? selectedBranchId : headquartersBranch?.branch_id ?? 0,
  );

  useEffect(() => {
    if (selectedBranchId !== 'ALL') {
      setMappingBranchId(selectedBranchId);
    } else if (
      branches.length > 0 &&
      (!mappingBranchId || !branches.some((b) => b.branch_id === mappingBranchId))
    ) {
      setMappingBranchId(headquartersBranch?.branch_id ?? branches[0].branch_id);
    }
  }, [selectedBranchId, branches, headquartersBranch, mappingBranchId]);

  const loadNetworkData = useCallback(async () => {
    setLoading(true);
    try {
      const [depts, docs, util, ctx] = await Promise.all([
        apiClient.getDepartments().catch(() => [] as Department[]),
        apiClient.getDoctors().catch(() => [] as Doctor[]),
        apiClient.getGlobalBranchUtilisation().catch(() => [] as GlobalBranchUtilisationRow[]),
        apiClient.getGlobalContext().catch(() => null),
      ]);
      const neededDeptIds = [
        ...(ctx?.branch_departments || []).map((bd) => bd.department_id),
        ...docs.map((d) => d.department_id),
      ];
      const resolvedDepts = await apiClient
        .resolveDepartmentsForIds(neededDeptIds, depts)
        .catch(() => depts);
      setDepartments(resolvedDepts);
      setDoctors(docs);
      setUtilisation(util);
      await refreshGlobalContext();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load network directory', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, refreshGlobalContext]);

  useEffect(() => {
    void loadNetworkData();
  }, [loadNetworkData]);

  // Add Country Modal
  const [countryModalOpen, setCountryModalOpen] = useState(false);
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cCurrency, setCCurrency] = useState('');
  const [cSymbol, setCSymbol] = useState('');
  const [cDial, setCDial] = useState('');
  const [cTz, setCTz] = useState('');
  const [cFx, setCFx] = useState('1');
  const [savingCountry, setSavingCountry] = useState(false);

  // Add Branch Modal
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [bCountryId, setBCountryId] = useState<string>(() => String(countries[0]?.country_id ?? 1));
  const [bCode, setBCode] = useState('');
  const [bName, setBName] = useState('');
  const [bCity, setBCity] = useState('');
  const [bAddress, setBAddress] = useState('');
  const [bPhone, setBPhone] = useState('');
  const [bEmail, setBEmail] = useState('');
  const [bTz, setBTz] = useState('');
  const [savingBranch, setSavingBranch] = useState(false);

  // Assign Dept Modal
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [assignDeptId, setAssignDeptId] = useState<string>('');
  const [assignDeptSpec, setAssignDeptSpec] = useState<'Y' | 'N'>('Y');
  const [assignDeptFee, setAssignDeptFee] = useState('');
  const [savingDeptMap, setSavingDeptMap] = useState(false);

  // Assign Doctor Modal
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [assignDocId, setAssignDocId] = useState<string>('');
  const [assignDocPrimary, setAssignDocPrimary] = useState<'Y' | 'N'>('N');
  const [assignDocFee, setAssignDocFee] = useState('');
  const [savingDocMap, setSavingDocMap] = useState(false);

  const selectedMappingBranch = useMemo(
    () => branches.find((b) => b.branch_id === mappingBranchId) || branches[0] || null,
    [branches, mappingBranchId],
  );

  const branchDeptRows = useMemo(() => {
    const deptById = new Map(departments.map((d) => [d.department_id, d]));
    return branchDepartments
      .filter((bd) => bd.branch_id === mappingBranchId)
      .map((bd) => ({
        ...bd,
        department_name: deptById.get(bd.department_id)?.department_name || `Department #${bd.department_id}`,
      }));
  }, [branchDepartments, departments, mappingBranchId]);

  const branchDoctorRows = useMemo(() => {
    const docById = new Map(doctors.map((d) => [d.doctor_id, d]));
    const deptById = new Map(departments.map((d) => [d.department_id, d]));
    return doctorBranches
      .filter((db) => db.branch_id === mappingBranchId)
      .map((db) => {
        const doc = docById.get(db.doctor_id);
        return {
          ...db,
          doctor_name: doc ? `Dr. ${doc.first_name} ${doc.last_name}` : `Doctor #${db.doctor_id}`,
          department_name: doc ? deptById.get(doc.department_id)?.department_name || 'OPD' : 'OPD',
          specialization: doc?.specialization || 'General Practice',
        };
      });
  }, [doctorBranches, doctors, departments, mappingBranchId]);

  const handleSaveCountry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cCode.trim() || !cName.trim() || !cCurrency.trim()) {
      notify('Country code, name, and currency code are required.', 'error');
      return;
    }
    setSavingCountry(true);
    try {
      await apiClient.saveGlobalCountry({
        country_code: cCode.trim().toUpperCase(),
        country_name: cName.trim(),
        currency_code: cCurrency.trim().toUpperCase(),
        currency_symbol: cSymbol.trim() || cCurrency.trim().toUpperCase(),
        phone_dial_code: cDial.trim() || '+1',
        default_timezone: cTz.trim() || 'UTC',
        fx_rate_to_inr: Number(cFx || 1),
      });
      notify(`Country ${cName.trim()} saved to Global CarePulse.`, 'success');
      setCountryModalOpen(false);
      setCCode('');
      setCName('');
      setCCurrency('');
      setCSymbol('');
      setCDial('');
      setCTz('');
      await loadNetworkData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save country', 'error');
    } finally {
      setSavingCountry(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bCode.trim() || !bName.trim() || !bCity.trim()) {
      notify('Branch code, branch name, and city are required.', 'error');
      return;
    }
    setSavingBranch(true);
    try {
      const c = countries.find((item) => String(item.country_id) === bCountryId);
      await apiClient.createGlobalBranch({
        country_id: Number(bCountryId),
        branch_code: bCode.trim().toUpperCase(),
        branch_name: bName.trim(),
        city: bCity.trim(),
        address_line: bAddress.trim() || undefined,
        phone: bPhone.trim() || undefined,
        email: bEmail.trim() || undefined,
        timezone_iana: bTz.trim() || c?.default_timezone || 'UTC',
        currency_code: c?.currency_code || 'USD',
      });
      notify(`Branch ${bName.trim()} created successfully.`, 'success');
      setBranchModalOpen(false);
      setBCode('');
      setBName('');
      setBCity('');
      setBAddress('');
      setBPhone('');
      setBEmail('');
      setBTz('');
      await loadNetworkData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to create branch', 'error');
    } finally {
      setSavingBranch(false);
    }
  };

  const handleToggleBranchStatus = async (branchId: number, currentActive: 'Y' | 'N') => {
    try {
      await apiClient.updateGlobalBranch(branchId, {
        is_active: currentActive === 'Y' ? 'N' : 'Y',
      });
      notify('Branch status updated.', 'success');
      await loadNetworkData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update branch status', 'error');
    }
  };

  const handleAssignDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignDeptId) {
      notify('Select a department to assign.', 'error');
      return;
    }
    setSavingDeptMap(true);
    try {
      await apiClient.assignBranchDepartment({
        branch_id: mappingBranchId,
        department_id: Number(assignDeptId),
        is_specialized: assignDeptSpec,
        local_consultation_fee: assignDeptFee ? Number(assignDeptFee) : null,
        is_active: 'Y',
      });
      notify('Branch department specialization updated.', 'success');
      setDeptModalOpen(false);
      setAssignDeptFee('');
      await loadNetworkData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to assign department', 'error');
    } finally {
      setSavingDeptMap(false);
    }
  };

  const handleAssignDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignDocId) {
      notify('Select a doctor to assign.', 'error');
      return;
    }
    setSavingDocMap(true);
    try {
      await apiClient.assignDoctorBranch({
        doctor_id: Number(assignDocId),
        branch_id: mappingBranchId,
        is_primary_branch: assignDocPrimary,
        local_consultation_fee: assignDocFee ? Number(assignDocFee) : null,
        is_active: 'Y',
      });
      notify('Doctor branch assignment updated.', 'success');
      setDocModalOpen(false);
      setAssignDocFee('');
      await loadNetworkData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to assign doctor', 'error');
    } finally {
      setSavingDocMap(false);
    }
  };

  const activeBranchesCount = branches.filter((b) => b.is_active === 'Y').length;
  const activeCountriesCount = countries.filter((c) => c.is_active === 'Y').length;
  const specializedMappingsCount = branchDepartments.filter(
    (bd) => bd.is_active === 'Y' && bd.is_specialized === 'Y',
  ).length;
  const activeDoctorMappingsCount = doctorBranches.filter((db) => db.is_active === 'Y').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Global CarePulse Branches &amp; Network
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Multi-country and multi-branch hospital sidecar layer. Existing single-clinic tables,
            procedures, and voice bookings remain untouched and resolve to Bengaluru HQ.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Sidecar Prefix: GBR_</span>
            <span aria-hidden="true">·</span>
            <span>ORDS Module: girish_global_api</span>
            <span aria-hidden="true">·</span>
            <span>
              Oracle Global ORDS:{' '}
              {globalOrdsLive ? 'Live on APEX' : 'Local Sidecar Sync Ready (run script 18 to publish)'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadNetworkData()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setCountryModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Country</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBCountryId(String(countries[0]?.country_id ?? 1));
                  setBranchModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>New Branch</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Active Countries</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {activeCountriesCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Hospital Branches</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {activeBranchesCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Specialized Depts</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {specializedMappingsCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Doctor-Branch Links</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {activeDoctorMappingsCount}
          </p>
        </div>
      </div>

      {/* Segmented Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              { id: 'branches', label: 'Branches & Countries' },
              { id: 'departments', label: 'Branch Specializations' },
              { id: 'doctors', label: 'Doctor Assignments' },
              { id: 'utilisation', label: 'Global Utilization' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(activeTab === 'departments' || activeTab === 'doctors') && (
          <div className="flex items-center gap-2">
            <label htmlFor="mapping-branch-select" className="text-xs font-medium text-slate-600">
              Branch:
            </label>
            <select
              id="mapping-branch-select"
              value={mappingBranchId}
              onChange={(e) => setMappingBranchId(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              {branches.map((b) => (
                <option key={b.branch_id} value={b.branch_id}>
                  {b.branch_name} ({b.country_code} · {b.currency_code})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* TAB 1: Branches & Countries */}
      {activeTab === 'branches' && (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">Hospital Branches</h3>
              <span className="text-xs text-slate-500">
                Select a branch to scope workspace views
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Country &amp; City</th>
                    <th className="px-4 py-3">Timezone</th>
                    <th className="px-4 py-3">Currency</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {branches.map((b) => {
                    const isFocused = selectedBranchId === b.branch_id;
                    return (
                      <tr key={b.branch_id} className={isFocused ? 'bg-teal-50/40' : 'hover:bg-slate-50'}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{b.branch_name}</div>
                          <div className="text-xs text-slate-500 font-mono">
                            {b.branch_code}
                            {b.is_headquarters === 'Y' ? ' · Headquarters (Legacy Rollup)' : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <div>{b.city}, {b.country_name}</div>
                          <div className="text-xs text-slate-500">{b.address_line || 'Regional Clinic'}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{b.timezone_iana}</td>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                          {b.currency_code}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">
                          <span className={b.is_active === 'Y' ? 'text-emerald-700' : 'text-slate-500'}>
                            {b.is_active === 'Y' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedBranchId(isFocused ? 'ALL' : b.branch_id)}
                              className={`rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                                isFocused
                                  ? 'border-teal-700 bg-teal-700 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {isFocused ? 'Focused' : 'Focus Workspace'}
                            </button>
                            {canManage && b.is_headquarters !== 'Y' && (
                              <button
                                type="button"
                                onClick={() => void handleToggleBranchStatus(b.branch_id, b.is_active)}
                                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                              >
                                {b.is_active === 'Y' ? 'Deactivate' : 'Activate'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Countries Directory */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">Supported Countries &amp; FX Rates</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Country</th>
                    <th className="px-4 py-3">ISO Code</th>
                    <th className="px-4 py-3">Currency</th>
                    <th className="px-4 py-3">Dial Code</th>
                    <th className="px-4 py-3">Default Timezone</th>
                    <th className="px-4 py-3 text-right">FX Rate to INR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {countries.map((c) => (
                    <tr key={c.country_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{c.country_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{c.country_code}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {c.currency_code} ({c.currency_symbol})
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{c.phone_dial_code}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{c.default_timezone}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {Number(c.fx_rate_to_inr).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Branch Specializations */}
      {activeTab === 'departments' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Specialized Departments · {selectedMappingBranch?.branch_name}
              </h3>
              <p className="text-xs text-slate-500">
                Configure which departments operate at this branch and set branch-local consultation fees.
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setAssignDeptId(String(departments[0]?.department_id ?? ''));
                  setDeptModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
              >
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Assign Department</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Center of Excellence</th>
                  <th className="px-4 py-3 text-right">Local Consultation Fee</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branchDeptRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                      No departments explicitly mapped to this branch yet.
                    </td>
                  </tr>
                ) : (
                  branchDeptRows.map((row) => (
                    <tr key={`${row.branch_id}-${row.department_id}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.department_name}</td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {row.is_specialized === 'Y' ? 'Specialized Hub' : 'Standard OPD'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {row.local_consultation_fee != null
                          ? formatBranchCurrency(
                              row.local_consultation_fee,
                              selectedMappingBranch?.currency_code,
                            )
                          : 'Auto FX from Doctor Fee'}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">
                        <span className={row.is_active === 'Y' ? 'text-emerald-700' : 'text-slate-500'}>
                          {row.is_active === 'Y' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Doctor Assignments */}
      {activeTab === 'doctors' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Doctors Practicing at {selectedMappingBranch?.branch_name}
              </h3>
              <p className="text-xs text-slate-500">
                Doctors can serve across multiple global branches while keeping one designated primary branch.
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setAssignDocId(String(doctors[0]?.doctor_id ?? ''));
                  setDocModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
              >
                <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Assign Doctor</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Doctor</th>
                  <th className="px-4 py-3">Department &amp; Specialty</th>
                  <th className="px-4 py-3">Assignment Type</th>
                  <th className="px-4 py-3 text-right">Local Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branchDoctorRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                      No doctors assigned to this branch yet.
                    </td>
                  </tr>
                ) : (
                  branchDoctorRows.map((row) => (
                    <tr key={`${row.branch_id}-${row.doctor_id}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.doctor_name}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {row.department_name} · {row.specialization}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-700">
                        {row.is_primary_branch === 'Y' ? 'Primary Home Branch' : 'Visiting / Multi-Branch'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {row.local_consultation_fee != null
                          ? formatBranchCurrency(
                              row.local_consultation_fee,
                              selectedMappingBranch?.currency_code,
                            )
                          : 'Auto FX'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: Global Utilization */}
      {activeTab === 'utilisation' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">
              Cross-Branch Utilization &amp; Multi-Currency Revenue
            </h3>
            <p className="text-xs text-slate-500">
              Legacy appointments and voice bookings without a GBR_APPT_BRANCH row are automatically rolled into Bengaluru HQ.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3 text-right">Doctors</th>
                  <th className="px-4 py-3 text-right">Slots (Booked/Total)</th>
                  <th className="px-4 py-3 text-right">Appointments</th>
                  <th className="px-4 py-3 text-right">Local Revenue</th>
                  <th className="px-4 py-3 text-right">Base INR Equivalent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {utilisation.map((row) => (
                  <tr key={row.branch_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.branch_name}</div>
                      <div className="text-xs text-slate-500">
                        {row.city}, {row.country_name} · {row.timezone_iana}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-800 tabular-nums">
                      {row.active_doctors}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-800 tabular-nums">
                      {row.booked_slots} / {row.total_slots}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-800 tabular-nums">
                      {row.total_appointments} ({row.completed_appointments} done)
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-teal-800 tabular-nums">
                      {formatBranchCurrency(row.total_local_revenue, row.currency_code)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {formatBranchCurrency(row.total_inr_revenue, 'INR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Country Modal */}
      <Modal
        open={countryModalOpen}
        onClose={() => setCountryModalOpen(false)}
        title="Add Country to Global CarePulse"
        subtitle="Creates a country entry in GBR_COUNTRIES without touching legacy tables."
      >
        <form onSubmit={handleSaveCountry} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Country Code *</label>
              <input
                type="text"
                value={cCode}
                onChange={(e) => setCCode(e.target.value.toUpperCase())}
                placeholder="JP"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Country Name *</label>
              <input
                type="text"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="Japan"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Currency Code *</label>
              <input
                type="text"
                value={cCurrency}
                onChange={(e) => setCCurrency(e.target.value.toUpperCase())}
                placeholder="JPY"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Currency Symbol</label>
              <input
                type="text"
                value={cSymbol}
                onChange={(e) => setCSymbol(e.target.value)}
                placeholder="¥"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Dial Code</label>
              <input
                type="text"
                value={cDial}
                onChange={(e) => setCDial(e.target.value)}
                placeholder="+81"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">FX Rate to INR *</label>
              <input
                type="number"
                step="0.01"
                value={cFx}
                onChange={(e) => setCFx(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Default IANA Timezone</label>
            <input
              type="text"
              value={cTz}
              onChange={(e) => setCTz(e.target.value)}
              placeholder="Asia/Tokyo"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCountryModalOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingCountry}
              className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {savingCountry ? 'Saving...' : 'Save Country'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Branch Modal */}
      <Modal
        open={branchModalOpen}
        onClose={() => setBranchModalOpen(false)}
        title="Create Hospital Branch"
        subtitle="Adds a new regional branch into GBR_BRANCHES."
      >
        <form onSubmit={handleCreateBranch} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Country *</label>
              <select
                value={bCountryId}
                onChange={(e) => setBCountryId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {countries.map((c) => (
                  <option key={c.country_id} value={c.country_id}>
                    {c.country_name} ({c.currency_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Branch Code *</label>
              <input
                type="text"
                value={bCode}
                onChange={(e) => setBCode(e.target.value.toUpperCase())}
                placeholder="AE-AUH-01"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Branch Name *</label>
              <input
                type="text"
                value={bName}
                onChange={(e) => setBName(e.target.value)}
                placeholder="CarePulse Abu Dhabi Corniche"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">City *</label>
              <input
                type="text"
                value={bCity}
                onChange={(e) => setBCity(e.target.value)}
                placeholder="Abu Dhabi"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Street Address</label>
            <input
              type="text"
              value={bAddress}
              onChange={(e) => setBAddress(e.target.value)}
              placeholder="Corniche Road, Tower B"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Phone</label>
              <input
                type="text"
                value={bPhone}
                onChange={(e) => setBPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={bEmail}
                onChange={(e) => setBEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Timezone</label>
              <input
                type="text"
                value={bTz}
                onChange={(e) => setBTz(e.target.value)}
                placeholder="Auto from country"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setBranchModalOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingBranch}
              className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {savingBranch ? 'Creating...' : 'Create Branch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Assign Department Modal */}
      <Modal
        open={deptModalOpen}
        onClose={() => setDeptModalOpen(false)}
        title={`Assign Department · ${selectedMappingBranch?.branch_name || ''}`}
      >
        <form onSubmit={handleAssignDept} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Department *</label>
            <select
              value={assignDeptId}
              onChange={(e) => setAssignDeptId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {departments.map((d) => (
                <option key={d.department_id} value={d.department_id}>
                  {d.department_name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Specialization</label>
              <select
                value={assignDeptSpec}
                onChange={(e) => setAssignDeptSpec(e.target.value as 'Y' | 'N')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="Y">Specialized Hub</option>
                <option value="N">Standard OPD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Local Fee ({selectedMappingBranch?.currency_code || 'INR'})
              </label>
              <input
                type="number"
                step="0.01"
                value={assignDeptFee}
                onChange={(e) => setAssignDeptFee(e.target.value)}
                placeholder="Optional override"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeptModalOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDeptMap}
              className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {savingDeptMap ? 'Saving...' : 'Save Department'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Assign Doctor Modal */}
      <Modal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        title={`Assign Doctor · ${selectedMappingBranch?.branch_name || ''}`}
      >
        <form onSubmit={handleAssignDoctor} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Doctor *</label>
            <select
              value={assignDocId}
              onChange={(e) => setAssignDocId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {doctors.map((d) => (
                <option key={d.doctor_id} value={d.doctor_id}>
                  Dr. {d.first_name} {d.last_name} ({d.specialization || 'General'})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Primary Home Branch</label>
              <select
                value={assignDocPrimary}
                onChange={(e) => setAssignDocPrimary(e.target.value as 'Y' | 'N')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="N">Visiting / Secondary</option>
                <option value="Y">Primary Branch</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Local Fee ({selectedMappingBranch?.currency_code || 'INR'})
              </label>
              <input
                type="number"
                step="0.01"
                value={assignDocFee}
                onChange={(e) => setAssignDocFee(e.target.value)}
                placeholder="Optional override"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDocModalOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDocMap}
              className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {savingDocMap ? 'Saving...' : 'Assign Doctor'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
