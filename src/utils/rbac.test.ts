import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CANONICAL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSION_MATRIX,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_NAME,
  canActorModifyTargetUser,
  computeEffectivePermissions,
  diffPermissionSets,
  hasEffectivePermission,
  isProtectedSuperAdminIdentity,
} from './rbac.ts';

test('computeEffectivePermissions merges role defaults, user grants, and revokes with revokes taking precedence', () => {
  const effective = computeEffectivePermissions(
    'DOCTOR',
    DEFAULT_ROLE_PERMISSION_MATRIX,
    {
      grants: ['REVENUE_ANALYTICS:VIEW', 'PATIENTS:EXPORT'],
      revokes: ['SLOTS:CREATE', 'REVENUE_ANALYTICS:VIEW'],
    },
  );
  assert.equal(effective.includes('PATIENTS:EXPORT'), true);
  assert.equal(effective.includes('SLOTS:CREATE'), false);
  // Revoke wins over grant if same permission appears in both
  assert.equal(effective.includes('REVENUE_ANALYTICS:VIEW'), false);
});

test('SUPER_ADMIN always evaluates to full canonical permission set regardless of overrides', () => {
  const effective = computeEffectivePermissions(
    'SUPER_ADMIN',
    DEFAULT_ROLE_PERMISSION_MATRIX,
    { grants: [], revokes: ['USERS:DELETE', 'PERMISSIONS:UPDATE'] },
  );
  assert.equal(effective.length, ALL_CANONICAL_PERMISSIONS.length);
  assert.equal(effective.includes('PERMISSIONS:UPDATE'), true);
});

test('diffPermissionSets accurately identifies added and removed permissions', () => {
  const diff = diffPermissionSets(
    ['PATIENTS:VIEW', 'APPOINTMENTS:VIEW'],
    ['PATIENTS:VIEW', 'APPOINTMENTS:CREATE', 'PAYMENTS:VIEW'],
  );
  assert.deepEqual(diff.added, ['APPOINTMENTS:CREATE', 'PAYMENTS:VIEW']);
  assert.deepEqual(diff.removed, ['APPOINTMENTS:VIEW']);
});

test('hasEffectivePermission denies by default when permission array is empty or missing', () => {
  assert.equal(hasEffectivePermission([], 'ADMIN', 'PATIENTS:VIEW'), false);
  assert.equal(hasEffectivePermission(undefined, 'DOCTOR', 'PATIENTS:VIEW'), false);
  assert.equal(hasEffectivePermission([], 'SUPER_ADMIN', 'PERMISSIONS:UPDATE'), true);
  assert.equal(hasEffectivePermission(['PATIENTS:CREATE'], 'RECEPTIONIST', 'MANAGE_PATIENTS'), true);
});

test('canActorModifyTargetUser enforces Super Admin protection, anti-self-escalation, and privilege hierarchy', () => {
  const superAdminActor = {
    user_id: 9001,
    email: SUPER_ADMIN_EMAIL,
    role: 'SUPER_ADMIN' as const,
    permissions: ALL_CANONICAL_PERMISSIONS,
  };
  const adminActor = {
    user_id: 1001,
    email: 'girishramachandra12dr@gmail.com',
    role: 'ADMIN' as const,
    permissions: [...DEFAULT_ROLE_PERMISSION_MATRIX.ADMIN, 'USERS:UPDATE', 'ROLES:UPDATE', 'PERMISSIONS:UPDATE'],
  };
  const doctorTarget = {
    user_id: 3,
    email: 'priya@hospital.com',
    role: 'DOCTOR' as const,
  };
  const adminTarget = {
    user_id: 1002,
    email: 'ops.admin@hospital.com',
    role: 'ADMIN' as const,
  };
  const superAdminTarget = {
    user_id: 9001,
    email: SUPER_ADMIN_EMAIL,
    role: 'SUPER_ADMIN' as const,
  };

  assert.equal(
    isProtectedSuperAdminIdentity({ email: SUPER_ADMIN_EMAIL, full_name: SUPER_ADMIN_NAME }),
    true,
  );

  // Nobody can deactivate or demote Super Admin (not even Super Admin themselves)
  assert.equal(canActorModifyTargetUser(superAdminActor, superAdminTarget, 'STATUS').allowed, false);
  assert.equal(canActorModifyTargetUser(adminActor, superAdminTarget, 'ROLE', 'DOCTOR').allowed, false);

  // Super Admin can suspend/change role/grant permissions to Doctor or Admin
  assert.equal(canActorModifyTargetUser(superAdminActor, doctorTarget, 'STATUS').allowed, true);
  assert.equal(canActorModifyTargetUser(superAdminActor, doctorTarget, 'PERMISSIONS').allowed, true);
  assert.equal(canActorModifyTargetUser(superAdminActor, doctorTarget, 'ROLE', 'ADMIN').allowed, true);
  assert.equal(canActorModifyTargetUser(superAdminActor, adminTarget, 'STATUS').allowed, true);

  // Nobody can assign SUPER_ADMIN role
  assert.equal(canActorModifyTargetUser(superAdminActor, doctorTarget, 'ROLE', 'SUPER_ADMIN').allowed, false);

  // Admin cannot modify self, other admins, or individual permissions
  assert.equal(canActorModifyTargetUser(adminActor, adminActor, 'ROLE', 'DOCTOR').allowed, false);
  assert.equal(canActorModifyTargetUser(adminActor, adminActor, 'PERMISSIONS').allowed, false);
  assert.equal(canActorModifyTargetUser(adminActor, adminTarget, 'STATUS').allowed, false);
  assert.equal(canActorModifyTargetUser(adminActor, doctorTarget, 'ROLE', 'ADMIN').allowed, false);
  assert.equal(canActorModifyTargetUser(adminActor, doctorTarget, 'PERMISSIONS').allowed, false);
});
