import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  GlobalBranch,
  GlobalBranchDepartment,
  GlobalCountry,
  GlobalDoctorBranch,
} from '../types/opd';
import { apiClient } from '../services/apiClient';
import { useAuth } from './AuthContext';
import { getHeadquartersBranch } from '../utils/globalBranch';

interface BranchContextValue {
  loading: boolean;
  globalOrdsLive: boolean;
  countries: GlobalCountry[];
  branches: GlobalBranch[];
  branchDepartments: GlobalBranchDepartment[];
  doctorBranches: GlobalDoctorBranch[];
  headquartersBranch: GlobalBranch | null;
  selectedCountryCode: string;
  selectedBranchId: number | 'ALL';
  activeBranch: GlobalBranch | null;
  setSelectedCountryCode: (code: string) => void;
  setSelectedBranchId: (id: number | 'ALL') => void;
  refreshGlobalContext: () => Promise<void>;
}

const BranchContext = createContext<BranchContextValue | null>(null);

const STORAGE_BRANCH_KEY = 'carepulse_global_selected_branch';
const STORAGE_COUNTRY_KEY = 'carepulse_global_selected_country';

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [globalOrdsLive, setGlobalOrdsLive] = useState(false);
  const [countries, setCountries] = useState<GlobalCountry[]>([]);
  const [branches, setBranches] = useState<GlobalBranch[]>([]);
  const [branchDepartments, setBranchDepartments] = useState<GlobalBranchDepartment[]>([]);
  const [doctorBranches, setDoctorBranches] = useState<GlobalDoctorBranch[]>([]);

  const [selectedCountryCode, setSelectedCountryCodeState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_COUNTRY_KEY) || 'ALL';
    } catch {
      return 'ALL';
    }
  });
  const [selectedBranchId, setSelectedBranchIdState] = useState<number | 'ALL'>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_BRANCH_KEY);
      if (!raw || raw === 'ALL') return 'ALL';
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 'ALL';
    } catch {
      return 'ALL';
    }
  });

  const refreshGlobalContext = useCallback(async () => {
    if (!user) {
      setCountries([]);
      setBranches([]);
      setBranchDepartments([]);
      setDoctorBranches([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.getGlobalContext();
      setGlobalOrdsLive(Boolean(res.global_ords_live));
      setCountries(res.countries || []);
      setBranches(res.branches || []);
      setBranchDepartments(res.branch_departments || []);
      setDoctorBranches(res.doctor_branches || []);
    } catch {
      // Non-fatal fallback if global sidecar is temporarily unreachable
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshGlobalContext();
  }, [refreshGlobalContext]);

  const setSelectedCountryCode = useCallback(
    (code: string) => {
      setSelectedCountryCodeState(code);
      try {
        window.localStorage.setItem(STORAGE_COUNTRY_KEY, code);
      } catch {
        // Ignore storage error
      }
      if (code !== 'ALL' && selectedBranchId !== 'ALL') {
        const currentBranch = branches.find((b) => b.branch_id === selectedBranchId);
        if (currentBranch && currentBranch.country_code !== code) {
          const firstMatching = branches.find((b) => b.country_code === code && b.is_active === 'Y');
          const nextId = firstMatching ? firstMatching.branch_id : 'ALL';
          setSelectedBranchIdState(nextId);
          try {
            window.localStorage.setItem(STORAGE_BRANCH_KEY, String(nextId));
          } catch {
            // Ignore
          }
        }
      }
    },
    [branches, selectedBranchId],
  );

  const setSelectedBranchId = useCallback(
    (id: number | 'ALL') => {
      setSelectedBranchIdState(id);
      try {
        window.localStorage.setItem(STORAGE_BRANCH_KEY, String(id));
      } catch {
        // Ignore
      }
      if (id !== 'ALL') {
        const branch = branches.find((b) => b.branch_id === id);
        if (branch && selectedCountryCode !== 'ALL' && branch.country_code !== selectedCountryCode) {
          setSelectedCountryCodeState(branch.country_code);
          try {
            window.localStorage.setItem(STORAGE_COUNTRY_KEY, branch.country_code);
          } catch {
            // Ignore
          }
        }
      }
    },
    [branches, selectedCountryCode],
  );

  const headquartersBranch = useMemo(() => getHeadquartersBranch(branches), [branches]);
  const activeBranch = useMemo(
    () =>
      selectedBranchId === 'ALL'
        ? null
        : branches.find((b) => b.branch_id === selectedBranchId) || null,
    [branches, selectedBranchId],
  );

  const value = useMemo<BranchContextValue>(
    () => ({
      loading,
      globalOrdsLive,
      countries,
      branches,
      branchDepartments,
      doctorBranches,
      headquartersBranch,
      selectedCountryCode,
      selectedBranchId,
      activeBranch,
      setSelectedCountryCode,
      setSelectedBranchId,
      refreshGlobalContext,
    }),
    [
      loading,
      globalOrdsLive,
      countries,
      branches,
      branchDepartments,
      doctorBranches,
      headquartersBranch,
      selectedCountryCode,
      selectedBranchId,
      activeBranch,
      setSelectedCountryCode,
      setSelectedBranchId,
      refreshGlobalContext,
    ],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranchContext(): BranchContextValue {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error('useBranchContext must be used inside BranchProvider');
  }
  return ctx;
}
