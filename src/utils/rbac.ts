import type {
  AccountStatus,
  AuthUser,
  ModuleDefinition,
  ModuleKey,
  PermissionAction,
  RoleName,
  SecuritySettings,
  UserPermissionOverride,
} from '../types/opd.ts';

export const SUPER_ADMIN_USER_ID = 9001;
export const SUPER_ADMIN_NAME = 'Karan Tulsani';
export const SUPER_ADMIN_USERNAME = 'karan.tulsani';
export const SUPER_ADMIN_EMAIL = 'karan.tulsani@hospital.com';

export const SINGLE_ADMIN_NAME = 'Girish DR';
export const SINGLE_ADMIN_EMAIL = 'girishramachandra12dr@gmail.com';

export const PROTECTED_CORE_ROLES: RoleName[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'DOCTOR',
  'RECEPTIONIST',
  'PATIENT',
];

export const ROLE_META: Record<
  RoleName,
  {
    label: string;
    description: string;
    isProtected: boolean;
    isImmutable: boolean;
    allowPublicRegistration: boolean;
    maxAccounts: number | null;
  }
> = {
  SUPER_ADMIN: {
    label: 'Super Admin',
    description:
      'Immutable root system administrator with complete governance over users, roles, granular permissions, audit trails, and security policies.',
    isProtected: true,
    isImmutable: true,
    allowPublicRegistration: false,
    maxAccounts: 1,
  },
  ADMIN: {
    label: 'Administrator',
    description:
      'Manages hospital operations, clinical departments, doctor onboarding, leave/shift approvals, and operational analytics.',
    isProtected: true,
    isImmutable: false,
    allowPublicRegistration: false,
    maxAccounts: null,
  },
  DOCTOR: {
    label: 'Doctor',
    description:
      'Manages assigned patient appointments, daily slot schedules, token consultations, medical records, and prescriptions.',
    isProtected: true,
    isImmutable: false,
    allowPublicRegistration: false,
    maxAccounts: null,
  },
  RECEPTIONIST: {
    label: 'Receptionist',
    description:
      'Manages walk-in & online appointment bookings, patient registration, front-desk check-ins, token queue, and fee collection.',
    isProtected: true,
    isImmutable: false,
    allowPublicRegistration: false,
    maxAccounts: null,
  },
  PATIENT: {
    label: 'Patient',
    description:
      'Self-service portal to manage personal profile, book appointments, inspect queue tokens, and view permitted medical records & receipts.',
    isProtected: true,
    isImmutable: false,
    allowPublicRegistration: true,
    maxAccounts: null,
  },
};

export const ALL_PERMISSION_ACTIONS: PermissionAction[] = [
  'VIEW',
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXPORT',
];

export const RBAC_MODULES: ModuleDefinition[] = [
  {
    key: 'DASHBOARD',
    label: 'Dashboard',
    category: 'Overview',
    supportedActions: ['VIEW'],
    description: 'Access role-appropriate hospital dashboard overview.',
  },
  {
    key: 'PATIENTS',
    label: 'Patient Management',
    category: 'Clinical',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'View, register, update, deactivate, or export patient directory records.',
  },
  {
    key: 'DOCTORS',
    label: 'Doctor Management',
    category: 'Clinical',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'View and manage medical practitioners, fees, and clinical profiles.',
  },
  {
    key: 'RECEPTIONISTS',
    label: 'Receptionist Management',
    category: 'Administration',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'View and provision front-desk receptionist staff accounts.',
  },
  {
    key: 'DEPARTMENTS',
    label: 'Department Management',
    category: 'Clinical',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'Manage clinical departments and consultation service types.',
  },
  {
    key: 'APPOINTMENTS',
    label: 'Appointment Management',
    category: 'Operations',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'Inspect bookings, book slots, confirm, update outcomes, or cancel appointments.',
  },
  {
    key: 'SLOTS',
    label: 'Slot Management',
    category: 'Operations',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'Inspect doctor shift windows, open daily OPD slots, and manage leave schedules.',
  },
  {
    key: 'TOKEN_QUEUE',
    label: 'Token Queue',
    category: 'Operations',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'Check in patients, issue daily queue tokens, and advance consultation status.',
  },
  {
    key: 'PAYMENTS',
    label: 'Payment Management',
    category: 'Operations',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'View fee receipts, record consultation payments, and manage refunds.',
  },
  {
    key: 'MEDICAL_RECORDS',
    label: 'Medical Records',
    category: 'Clinical',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'Access and record outpatient clinical notes, vitals, and visit diagnoses.',
  },
  {
    key: 'PRESCRIPTIONS',
    label: 'Prescription Management',
    category: 'Clinical',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'View, issue, and update digital outpatient medication prescriptions.',
  },
  {
    key: 'REVENUE_ANALYTICS',
    label: 'Revenue Analytics',
    category: 'Analytics',
    supportedActions: ['VIEW', 'EXPORT'],
    description: 'View OPD revenue totals, payment mix, and monthly financial trends.',
  },
  {
    key: 'DOCTOR_ANALYTICS',
    label: 'Doctor Analytics',
    category: 'Analytics',
    supportedActions: ['VIEW', 'EXPORT'],
    description: 'View doctor visit leaderboards, fulfillment rates, and peak hours.',
  },
  {
    key: 'DEPARTMENT_ANALYTICS',
    label: 'Department Analytics',
    category: 'Analytics',
    supportedActions: ['VIEW', 'EXPORT'],
    description: 'View consultation volume and share across hospital departments.',
  },
  {
    key: 'GEOGRAPHIC_ANALYTICS',
    label: 'Geographic Analytics',
    category: 'Analytics',
    supportedActions: ['VIEW', 'EXPORT'],
    description: 'View top patient cities, localities, and regional catchment insights.',
  },
  {
    key: 'USERS',
    label: 'User Management',
    category: 'Administration',
    supportedActions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'],
    description: 'Manage accounts, activation/suspension states, and password resets.',
  },
  {
    key: 'ROLES',
    label: 'Role Management',
    category: 'Administration',
    supportedActions: ['VIEW', 'UPDATE'],
    description: 'Inspect system roles, role counts, and modify user role assignments.',
  },
  {
    key: 'PERMISSIONS',
    label: 'Permission Management',
    category: 'Administration',
    supportedActions: ['VIEW', 'UPDATE'],
    description: 'Configure role permission matrix and individual user permission overrides.',
  },
  {
    key: 'SYSTEM_SETTINGS',
    label: 'System Settings',
    category: 'Administration',
    supportedActions: ['VIEW', 'UPDATE'],
    description: 'Manage security settings, lockout thresholds, audit inspection, and policies.',
  },
];

export function makePermKey(moduleKey: ModuleKey, action: PermissionAction): string {
  return `${moduleKey}:${action}`;
}

export const ALL_CANONICAL_PERMISSIONS: string[] = RBAC_MODULES.flatMap((mod) =>
  mod.supportedActions.map((act) => makePermKey(mod.key, act)),
);

const VALID_CANONICAL_SET = new Set(ALL_CANONICAL_PERMISSIONS);

export const DEFAULT_ROLE_PERMISSION_MATRIX: Record<RoleName, string[]> = {
  SUPER_ADMIN: [...ALL_CANONICAL_PERMISSIONS],
  ADMIN: [
    'DASHBOARD:VIEW',
    'PATIENTS:VIEW',
    'PATIENTS:EXPORT',
    'DOCTORS:VIEW',
    'DOCTORS:CREATE',
    'DOCTORS:UPDATE',
    'DOCTORS:DELETE',
    'DOCTORS:EXPORT',
    'RECEPTIONISTS:VIEW',
    'RECEPTIONISTS:CREATE',
    'RECEPTIONISTS:UPDATE',
    'RECEPTIONISTS:DELETE',
    'DEPARTMENTS:VIEW',
    'DEPARTMENTS:CREATE',
    'DEPARTMENTS:UPDATE',
    'DEPARTMENTS:DELETE',
    'APPOINTMENTS:VIEW',
    'APPOINTMENTS:UPDATE',
    'APPOINTMENTS:DELETE',
    'APPOINTMENTS:EXPORT',
    'SLOTS:VIEW',
    'SLOTS:UPDATE',
    'TOKEN_QUEUE:VIEW',
    'TOKEN_QUEUE:CREATE',
    'TOKEN_QUEUE:UPDATE',
    'PAYMENTS:VIEW',
    'PAYMENTS:CREATE',
    'PAYMENTS:UPDATE',
    'PAYMENTS:EXPORT',
    'MEDICAL_RECORDS:VIEW',
    'PRESCRIPTIONS:VIEW',
    'REVENUE_ANALYTICS:VIEW',
    'REVENUE_ANALYTICS:EXPORT',
    'DOCTOR_ANALYTICS:VIEW',
    'DOCTOR_ANALYTICS:EXPORT',
    'DEPARTMENT_ANALYTICS:VIEW',
    'DEPARTMENT_ANALYTICS:EXPORT',
    'GEOGRAPHIC_ANALYTICS:VIEW',
    'GEOGRAPHIC_ANALYTICS:EXPORT',
    'USERS:VIEW',
    'USERS:CREATE',
    'ROLES:VIEW',
  ],
  DOCTOR: [
    'DASHBOARD:VIEW',
    'PATIENTS:VIEW',
    'APPOINTMENTS:VIEW',
    'APPOINTMENTS:UPDATE',
    'SLOTS:VIEW',
    'SLOTS:CREATE',
    'SLOTS:UPDATE',
    'TOKEN_QUEUE:VIEW',
    'TOKEN_QUEUE:UPDATE',
    'MEDICAL_RECORDS:VIEW',
    'MEDICAL_RECORDS:CREATE',
    'MEDICAL_RECORDS:UPDATE',
    'PRESCRIPTIONS:VIEW',
    'PRESCRIPTIONS:CREATE',
    'PRESCRIPTIONS:UPDATE',
  ],
  RECEPTIONIST: [
    'DASHBOARD:VIEW',
    'PATIENTS:VIEW',
    'PATIENTS:CREATE',
    'PATIENTS:UPDATE',
    'APPOINTMENTS:VIEW',
    'APPOINTMENTS:CREATE',
    'APPOINTMENTS:UPDATE',
    'APPOINTMENTS:DELETE',
    'SLOTS:VIEW',
    'TOKEN_QUEUE:VIEW',
    'TOKEN_QUEUE:CREATE',
    'TOKEN_QUEUE:UPDATE',
    'PAYMENTS:VIEW',
    'PAYMENTS:CREATE',
  ],
  PATIENT: [
    'DASHBOARD:VIEW',
    'APPOINTMENTS:VIEW',
    'APPOINTMENTS:CREATE',
    'APPOINTMENTS:UPDATE',
    'APPOINTMENTS:DELETE',
    'SLOTS:VIEW',
    'TOKEN_QUEUE:VIEW',
    'PAYMENTS:VIEW',
    'MEDICAL_RECORDS:VIEW',
    'PRESCRIPTIONS:VIEW',
  ],
};

// Map legacy permission identifiers to canonical MODULE:ACTION keys so existing code checks seamlessly
export const LEGACY_PERMISSION_MAP: Record<string, string> = {
  VIEW_DASHBOARD: 'DASHBOARD:VIEW',
  VIEW_PATIENTS: 'PATIENTS:VIEW',
  MANAGE_PATIENTS: 'PATIENTS:CREATE',
  MANAGE_DOCTORS: 'DOCTORS:CREATE',
  MANAGE_DEPARTMENTS: 'DEPARTMENTS:CREATE',
  VIEW_APPOINTMENTS: 'APPOINTMENTS:VIEW',
  CREATE_APPOINTMENTS: 'APPOINTMENTS:CREATE',
  UPDATE_APPOINTMENTS: 'APPOINTMENTS:UPDATE',
  CANCEL_APPOINTMENTS: 'APPOINTMENTS:DELETE',
  VIEW_SLOTS: 'SLOTS:VIEW',
  MANAGE_SLOTS: 'SLOTS:CREATE',
  REQUEST_LEAVE: 'SLOTS:CREATE',
  VIEW_LEAVES: 'SLOTS:VIEW',
  APPROVE_LEAVES: 'SLOTS:UPDATE',
  MANAGE_APPROVALS: 'SLOTS:UPDATE',
  VIEW_PAYMENTS: 'PAYMENTS:VIEW',
  RECORD_PAYMENTS: 'PAYMENTS:CREATE',
  VIEW_TOKENS: 'TOKEN_QUEUE:VIEW',
  MANAGE_TOKENS: 'TOKEN_QUEUE:UPDATE',
  VIEW_USERS: 'USERS:VIEW',
  MANAGE_USERS: 'USERS:CREATE',
  MANAGE_ROLES: 'ROLES:UPDATE',
  VIEW_AUDIT_LOGS: 'SYSTEM_SETTINGS:VIEW',
  VIEW_ERROR_LOGS: 'SYSTEM_SETTINGS:VIEW',
};

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  max_failed_login_attempts: 5,
  lockout_minutes: 15,
  min_password_length: 6,
  session_ttl_hours: 12,
  allow_patient_registration: true,
  enforce_strict_role_portal: true,
};

export function normalizeCanonicalPermissions(list: string[]): string[] {
  const seen = new Set<string>();
  for (const item of list) {
    const clean = String(item || '').trim().toUpperCase();
    if (VALID_CANONICAL_SET.has(clean)) {
      seen.add(clean);
    } else if (LEGACY_PERMISSION_MAP[clean]) {
      seen.add(LEGACY_PERMISSION_MAP[clean]);
    }
  }
  return Array.from(seen);
}

export function computeEffectivePermissions(
  role: RoleName,
  roleMatrix: Record<RoleName, string[]> = DEFAULT_ROLE_PERMISSION_MATRIX,
  override?: UserPermissionOverride | null,
): string[] {
  if (role === 'SUPER_ADMIN') {
    return [...ALL_CANONICAL_PERMISSIONS];
  }
  const base = normalizeCanonicalPermissions(
    roleMatrix[role] ?? DEFAULT_ROLE_PERMISSION_MATRIX[role] ?? [],
  );
  const set = new Set<string>(base);

  if (override) {
    for (const g of normalizeCanonicalPermissions(override.grants || [])) {
      set.add(g);
    }
    for (const r of normalizeCanonicalPermissions(override.revokes || [])) {
      set.delete(r);
    }
  }

  return Array.from(set);
}

export function diffPermissionSets(
  before: string[],
  after: string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(normalizeCanonicalPermissions(before));
  const afterSet = new Set(normalizeCanonicalPermissions(after));
  const added = Array.from(afterSet).filter((p) => !beforeSet.has(p)).sort();
  const removed = Array.from(beforeSet).filter((p) => !afterSet.has(p)).sort();
  return { added, removed };
}

export function hasEffectivePermission(
  permissions: string[] | undefined | null,
  role: RoleName | undefined,
  requiredPermission?: string,
): boolean {
  if (!requiredPermission) return true;
  if (role === 'SUPER_ADMIN') return true;
  if (!Array.isArray(permissions) || permissions.length === 0) return false;

  const upper = requiredPermission.trim().toUpperCase();
  const canonical = LEGACY_PERMISSION_MAP[upper] || upper;
  return permissions.includes(canonical) || permissions.includes(upper);
}

export function hasAnyEffectivePermission(
  permissions: string[] | undefined | null,
  role: RoleName | undefined,
  candidates: string[],
): boolean {
  return candidates.some((p) => hasEffectivePermission(permissions, role, p));
}

export function isProtectedSuperAdminIdentity(input: {
  role?: RoleName;
  email?: string | null;
  username?: string | null;
  full_name?: string | null;
}): boolean {
  if (input.role === 'SUPER_ADMIN') return true;
  const email = (input.email || '').trim().toLowerCase();
  const username = (input.username || '').trim().toLowerCase();
  return email === SUPER_ADMIN_EMAIL.toLowerCase() || username === SUPER_ADMIN_USERNAME.toLowerCase();
}

export interface TargetMutationCheck {
  allowed: boolean;
  reason?: string;
}

export function canActorModifyTargetUser(
  actor: Pick<AuthUser, 'user_id' | 'email' | 'role' | 'permissions'>,
  target: {
    user_id?: number;
    email?: string | null;
    role: RoleName;
    status?: AccountStatus;
  },
  operation: 'STATUS' | 'ROLE' | 'PERMISSIONS' | 'RESET_PASSWORD',
  newRole?: RoleName,
): TargetMutationCheck {
  const targetIsSuperAdmin = isProtectedSuperAdminIdentity({
    role: target.role,
    email: target.email,
  });

  if (targetIsSuperAdmin) {
    return {
      allowed: false,
      reason: `Super Admin (${SUPER_ADMIN_NAME}) is a protected system account and cannot be modified, suspended, deactivated, or demoted.`,
    };
  }

  const sameEmail =
    Boolean(actor.email && target.email) &&
    actor.email.trim().toLowerCase() === String(target.email).trim().toLowerCase();
  const sameId = Boolean(actor.user_id && target.user_id && actor.user_id === target.user_id);

  if (sameEmail || sameId) {
    if (operation === 'STATUS') {
      return { allowed: false, reason: 'You cannot suspend or deactivate your own active account.' };
    }
    if (operation === 'ROLE') {
      return { allowed: false, reason: 'Users cannot modify their own assigned role.' };
    }
    if (operation === 'PERMISSIONS') {
      return { allowed: false, reason: 'Users cannot modify their own permissions.' };
    }
  }

  const neededPerm =
    operation === 'PERMISSIONS'
      ? 'PERMISSIONS:UPDATE'
      : operation === 'ROLE'
        ? 'ROLES:UPDATE'
        : 'USERS:UPDATE';

  if (!hasEffectivePermission(actor.permissions, actor.role, neededPerm)) {
    return {
      allowed: false,
      reason: `Missing required permission (${neededPerm}). Access denied by default.`,
    };
  }

  if (operation === 'ROLE' && newRole === 'SUPER_ADMIN') {
    return {
      allowed: false,
      reason: 'SUPER_ADMIN is strictly reserved for the single initial setup account and cannot be assigned.',
    };
  }

  if (actor.role !== 'SUPER_ADMIN') {
    if (target.role === 'ADMIN' || newRole === 'ADMIN') {
      return {
        allowed: false,
        reason: 'Only the Super Admin can manage Administrator accounts or assign the ADMIN role.',
      };
    }
    if (operation === 'PERMISSIONS') {
      return {
        allowed: false,
        reason: 'Only the Super Admin can grant or revoke individual user permissions.',
      };
    }
  }

  return { allowed: true };
}
