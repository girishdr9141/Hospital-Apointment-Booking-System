import type { AuthUser, NavItem, RoleName, RouteKey } from '../types/opd.ts';

export const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: 'Administrator',
  DOCTOR: 'Doctor',
  PATIENT: 'Patient',
  RECEPTIONIST: 'Receptionist',
};

export const ROLE_DEFAULT_PERMISSIONS: Record<RoleName, string[]> = {
  ADMIN: [
    'VIEW_DASHBOARD',
    'VIEW_PATIENTS',
    'MANAGE_DOCTORS',
    'MANAGE_DEPARTMENTS',
    'VIEW_APPOINTMENTS',
    'UPDATE_APPOINTMENTS',
    'CANCEL_APPOINTMENTS',
    'VIEW_SLOTS',
    'VIEW_LEAVES',
    'MANAGE_APPROVALS',
    'VIEW_PAYMENTS',
    'RECORD_PAYMENTS',
    'VIEW_TOKENS',
    'MANAGE_TOKENS',
    'VIEW_USERS',
    'MANAGE_USERS',
    'MANAGE_ROLES',
    'VIEW_ERROR_LOGS',
    'VIEW_AUDIT_LOGS',
  ],
  DOCTOR: [
    'VIEW_DASHBOARD',
    'VIEW_PATIENTS',
    'VIEW_SLOTS',
    'REQUEST_LEAVE',
    'VIEW_LEAVES',
    'VIEW_TOKENS',
    'MANAGE_TOKENS',
    'VIEW_APPOINTMENTS',
    'UPDATE_APPOINTMENTS',
  ],
  PATIENT: [
    'VIEW_DASHBOARD',
    'VIEW_SLOTS',
    'VIEW_APPOINTMENTS',
    'CREATE_APPOINTMENTS',
    'CANCEL_APPOINTMENTS',
    'VIEW_PAYMENTS',
    'VIEW_TOKENS',
  ],
  RECEPTIONIST: [
    'VIEW_DASHBOARD',
    'VIEW_PATIENTS',
    'MANAGE_PATIENTS',
    'VIEW_SLOTS',
    'VIEW_APPOINTMENTS',
    'CREATE_APPOINTMENTS',
    'UPDATE_APPOINTMENTS',
    'CANCEL_APPOINTMENTS',
    'VIEW_PAYMENTS',
    'RECORD_PAYMENTS',
    'VIEW_TOKENS',
    'MANAGE_TOKENS',
  ],
};

const NAV_BY_ROLE: Record<RoleName, NavItem[]> = {
  ADMIN: [
    { key: 'dashboard', label: 'Dashboard', section: 'overview', requiredPermission: 'VIEW_DASHBOARD' },
    { key: 'patients', label: 'Patients', section: 'clinical', requiredPermission: 'VIEW_PATIENTS' },
    { key: 'doctors', label: 'Doctors', section: 'clinical' },
    { key: 'departments', label: 'Departments', section: 'clinical', requiredPermission: 'MANAGE_DEPARTMENTS' },
    { key: 'consultation-types', label: 'Consultation Types', section: 'clinical', requiredPermission: 'MANAGE_DEPARTMENTS' },
    { key: 'appointments', label: 'Appointments', section: 'operations' },
    { key: 'slots', label: 'Slots', section: 'operations', requiredPermission: 'VIEW_SLOTS' },
    { key: 'doctor-leaves', label: 'Doctor Leaves', section: 'operations', requiredPermission: 'VIEW_LEAVES' },
    { key: 'approvals', label: 'Approvals', section: 'operations' },
    { key: 'payments', label: 'Payments', section: 'operations', requiredPermission: 'VIEW_PAYMENTS' },
    { key: 'token-queue', label: 'Token Queue', section: 'operations', requiredPermission: 'VIEW_TOKENS' },
    { key: 'users-roles', label: 'Users and Roles', section: 'administration' },
    { key: 'audit-logs', label: 'Audit Logs', section: 'administration' },
    { key: 'error-logs', label: 'Error Logs', section: 'administration', requiredPermission: 'VIEW_ERROR_LOGS' },
  ],
  DOCTOR: [
    { key: 'dashboard', label: 'Dashboard', section: 'overview', requiredPermission: 'VIEW_DASHBOARD' },
    { key: 'appointments', label: 'My Appointments', section: 'clinical' },
    { key: 'slots', label: 'My Schedule', section: 'clinical', requiredPermission: 'VIEW_SLOTS' },
    { key: 'doctor-leaves', label: 'My Leave Requests', section: 'operations', requiredPermission: 'VIEW_LEAVES' },
    { key: 'patients', label: 'Patient Details', section: 'clinical', requiredPermission: 'VIEW_PATIENTS' },
    { key: 'token-queue', label: 'Token Queue', section: 'operations', requiredPermission: 'VIEW_TOKENS' },
    { key: 'profile', label: 'My Profile', section: 'overview' },
  ],
  PATIENT: [
    { key: 'dashboard', label: 'Dashboard', section: 'overview', requiredPermission: 'VIEW_DASHBOARD' },
    { key: 'book-appointment', label: 'Book Appointment', section: 'clinical' },
    { key: 'appointments', label: 'My Appointments', section: 'clinical' },
    { key: 'appointment-history', label: 'Appointment History', section: 'clinical' },
    { key: 'payments', label: 'Payments', section: 'operations', requiredPermission: 'VIEW_PAYMENTS' },
    { key: 'token-queue', label: 'My Tokens', section: 'operations', requiredPermission: 'VIEW_TOKENS' },
    { key: 'profile', label: 'My Profile', section: 'overview' },
  ],
  RECEPTIONIST: [
    { key: 'dashboard', label: 'Dashboard', section: 'overview', requiredPermission: 'VIEW_DASHBOARD' },
    { key: 'patients', label: 'Patients', section: 'clinical', requiredPermission: 'VIEW_PATIENTS' },
    { key: 'register-patient', label: 'Register Patient', section: 'clinical', requiredPermission: 'MANAGE_PATIENTS' },
    { key: 'appointments', label: 'Appointments', section: 'operations' },
    { key: 'book-appointment', label: 'Book Appointment', section: 'operations' },
    { key: 'slots', label: 'Slot Availability', section: 'operations', requiredPermission: 'VIEW_SLOTS' },
    { key: 'token-queue', label: 'Token Queue', section: 'operations', requiredPermission: 'VIEW_TOKENS' },
    { key: 'payments', label: 'Payments', section: 'operations', requiredPermission: 'VIEW_PAYMENTS' },
  ],
};

export const SINGLE_ADMIN_NAME = 'Girish DR';
export const SINGLE_ADMIN_EMAIL = 'girishramachandra12dr@gmail.com';

export function isSingleAdminUser(user: AuthUser | null): boolean {
  if (!user || user.role !== 'ADMIN') return false;
  const emailMatches = (user.email || '').trim().toLowerCase() === SINGLE_ADMIN_EMAIL;
  const nameMatches =
    (user.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ') ===
    SINGLE_ADMIN_NAME.toLowerCase();
  return emailMatches && nameMatches;
}

export function hasPermission(user: AuthUser | null, permission?: string): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' && !isSingleAdminUser(user)) return false;
  if (!permission) return true;
  if (user.role === 'ADMIN' && user.permissions.length === 0) return true;
  return user.permissions.includes(permission);
}

export function getNavForUser(user: AuthUser | null): NavItem[] {
  if (!user) return [];
  if (user.role === 'ADMIN' && !isSingleAdminUser(user)) return [];
  const roleNav = NAV_BY_ROLE[user.role] ?? [];
  return roleNav.filter((item) => hasPermission(user, item.requiredPermission));
}

export function canAccessRoute(user: AuthUser | null, route: RouteKey): boolean {
  if (!user) return false;
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
    role: 'ADMIN',
    title: 'Admin',
    portalTitle: 'System Administration',
    description: 'Manage hospital operations',
    allowRegistration: false,
    allowForgotPassword: false,
    policyNote:
      'Only one administrator account exists and is configured securely during initial system setup. Public registration is disabled.',
  },
  {
    role: 'DOCTOR',
    title: 'Doctor',
    portalTitle: 'Doctor Portal',
    description: 'Manage appointments and patients',
    allowRegistration: false,
    allowForgotPassword: false,
    policyNote:
      'Doctors cannot self-register. Doctor accounts are created exclusively by the System Administrator.',
  },
  {
    role: 'RECEPTIONIST',
    title: 'Receptionist',
    portalTitle: 'Reception Portal',
    description: 'Manage bookings and check-ins',
    allowRegistration: false,
    allowForgotPassword: false,
    policyNote:
      'Receptionist accounts (up to 2 front-desk staff) are created exclusively by the System Administrator.',
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
  return ROLE_PORTAL_CARDS.find((c) => c.role === role) ?? ROLE_PORTAL_CARDS[3];
}

