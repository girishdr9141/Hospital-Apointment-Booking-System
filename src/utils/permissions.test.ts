import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessRoute,
  getNavForUser,
  getRolePortalConfig,
  hasPermission,
  isSingleAdminUser,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_PORTAL_CARDS,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_NAME,
} from './permissions.ts';
import type { AuthUser } from '../types/opd';

function makeUser(role: AuthUser['role'], overrides?: Partial<AuthUser>): AuthUser {
  return {
    user_id: 1,
    username: role === 'ADMIN' ? 'girish.dr' : role.toLowerCase(),
    email: role === 'ADMIN' ? SINGLE_ADMIN_EMAIL : `${role.toLowerCase()}@hospital.local`,
    full_name: role === 'ADMIN' ? SINGLE_ADMIN_NAME : `Test ${role}`,
    role,
    roles: [role],
    permissions: ROLE_DEFAULT_PERMISSIONS[role],
    doctor_id: role === 'DOCTOR' ? 3 : null,
    patient_id: role === 'PATIENT' ? 1 : null,
    ...overrides,
  };
}

test('single admin Girish DR sees all 14 navigation sections and has read-only slot/patient permissions', () => {
  const admin = makeUser('ADMIN');
  assert.equal(isSingleAdminUser(admin), true);
  const nav = getNavForUser(admin);
  assert.equal(nav.length, 14);
  assert.equal(canAccessRoute(admin, 'users-roles'), true);
  assert.equal(canAccessRoute(admin, 'audit-logs'), true);
  assert.equal(canAccessRoute(admin, 'error-logs'), true);
  assert.equal(hasPermission(admin, 'MANAGE_DOCTORS'), true);
  assert.equal(hasPermission(admin, 'MANAGE_APPROVALS'), true);
  assert.equal(hasPermission(admin, 'MANAGE_PATIENTS'), false);
  assert.equal(hasPermission(admin, 'CREATE_APPOINTMENTS'), false);
  assert.equal(hasPermission(admin, 'MANAGE_SLOTS'), false);

  const otherAdmin = makeUser('ADMIN', {
    email: 'other@hospital.com',
    full_name: 'Other Admin',
  });
  assert.equal(isSingleAdminUser(otherAdmin), false);
  assert.equal(getNavForUser(otherAdmin).length, 0);
  assert.equal(canAccessRoute(otherAdmin, 'audit-logs'), false);
});

test('doctor sees only 7 doctor routes and cannot access admin routes', () => {
  const doctor = makeUser('DOCTOR');
  const nav = getNavForUser(doctor);
  assert.equal(nav.length, 7);
  assert.equal(canAccessRoute(doctor, 'appointments'), true);
  assert.equal(canAccessRoute(doctor, 'doctor-leaves'), true);
  assert.equal(canAccessRoute(doctor, 'users-roles'), false);
  assert.equal(canAccessRoute(doctor, 'error-logs'), false);
  assert.equal(hasPermission(doctor, 'UPDATE_APPOINTMENTS'), true);
  assert.equal(hasPermission(doctor, 'MANAGE_USERS'), false);
});

test('patient sees only 7 patient routes and cannot access receptionist or admin routes', () => {
  const patient = makeUser('PATIENT');
  const nav = getNavForUser(patient);
  assert.equal(nav.length, 7);
  assert.equal(canAccessRoute(patient, 'book-appointment'), true);
  assert.equal(canAccessRoute(patient, 'register-patient'), false);
  assert.equal(canAccessRoute(patient, 'approvals'), false);
});

test('receptionist sees 8 receptionist routes and cannot manage users or permissions', () => {
  const receptionist = makeUser('RECEPTIONIST');
  const nav = getNavForUser(receptionist);
  assert.equal(nav.length, 8);
  assert.equal(canAccessRoute(receptionist, 'register-patient'), true);
  assert.equal(canAccessRoute(receptionist, 'token-queue'), true);
  assert.equal(canAccessRoute(receptionist, 'users-roles'), false);
  assert.equal(canAccessRoute(receptionist, 'audit-logs'), false);
});

test('role portal cards enforce self-registration and forgot password only for Patient', () => {
  assert.equal(ROLE_PORTAL_CARDS.length, 4);
  assert.deepEqual(
    ROLE_PORTAL_CARDS.map((c) => c.role),
    ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'],
  );

  for (const staffRole of ['ADMIN', 'DOCTOR', 'RECEPTIONIST'] as const) {
    const cfg = getRolePortalConfig(staffRole);
    assert.equal(cfg.allowRegistration, false);
    assert.equal(cfg.allowForgotPassword, false);
  }

  const patientCfg = getRolePortalConfig('PATIENT');
  assert.equal(patientCfg.allowRegistration, true);
  assert.equal(patientCfg.allowForgotPassword, true);
});

