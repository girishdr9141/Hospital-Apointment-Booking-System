import type {
  Appointment,
  Department,
  Doctor,
  GlobalBranch,
  GlobalBranchDepartment,
  GlobalBranchMetadata,
  GlobalBranchUtilisationRow,
  GlobalCountry,
  GlobalDoctorBranch,
  GlobalPaymentBranchLink,
  Payment,
  Slot,
} from '../types/opd.ts';

export function getHeadquartersBranch(branches: GlobalBranch[]): GlobalBranch | null {
  return (
    branches.find((b) => b.is_headquarters === 'Y' && b.is_active === 'Y') ||
    branches.find((b) => b.is_headquarters === 'Y') ||
    branches[0] ||
    null
  );
}

export function buildBranchMetadata(
  branch: GlobalBranch | null | undefined,
  countries: GlobalCountry[],
  resolution: 'LINKED' | 'HQ_DEFAULT',
): GlobalBranchMetadata | null {
  if (!branch) return null;
  const country = countries.find((c) => c.country_id === branch.country_id);
  return {
    branch_id: branch.branch_id,
    branch_code: branch.branch_code,
    branch_name: branch.branch_name,
    city: branch.city,
    country_code: branch.country_code || country?.country_code || 'IN',
    country_name: branch.country_name || country?.country_name || 'India',
    timezone_iana: branch.timezone_iana || country?.default_timezone || 'Asia/Kolkata',
    currency_code: branch.currency_code || country?.currency_code || 'INR',
    currency_symbol: branch.currency_symbol || country?.currency_symbol || '₹',
    fx_rate_to_inr: Number(branch.fx_rate_to_inr || country?.fx_rate_to_inr || 1),
    is_headquarters: branch.is_headquarters === 'Y',
    resolution,
  };
}

export function resolveBranchForRecord(
  linkedBranchId: number | null | undefined,
  branches: GlobalBranch[],
  countries: GlobalCountry[],
): GlobalBranchMetadata | null {
  const hq = getHeadquartersBranch(branches);
  if (linkedBranchId) {
    const matched = branches.find((b) => b.branch_id === linkedBranchId);
    if (matched) {
      return buildBranchMetadata(matched, countries, 'LINKED');
    }
  }
  return buildBranchMetadata(hq, countries, 'HQ_DEFAULT');
}

export function convertInrToBranchCurrency(
  inrAmount: number,
  fxRateToInr: number,
  currencyCode: string,
): number {
  const safeInr = Number(inrAmount || 0);
  const safeFx = Number(fxRateToInr || 1);
  if (safeInr <= 0) return 0;
  if (currencyCode.toUpperCase() === 'INR' || safeFx <= 0) {
    return Math.round(safeInr * 100) / 100;
  }
  return Math.round((safeInr / safeFx) * 100) / 100;
}

export function formatBranchCurrency(
  amount: number | null | undefined,
  currencyCode = 'INR',
): string {
  const val = Number(amount ?? 0);
  const code = (currencyCode || 'INR').toUpperCase();
  const locale =
    code === 'INR'
      ? 'en-IN'
      : code === 'GBP'
        ? 'en-GB'
        : code === 'SGD'
          ? 'en-SG'
          : code === 'AED'
            ? 'en-AE'
            : 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(val);
  } catch {
    return `${code} ${val.toFixed(2)}`;
  }
}

export function filterDepartmentsByBranch(
  departments: Department[],
  branchDepartments: GlobalBranchDepartment[],
  branchId: number | 'ALL',
  branches: GlobalBranch[],
): Array<Department & { is_specialized?: boolean; local_consultation_fee?: number | null }> {
  if (branchId === 'ALL') return departments;
  const branch = branches.find((b) => b.branch_id === branchId);
  const activeMappings = branchDepartments.filter(
    (bd) => bd.branch_id === branchId && bd.is_active === 'Y',
  );

  // For Headquarters with no explicit subset mappings yet, preserve all active departments
  if (activeMappings.length === 0 && branch?.is_headquarters === 'Y') {
    return departments;
  }

  const mapByDept = new Map(activeMappings.map((m) => [m.department_id, m]));
  return departments
    .filter((d) => mapByDept.has(d.department_id))
    .map((d) => {
      const m = mapByDept.get(d.department_id)!;
      return {
        ...d,
        is_specialized: m.is_specialized === 'Y',
        local_consultation_fee: m.local_consultation_fee ?? null,
      };
    });
}

export function filterDoctorsByBranch(
  doctors: Doctor[],
  doctorBranches: GlobalDoctorBranch[],
  branchId: number | 'ALL',
  branches: GlobalBranch[],
): Array<Doctor & { is_primary_branch?: boolean; local_consultation_fee?: number | null }> {
  if (branchId === 'ALL') return doctors;
  const branch = branches.find((b) => b.branch_id === branchId);
  const activeMappings = doctorBranches.filter(
    (db) => db.branch_id === branchId && db.is_active === 'Y',
  );

  // If HQ has not explicitly excluded doctors, keep unmapped doctors visible under HQ
  if (branch?.is_headquarters === 'Y') {
    const mappedElsewhere = new Set(
      doctorBranches.filter((db) => db.is_active === 'Y').map((db) => db.doctor_id),
    );
    const hqMap = new Map(activeMappings.map((m) => [m.doctor_id, m]));
    return doctors
      .filter((doc) => hqMap.has(doc.doctor_id) || !mappedElsewhere.has(doc.doctor_id))
      .map((doc) => {
        const m = hqMap.get(doc.doctor_id);
        return {
          ...doc,
          is_primary_branch: m ? m.is_primary_branch === 'Y' : true,
          local_consultation_fee: m?.local_consultation_fee ?? doc.consultation_fee,
        };
      });
  }

  const mapByDoc = new Map(activeMappings.map((m) => [m.doctor_id, m]));
  return doctors
    .filter((doc) => mapByDoc.has(doc.doctor_id))
    .map((doc) => {
      const m = mapByDoc.get(doc.doctor_id)!;
      return {
        ...doc,
        is_primary_branch: m.is_primary_branch === 'Y',
        local_consultation_fee: m.local_consultation_fee ?? null,
      };
    });
}

export function getDoctorEffectiveBranchFee(params: {
  doctor: Doctor | undefined;
  branch: GlobalBranch | null;
  countries: GlobalCountry[];
  doctorBranches: GlobalDoctorBranch[];
  branchDepartments: GlobalBranchDepartment[];
}): { currency_code: string; local_amount: number; base_inr_amount: number; fx_rate_to_inr: number } {
  const { doctor, branch, countries, doctorBranches, branchDepartments } = params;
  const baseInr = Math.max(0, Number(doctor?.consultation_fee ?? 0));
  if (!branch) {
    return {
      currency_code: 'INR',
      local_amount: baseInr,
      base_inr_amount: baseInr,
      fx_rate_to_inr: 1,
    };
  }
  const country = countries.find((c) => c.country_id === branch.country_id);
  const currencyCode = branch.currency_code || country?.currency_code || 'INR';
  const fxRate = Number(branch.fx_rate_to_inr || country?.fx_rate_to_inr || 1);

  const docLink = doctor
    ? doctorBranches.find(
        (db) => db.doctor_id === doctor.doctor_id && db.branch_id === branch.branch_id && db.is_active === 'Y',
      )
    : undefined;
  if (docLink?.local_consultation_fee != null && Number(docLink.local_consultation_fee) > 0) {
    return {
      currency_code: currencyCode,
      local_amount: Number(docLink.local_consultation_fee),
      base_inr_amount: baseInr,
      fx_rate_to_inr: fxRate,
    };
  }

  const deptLink = doctor
    ? branchDepartments.find(
        (bd) =>
          bd.department_id === doctor.department_id &&
          bd.branch_id === branch.branch_id &&
          bd.is_active === 'Y',
      )
    : undefined;
  if (deptLink?.local_consultation_fee != null && Number(deptLink.local_consultation_fee) > 0) {
    return {
      currency_code: currencyCode,
      local_amount: Number(deptLink.local_consultation_fee),
      base_inr_amount: baseInr,
      fx_rate_to_inr: fxRate,
    };
  }

  return {
    currency_code: currencyCode,
    local_amount: convertInrToBranchCurrency(baseInr, fxRate, currencyCode),
    base_inr_amount: baseInr,
    fx_rate_to_inr: fxRate,
  };
}

export type BranchEnrichedSlot = Slot & { branch_meta?: GlobalBranchMetadata | null };
export type BranchEnrichedAppointment = Appointment & {
  branch_meta?: GlobalBranchMetadata | null;
  local_currency?: string | null;
  local_amount?: number | null;
};
export type BranchEnrichedPayment = Payment & {
  branch_meta?: GlobalBranchMetadata | null;
  local_currency?: string | null;
  local_amount?: number | null;
  fx_rate_to_inr?: number | null;
};

export function enrichSlotsWithBranch(
  slots: Slot[],
  slotBranchMap: Record<string, number>,
  branches: GlobalBranch[],
  countries: GlobalCountry[],
): BranchEnrichedSlot[] {
  return slots.map((s) => {
    const linkedBranchId = slotBranchMap[String(s.slot_id)];
    return {
      ...s,
      branch_meta: resolveBranchForRecord(linkedBranchId, branches, countries),
    };
  });
}

export function enrichAppointmentsWithBranch(
  appointments: Appointment[],
  apptBranchMap: Record<string, { branch_id: number; consultation_mode?: string }>,
  slotBranchMap: Record<string, number>,
  paymentBranchMap: Record<string, GlobalPaymentBranchLink>,
  branches: GlobalBranch[],
  countries: GlobalCountry[],
): BranchEnrichedAppointment[] {
  return appointments.map((a) => {
    const apptLink = apptBranchMap[String(a.appointment_id)] || apptBranchMap[a.appointment_ref];
    const slotBranchId = slotBranchMap[String(a.slot_id)];
    const payLink = paymentBranchMap[String(a.appointment_id)];
    const branchMeta = resolveBranchForRecord(
      apptLink?.branch_id ?? payLink?.branch_id ?? slotBranchId,
      branches,
      countries,
    );
    return {
      ...a,
      branch_meta: branchMeta,
      local_currency: payLink?.local_currency ?? branchMeta?.currency_code ?? 'INR',
      local_amount: payLink?.local_amount ?? null,
    };
  });
}

export function enrichPaymentsWithBranch(
  payments: Payment[],
  paymentBranchMap: Record<string, GlobalPaymentBranchLink>,
  apptBranchMap: Record<string, { branch_id: number }>,
  branches: GlobalBranch[],
  countries: GlobalCountry[],
): BranchEnrichedPayment[] {
  return payments.map((p) => {
    const payLink = paymentBranchMap[`pay:${p.payment_id}`] || paymentBranchMap[String(p.appointment_id)];
    const apptLink = apptBranchMap[String(p.appointment_id)] || apptBranchMap[p.appointment_ref];
    const branchMeta = resolveBranchForRecord(
      payLink?.branch_id ?? apptLink?.branch_id,
      branches,
      countries,
    );
    return {
      ...p,
      branch_meta: branchMeta,
      local_currency: payLink?.local_currency ?? branchMeta?.currency_code ?? 'INR',
      local_amount: payLink?.local_amount ?? p.amount,
      fx_rate_to_inr: payLink?.fx_rate_to_inr ?? branchMeta?.fx_rate_to_inr ?? 1,
    };
  });
}

export function computeBranchUtilisation(params: {
  branches: GlobalBranch[];
  countries: GlobalCountry[];
  slots: BranchEnrichedSlot[];
  appointments: BranchEnrichedAppointment[];
  payments: BranchEnrichedPayment[];
  doctorBranches: GlobalDoctorBranch[];
  branchDepartments: GlobalBranchDepartment[];
}): GlobalBranchUtilisationRow[] {
  const { branches, countries, slots, appointments, payments, doctorBranches, branchDepartments } = params;
  return branches.map((b) => {
    const country = countries.find((c) => c.country_id === b.country_id);
    const branchSlots = slots.filter((s) => s.branch_meta?.branch_id === b.branch_id);
    const branchAppts = appointments.filter((a) => a.branch_meta?.branch_id === b.branch_id);
    const branchPays = payments.filter(
      (p) => p.branch_meta?.branch_id === b.branch_id && p.status === 'SUCCESS',
    );
    return {
      branch_id: b.branch_id,
      branch_code: b.branch_code,
      branch_name: b.branch_name,
      city: b.city,
      country_code: b.country_code || country?.country_code || 'IN',
      country_name: b.country_name || country?.country_name || 'India',
      timezone_iana: b.timezone_iana,
      currency_code: b.currency_code,
      currency_symbol: b.currency_symbol || country?.currency_symbol || '₹',
      total_slots: branchSlots.length,
      booked_slots: branchSlots.filter((s) => s.booked_patients > 0 || s.status === 'SOLD_OUT').length,
      total_appointments: branchAppts.length,
      confirmed_appointments: branchAppts.filter((a) => a.status === 'CONFIRMED').length,
      completed_appointments: branchAppts.filter((a) => a.status === 'COMPLETED').length,
      total_local_revenue: Math.round(
        branchPays.reduce((sum, p) => sum + Number(p.local_amount ?? p.amount ?? 0), 0) * 100,
      ) / 100,
      total_inr_revenue: Math.round(
        branchPays.reduce((sum, p) => sum + Number(p.amount ?? 0), 0) * 100,
      ) / 100,
      active_doctors: doctorBranches.filter((db) => db.branch_id === b.branch_id && db.is_active === 'Y').length,
      specialized_departments: branchDepartments.filter(
        (bd) => bd.branch_id === b.branch_id && bd.is_active === 'Y' && bd.is_specialized === 'Y',
      ).length,
    };
  });
}
