import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessRoute,
  getNavForUser,
  getRolePortalConfig,
  hasModulePermission,
  hasPermission,
  isSingleAdminUser,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_PORTAL_CARDS,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_NAME,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_NAME,
} from './permissions.ts';
import type { AuthUser } from '../types/opd.ts';

function makeUser(role: AuthUser['role'], overrides?: Partial<AuthUser>): AuthUser {
  return {
    user_id: role === 'SUPER_ADMIN' ? 9001 : 1,
    username:
      role === 'SUPER_ADMIN'
        ? 'karan.tulsani'
        : role === 'ADMIN'
          ? 'girish.dr'
          : role.toLowerCase(),
    email:
      role === 'SUPER_ADMIN'
        ? SUPER_ADMIN_EMAIL
        : role === 'ADMIN'
          ? SINGLE_ADMIN_EMAIL
          : `${role.toLowerCase()}@hospital.local`,
    full_name:
      role === 'SUPER_ADMIN'
        ? SUPER_ADMIN_NAME
        : role === 'ADMIN'
          ? SINGLE_ADMIN_NAME
          : `Test ${role}`,
    role,
    roles: [role],
    status: 'ACTIVE',
    permissions: ROLE_DEFAULT_PERMISSIONS[role],
    doctor_id: role === 'DOCTOR' ? 3 : null,
    patient_id: role === 'PATIENT' ? 1 : null,
    ...overrides,
  };
}

test('Super Admin Karan Tulsani sees all 6 governance routes and hospital modules', () => {
  const superAdmin = makeUser('SUPER_ADMIN');
  const nav = getNavForUser(superAdmin);
  const governanceKeys = nav.filter((n) => n.section === 'governance').map((n) => n.key);
  assert.deepEqual(governanceKeys, [
    'dashboard',
    'users-roles',
    'role-management',
    'permission-management',
    'audit-logs',
    'security-settings',
  ]);
  assert.equal(canAccessRoute(superAdmin, 'analytics'), true);
  assert.equal(canAccessRoute(superAdmin, 'medical-records'), true);
  assert.equal(canAccessRoute(superAdmin, 'prescriptions'), true);
  assert.equal(hasModulePermission(superAdmin, 'PERMISSIONS', 'UPDATE'), true);
  assert.equal(hasModulePermission(superAdmin, 'SYSTEM_SETTINGS', 'UPDATE'), true);
});

test('Admin Girish DR accesses hospital operations, analytics, and medical/prescription views without governance overrides', () => {
  const admin = makeUser('ADMIN');
  assert.equal(isSingleAdminUser(admin), true);
  assert.equal(canAccessRoute(admin, 'analytics'), true);
  assert.equal(canAccessRoute(admin, 'users-roles'), true);
  assert.equal(canAccessRoute(admin, 'role-management'), true);
  assert.equal(canAccessRoute(admin, 'permission-management'), false);
  assert.equal(canAccessRoute(admin, 'security-settings'), false);
  assert.equal(canAccessRoute(admin, 'medical-records'), true);
  assert.equal(canAccessRoute(admin, 'prescriptions'), true);
  assert.equal(hasPermission(admin, 'MANAGE_DOCTORS'), true);
  assert.equal(hasPermission(admin, 'MANAGE_APPROVALS'), true);
  assert.equal(hasPermission(admin, 'PATIENTS:CREATE'), false);
  assert.equal(hasPermission(admin, 'APPOINTMENTS:CREATE'), false);
});

test('Dynamic RBAC allows Super Admin created Admin accounts and denies empty permission sets (deny-by-default)', () => {
  const dynamicAdmin = makeUser('ADMIN', {
    email: 'ops.admin@hospital.com',
    full_name: 'Ops Admin',
  });
  assert.equal(isSingleAdminUser(dynamicAdmin), false);
  assert.equal(canAccessRoute(dynamicAdmin, 'analytics'), true);

  const strippedUser = makeUser('ADMIN', { permissions: [] });
  assert.equal(getNavForUser(strippedUser).length, 0);
  assert.equal(hasPermission(strippedUser, 'PATIENTS:VIEW'), false);

  const suspendedDoctor = makeUser('DOCTOR', { status: 'SUSPENDED' });
  assert.equal(getNavForUser(suspendedDoctor).length, 0);
  assert.equal(canAccessRoute(suspendedDoctor, 'appointments'), false);
});

test('Doctor routes include Medical Records and Prescriptions and dynamically gain Analytics if granted', () => {
  const doctor = makeUser('DOCTOR');
  assert.equal(canAccessRoute(doctor, 'appointments'), true);
  assert.equal(canAccessRoute(doctor, 'medical-records'), true);
  assert.equal(canAccessRoute(doctor, 'prescriptions'), true);
  assert.equal(canAccessRoute(doctor, 'analytics'), false);
  assert.equal(canAccessRoute(doctor, 'users-roles'), false);

  const boostedDoctor = makeUser('DOCTOR', {
    permissions: [...ROLE_DEFAULT_PERMISSIONS.DOCTOR, 'REVENUE_ANALYTICS:VIEW'],
  });
  assert.equal(canAccessRoute(boostedDoctor, 'analytics'), true);
});

test('Patient and Receptionist access scopes align with defaults and respect revokes', () => {
  const patient = makeUser('PATIENT');
  assert.equal(canAccessRoute(patient, 'book-appointment'), true);
  assert.equal(canAccessRoute(patient, 'medical-records'), true);
  assert.equal(canAccessRoute(patient, 'prescriptions'), true);
  assert.equal(canAccessRoute(patient, 'register-patient'), false);
  assert.equal(canAccessRoute(patient, 'analytics'), false);

  const receptionist = makeUser('RECEPTIONIST');
  assert.equal(canAccessRoute(receptionist, 'register-patient'), true);
  assert.equal(canAccessRoute(receptionist, 'token-queue'), true);
  assert.equal(canAccessRoute(receptionist, 'users-roles'), false);

  const revokedPatient = makeUser('PATIENT', {
    permissions: ROLE_DEFAULT_PERMISSIONS.PATIENT.filter((p) => p !== 'APPOINTMENTS:CREATE'),
  });
  assert.equal(canAccessRoute(revokedPatient, 'book-appointment'), false);
});

test('Role portal cards include all 5 protected roles and restrict registration to Patient only', () => {
  assert.equal(ROLE_PORTAL_CARDS.length, 5);
  assert.deepEqual(
    ROLE_PORTAL_CARDS.map((c) => c.role),
    ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'],
  );

  for (const staffRole of ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'] as const) {
    const cfg = getRolePortalConfig(staffRole);
    assert.equal(cfg.allowRegistration, false);
    assert.equal(cfg.allowForgotPassword, false);
  }

  const patientCfg = getRolePortalConfig('PATIENT');
  assert.equal(patientCfg.allowRegistration, true);
  assert.equal(patientCfg.allowForgotPassword, true);
});
