import type {
  AuthUser,
  ModuleKey,
  NavItem,
  PermissionAction,
  RoleName,
  RouteKey,
} from '../types/opd.ts';
import {
  DEFAULT_ROLE_PERMISSION_MATRIX,
  ROLE_META,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_NAME,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_NAME,
  SUPER_ADMIN_USERNAME,
  RBAC_MODULES,
  canActorModifyTargetUser,
  computeEffectivePermissions,
  diffPermissionSets,
  hasAnyEffectivePermission,
  hasEffectivePermission,
  isProtectedSuperAdminIdentity,
} from './rbac.ts';

export {
  DEFAULT_ROLE_PERMISSION_MATRIX,
  ROLE_META,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_NAME,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_NAME,
  SUPER_ADMIN_USERNAME,
  RBAC_MODULES,
  canActorModifyTargetUser,
  computeEffectivePermissions,
  diffPermissionSets,
  hasAnyEffectivePermission,
  hasEffectivePermission,
  isProtectedSuperAdminIdentity,
};

export const ROLE_LABELS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrator',
  DOCTOR: 'Doctor',
  PATIENT: 'Patient',
  RECEPTIONIST: 'Receptionist',
};

export const ROLE_DEFAULT_PERMISSIONS: Record<RoleName, string[]> =
  DEFAULT_ROLE_PERMISSION_MATRIX;

const SUPER_ADMIN_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Overview', section: 'governance', requiredPermission: 'DASHBOARD:VIEW' },
  { key: 'users-roles', label: 'User Management', section: 'governance', requiredPermission: 'USERS:VIEW' },
  { key: 'role-management', label: 'Role Management', section: 'governance', requiredPermission: 'ROLES:VIEW' },
  {
    key: 'permission-management',
    label: 'Permission Management',
    section: 'governance',
    requiredPermission: 'PERMISSIONS:VIEW',
  },
  { key: 'audit-logs', label: 'Audit Logs', section: 'governance', requiredPermission: 'SYSTEM_SETTINGS:VIEW' },
  {
    key: 'security-settings',
    label: 'Security Settings',
    section: 'governance',
    requiredPermission: 'SYSTEM_SETTINGS:VIEW',
  },
  {
    key: 'analytics',
    label: 'Analytics & Insights',
    section: 'overview',
    anyOfPermissions: [
      'REVENUE_ANALYTICS:VIEW',
      'DOCTOR_ANALYTICS:VIEW',
      'DEPARTMENT_ANALYTICS:VIEW',
      'GEOGRAPHIC_ANALYTICS:VIEW',
    ],
  },
  { key: 'patients', label: 'Patients', section: 'clinical', requiredPermission: 'PATIENTS:VIEW' },
  { key: 'doctors', label: 'Doctors', section: 'clinical', requiredPermission: 'DOCTORS:VIEW' },
  { key: 'departments', label: 'Departments', section: 'clinical', requiredPermission: 'DEPARTMENTS:VIEW' },
  {
    key: 'consultation-types',
    label: 'Consultation Types',
    section: 'clinical',
    requiredPermission: 'DEPARTMENTS:VIEW',
  },
  { key: 'medical-records', label: 'Medical Records', section: 'clinical', requiredPermission: 'MEDICAL_RECORDS:VIEW' },
  { key: 'prescriptions', label: 'Prescriptions', section: 'clinical', requiredPermission: 'PRESCRIPTIONS:VIEW' },
  { key: 'appointments', label: 'Appointments', section: 'operations', requiredPermission: 'APPOINTMENTS:VIEW' },
  { key: 'slots', label: 'Slots', section: 'operations', requiredPermission: 'SLOTS:VIEW' },
  { key: 'doctor-leaves', label: 'Doctor Leaves', section: 'operations', requiredPermission: 'SLOTS:VIEW' },
  { key: 'approvals', label: 'Approvals', section: 'operations', requiredPermission: 'SLOTS:UPDATE' },
  { key: 'payments', label: 'Payments', section: 'operations', requiredPermission: 'PAYMENTS:VIEW' },
  { key: 'token-queue', label: 'Token Queue', section: 'operations', requiredPermission: 'TOKEN_QUEUE:VIEW' },
  { key: 'branches', label: 'Branches & Network', section: 'administration', requiredPermission: 'DEPARTMENTS:VIEW' },
  { key: 'error-logs', label: 'Error Logs', section: 'administration', requiredPermission: 'SYSTEM_SETTINGS:VIEW' },
];

// Dynamic ordered route catalog for Admin, Doctor, Receptionist, Patient.
// Every route is strictly gated by canonical MODULE:ACTION permissions so changes in
// Role Management or User Overrides dynamically add/remove sidebar routes.
function buildDynamicNavCatalog(role: Exclude<RoleName, 'SUPER_ADMIN'>): NavItem[] {
  const isDoctor = role === 'DOCTOR';
  const isPatient = role === 'PATIENT';
  const isReceptionist = role === 'RECEPTIONIST';

  const items: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', section: 'overview', requiredPermission: 'DASHBOARD:VIEW' },
    {
      key: 'analytics',
      label: 'Analytics & Insights',
      section: 'overview',
      anyOfPermissions: [
        'REVENUE_ANALYTICS:VIEW',
        'DOCTOR_ANALYTICS:VIEW',
        'DEPARTMENT_ANALYTICS:VIEW',
        'GEOGRAPHIC_ANALYTICS:VIEW',
      ],
    },
    ...(isDoctor || isPatient
      ? [{ key: 'profile' as RouteKey, label: 'My Profile', section: 'overview' as const }]
      : []),
    {
      key: 'patients',
      label: isDoctor ? 'Patient Details' : 'Patients',
      section: 'clinical',
      requiredPermission: 'PATIENTS:VIEW',
    },
    ...(isReceptionist || role === 'ADMIN'
      ? [
          {
            key: 'register-patient' as RouteKey,
            label: 'Register Patient',
            section: 'clinical' as const,
            requiredPermission: 'PATIENTS:CREATE',
          },
        ]
      : []),
    { key: 'doctors', label: 'Doctors', section: 'clinical', requiredPermission: 'DOCTORS:VIEW' },
    { key: 'departments', label: 'Departments', section: 'clinical', requiredPermission: 'DEPARTMENTS:VIEW' },
    {
      key: 'consultation-types',
      label: 'Consultation Types',
      section: 'clinical',
      requiredPermission: 'DEPARTMENTS:VIEW',
    },
    {
      key: 'medical-records',
      label: isPatient ? 'My Medical Records' : 'Medical Records',
      section: 'clinical',
      requiredPermission: 'MEDICAL_RECORDS:VIEW',
    },
    {
      key: 'prescriptions',
      label: isPatient ? 'My Prescriptions' : 'Prescriptions',
      section: 'clinical',
      requiredPermission: 'PRESCRIPTIONS:VIEW',
    },
    ...(isPatient || isReceptionist
      ? [
          {
            key: 'book-appointment' as RouteKey,
            label: 'Book Appointment',
            section: isPatient ? ('clinical' as const) : ('operations' as const),
            requiredPermission: 'APPOINTMENTS:CREATE',
          },
        ]
      : []),
    {
      key: 'appointments',
      label: isDoctor || isPatient ? 'My Appointments' : 'Appointments',
      section: isDoctor || isPatient ? 'clinical' : 'operations',
      requiredPermission: 'APPOINTMENTS:VIEW',
    },
    ...(isPatient
      ? [
          {
            key: 'appointment-history' as RouteKey,
            label: 'Appointment History',
            section: 'clinical' as const,
            requiredPermission: 'APPOINTMENTS:VIEW',
          },
        ]
      : []),
    ...(!isPatient
      ? [
          {
            key: 'slots' as RouteKey,
            label: isDoctor ? 'My Schedule' : isReceptionist ? 'Slot Availability' : 'Slots',
            section: isDoctor ? ('clinical' as const) : ('operations' as const),
            requiredPermission: 'SLOTS:VIEW',
          },
        ]
      : []),
    ...(isDoctor || role === 'ADMIN'
      ? [
          {
            key: 'doctor-leaves' as RouteKey,
            label: isDoctor ? 'My Leave Requests' : 'Doctor Leaves',
            section: 'operations' as const,
            requiredPermission: 'SLOTS:VIEW',
          },
        ]
      : []),
    ...(role === 'ADMIN'
      ? [
          {
            key: 'approvals' as RouteKey,
            label: 'Approvals',
            section: 'operations' as const,
            requiredPermission: 'SLOTS:UPDATE',
          },
        ]
      : []),
    { key: 'payments', label: 'Payments', section: 'operations', requiredPermission: 'PAYMENTS:VIEW' },
    {
      key: 'token-queue',
      label: isPatient ? 'My Tokens' : 'Token Queue',
      section: 'operations',
      requiredPermission: 'TOKEN_QUEUE:VIEW',
    },
    ...(!isPatient
      ? [
          {
            key: 'branches' as RouteKey,
            label: 'Branches & Network',
            section: 'operations' as const,
            requiredPermission: 'DEPARTMENTS:VIEW',
          },
        ]
      : []),
    { key: 'users-roles', label: 'User Management', section: 'administration', requiredPermission: 'USERS:VIEW' },
    {
      key: 'role-management',
      label: 'Role Management',
      section: 'administration',
      requiredPermission: 'ROLES:VIEW',
    },
    {
      key: 'permission-management',
      label: 'Permission Management',
      section: 'administration',
      requiredPermission: 'PERMISSIONS:VIEW',
    },
    { key: 'audit-logs', label: 'Audit Logs', section: 'administration', requiredPermission: 'SYSTEM_SETTINGS:VIEW' },
    {
      key: 'security-settings',
      label: 'Security Settings',
      section: 'administration',
      requiredPermission: 'SYSTEM_SETTINGS:VIEW',
    },
    { key: 'error-logs', label: 'Error Logs', section: 'administration', requiredPermission: 'SYSTEM_SETTINGS:VIEW' },
  ];

  return items;
}

export function isSingleAdminUser(user: AuthUser | null): boolean {
  if (!user || user.role !== 'ADMIN') return false;
  const emailMatches = (user.email || '').trim().toLowerCase() === SINGLE_ADMIN_EMAIL;
  const nameMatches =
    (user.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ') ===
    SINGLE_ADMIN_NAME.toLowerCase();
  return emailMatches && nameMatches;
}

export function isUserAccountActive(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.status !== 'INACTIVE' && user.status !== 'SUSPENDED';
}

export function hasPermission(user: AuthUser | null, permission?: string): boolean {
  if (!user || !isUserAccountActive(user)) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (!permission) return true;
  return hasEffectivePermission(user.permissions, user.role, permission);
}

export function hasModulePermission(
  user: AuthUser | null,
  moduleKey: ModuleKey,
  action: PermissionAction,
): boolean {
  return hasPermission(user, `${moduleKey}:${action}`);
}

export function getNavForUser(user: AuthUser | null): NavItem[] {
  if (!user || !isUserAccountActive(user)) return [];
  const candidates =
    user.role === 'SUPER_ADMIN' ? SUPER_ADMIN_NAV : buildDynamicNavCatalog(user.role);

  return candidates.filter((item) => {
    if (item.anyOfPermissions && item.anyOfPermissions.length > 0) {
      if (user.role === 'SUPER_ADMIN') return true;
      return hasAnyEffectivePermission(user.permissions, user.role, item.anyOfPermissions);
    }
    return hasPermission(user, item.requiredPermission);
  });
}

export function canAccessRoute(user: AuthUser | null, route: RouteKey): boolean {
  if (!user || !isUserAccountActive(user)) return false;
  if (route === 'profile') return true;
  return getNavForUser(user).some((item) => item.key === route);
}

export function getRouteLabel(user: AuthUser | null, route: RouteKey): string {
  const found = getNavForUser(user).find((item) => item.key === route);
  if (found) return found.label;
  return route
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export interface RolePortalCardConfig {
  role: RoleName;
  title: string;
  portalTitle: string;
  description: string;
  allowRegistration: boolean;
  allowForgotPassword: boolean;
  policyNote: string;
}

export const ROLE_PORTAL_CARDS: RolePortalCardConfig[] = [
  {
    role: 'SUPER_ADMIN',
    title: 'Super Admin',
    portalTitle: 'Root Governance & RBAC',
    description: 'System control, role matrix, permissions, and security',
    allowRegistration: false,
    allowForgotPassword: false,
    policyNote:
      'Single immutable Super Admin account configured during initial setup. Public registration and self-modification are permanently disabled.',
  },
  {
    role: 'ADMIN',
    title: 'Admin',
    portalTitle: 'Hospital Administration',
    description: 'Manage hospital operations',
    allowRegistration: false,
    allowForgotPassword: false,
    policyNote:
      'Hospital Administrator accounts are provisioned exclusively by the Super Admin. Public registration is disabled.',
  },
  {
    role: 'DOCTOR',
    title: 'Doctor',
    portalTitle: 'Doctor Portal',
    description: 'Manage appointments and patients',
    allowRegistration: false,
    allowForgotPassword: false,
    policyNote:
      'Doctors cannot self-register. Doctor accounts are created by the Administrator or Super Admin.',
  },
  {
    role: 'RECEPTIONIST',
    title: 'Receptionist',
    portalTitle: 'Reception Portal',
    description: 'Manage bookings and check-ins',
    allowRegistration: false,
    allowForgotPassword: false,
    policyNote:
      'Receptionist accounts are provisioned exclusively by the Administrator or Super Admin.',
  },
  {
    role: 'PATIENT',
    title: 'Patient',
    portalTitle: 'Patient Portal',
    description: 'Book appointments and view records',
    allowRegistration: true,
    allowForgotPassword: true,
    policyNote:
      'Patients can sign in, independently register a new account, or reset a forgotten password.',
  },
];

export function getRolePortalConfig(role: RoleName): RolePortalCardConfig {
  return ROLE_PORTAL_CARDS.find((c) => c.role === role) ?? ROLE_PORTAL_CARDS[4];
}
