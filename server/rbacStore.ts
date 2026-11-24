import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AccountStatus,
  AuthUser,
  Doctor,
  ManagedUserRecord,
  Patient,
  RbacAuditLogEntry,
  RoleDefinition,
  RoleName,
  SecuritySettings,
  UserAccount,
  UserPermissionOverride,
} from '../src/types/opd.ts';
import {
  ALL_CANONICAL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSION_MATRIX,
  DEFAULT_SECURITY_SETTINGS,
  PROTECTED_CORE_ROLES,
  ROLE_META,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_NAME,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_NAME,
  SUPER_ADMIN_USER_ID,
  SUPER_ADMIN_USERNAME,
  computeEffectivePermissions,
  isProtectedSuperAdminIdentity,
  normalizeCanonicalPermissions,
} from '../src/utils/rbac.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RBAC_STORE_PATH = path.join(DATA_DIR, 'rbac_store.json');
const RBAC_AUDIT_PATH = path.join(DATA_DIR, 'rbac_audit_logs.json');
const LEGACY_PATIENT_PW_PATH = path.join(DATA_DIR, 'patient_passwords.json');

export interface StoredManagedUser {
  user_id: number;
  username: string;
  email: string;
  full_name: string;
  phone_number?: string | null;
  role: Exclude<RoleName, 'SUPER_ADMIN'>;
  password_hash: string;
  doctor_id?: number | null;
  patient_id?: number | null;
  created_on: string;
}

export interface LoginFailureState {
  count: number;
  locked_until: string | null;
}

export interface RbacStoreData {
  super_admin_password_hash: string;
  role_matrix: Record<RoleName, string[]>;
  user_overrides: Record<string, UserPermissionOverride>;
  user_statuses: Record<string, AccountStatus>;
  user_role_overrides: Record<string, RoleName>;
  managed_users: StoredManagedUser[];
  password_overrides: Record<string, string>;
  security_settings: SecuritySettings;
  login_failures: Record<string, LoginFailureState>;
}

export interface BridgeUserDescriptor {
  user_id: number;
  username: string;
  email: string;
  password?: string;
  full_name: string;
  role: RoleName;
  doctor_id?: number | null;
  patient_id?: number | null;
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function normalizeUserKey(email?: string | null, userId?: number | null): string {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanEmail) return cleanEmail;
  return `uid:${userId ?? 0}`;
}

function readLegacyPatientPasswords(): Record<string, string> {
  try {
    if (!fs.existsSync(LEGACY_PATIENT_PW_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(LEGACY_PATIENT_PW_PATH, 'utf8')) as Record<string, unknown>;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.includes(':')) clean[k.toLowerCase()] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

function createInitialStore(): RbacStoreData {
  const defaultSuperPw = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
  return {
    super_admin_password_hash: hashPasswordScrypt(defaultSuperPw),
    role_matrix: {
      SUPER_ADMIN: [...ALL_CANONICAL_PERMISSIONS],
      ADMIN: [...DEFAULT_ROLE_PERMISSION_MATRIX.ADMIN],
      DOCTOR: [...DEFAULT_ROLE_PERMISSION_MATRIX.DOCTOR],
      RECEPTIONIST: [...DEFAULT_ROLE_PERMISSION_MATRIX.RECEPTIONIST],
      PATIENT: [...DEFAULT_ROLE_PERMISSION_MATRIX.PATIENT],
    },
    user_overrides: {},
    user_statuses: {
      [SUPER_ADMIN_EMAIL.toLowerCase()]: 'ACTIVE',
      [SINGLE_ADMIN_EMAIL.toLowerCase()]: 'ACTIVE',
    },
    user_role_overrides: {},
    managed_users: [],
    password_overrides: readLegacyPatientPasswords(),
    security_settings: { ...DEFAULT_SECURITY_SETTINGS },
    login_failures: {},
  };
}

export function readRbacStore(): RbacStoreData {
  try {
    if (!fs.existsSync(RBAC_STORE_PATH)) {
      const initial = createInitialStore();
      writeRbacStore(initial);
      ensureInitialAuditSeed();
      return initial;
    }
    const raw = JSON.parse(fs.readFileSync(RBAC_STORE_PATH, 'utf8')) as Partial<RbacStoreData>;
    const base = createInitialStore();
    const matrix: Record<RoleName, string[]> = {
      SUPER_ADMIN: [...ALL_CANONICAL_PERMISSIONS],
      ADMIN: normalizeCanonicalPermissions(raw.role_matrix?.ADMIN ?? base.role_matrix.ADMIN),
      DOCTOR: normalizeCanonicalPermissions(raw.role_matrix?.DOCTOR ?? base.role_matrix.DOCTOR),
      RECEPTIONIST: normalizeCanonicalPermissions(
        raw.role_matrix?.RECEPTIONIST ?? base.role_matrix.RECEPTIONIST,
      ),
      PATIENT: normalizeCanonicalPermissions(raw.role_matrix?.PATIENT ?? base.role_matrix.PATIENT),
    };

    const userOverrides: Record<string, UserPermissionOverride> = {};
    if (raw.user_overrides && typeof raw.user_overrides === 'object') {
      for (const [k, v] of Object.entries(raw.user_overrides)) {
        if (v && typeof v === 'object') {
          userOverrides[k.toLowerCase()] = {
            grants: normalizeCanonicalPermissions((v as UserPermissionOverride).grants || []),
            revokes: normalizeCanonicalPermissions((v as UserPermissionOverride).revokes || []),
          };
        }
      }
    }

    const userStatuses: Record<string, AccountStatus> = {};
    if (raw.user_statuses && typeof raw.user_statuses === 'object') {
      for (const [k, v] of Object.entries(raw.user_statuses)) {
        if (v === 'ACTIVE' || v === 'INACTIVE' || v === 'SUSPENDED') {
          userStatuses[k.toLowerCase()] = v;
        }
      }
    }
    userStatuses[SUPER_ADMIN_EMAIL.toLowerCase()] = 'ACTIVE';

    const userRoleOverrides: Record<string, RoleName> = {};
    if (raw.user_role_overrides && typeof raw.user_role_overrides === 'object') {
      for (const [k, v] of Object.entries(raw.user_role_overrides)) {
        if (v === 'ADMIN' || v === 'DOCTOR' || v === 'RECEPTIONIST' || v === 'PATIENT') {
          userRoleOverrides[k.toLowerCase()] = v;
        }
      }
    }
    delete userRoleOverrides[SUPER_ADMIN_EMAIL.toLowerCase()];

    const legacyPw = readLegacyPatientPasswords();
    const passwordOverrides: Record<string, string> = { ...legacyPw };
    if (raw.password_overrides && typeof raw.password_overrides === 'object') {
      for (const [k, v] of Object.entries(raw.password_overrides)) {
        if (typeof v === 'string' && v.includes(':')) {
          passwordOverrides[k.toLowerCase()] = v;
        }
      }
    }

    return {
      super_admin_password_hash:
        typeof raw.super_admin_password_hash === 'string' && raw.super_admin_password_hash.includes(':')
          ? raw.super_admin_password_hash
          : base.super_admin_password_hash,
      role_matrix: matrix,
      user_overrides: userOverrides,
      user_statuses: userStatuses,
      user_role_overrides: userRoleOverrides,
      managed_users: Array.isArray(raw.managed_users) ? raw.managed_users : [],
      password_overrides: passwordOverrides,
      security_settings: {
        ...DEFAULT_SECURITY_SETTINGS,
        ...(raw.security_settings && typeof raw.security_settings === 'object'
          ? raw.security_settings
          : {}),
      },
      login_failures:
        raw.login_failures && typeof raw.login_failures === 'object' ? raw.login_failures : {},
    };
  } catch {
    const initial = createInitialStore();
    writeRbacStore(initial);
    return initial;
  }
}

export function writeRbacStore(data: RbacStoreData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const safeData: RbacStoreData = {
    ...data,
    role_matrix: {
      ...data.role_matrix,
      SUPER_ADMIN: [...ALL_CANONICAL_PERMISSIONS],
    },
    user_statuses: {
      ...data.user_statuses,
      [SUPER_ADMIN_EMAIL.toLowerCase()]: 'ACTIVE',
    },
  };
  fs.writeFileSync(RBAC_STORE_PATH, JSON.stringify(safeData, null, 2), 'utf8');
}

function ensureInitialAuditSeed(): void {
  if (fs.existsSync(RBAC_AUDIT_PATH)) return;
  const now = new Date().toISOString();
  const initialLogs: RbacAuditLogEntry[] = [
    {
      id: `RBAC-INIT-1`,
      actor_user_id: SUPER_ADMIN_USER_ID,
      actor_name: SUPER_ADMIN_NAME,
      actor_role: 'SUPER_ADMIN',
      target_user_id: SUPER_ADMIN_USER_ID,
      target_label: `${SUPER_ADMIN_NAME} (${SUPER_ADMIN_EMAIL})`,
      action: 'SUPER_ADMIN_INITIALIZED',
      category: 'SECURITY',
      previous_value: null,
      new_value: 'SUPER_ADMIN:ACTIVE',
      details: 'Immutable Super Admin account provisioned via initial RBAC system setup.',
      timestamp: now,
      severity: 'info',
    },
    {
      id: `RBAC-INIT-2`,
      actor_user_id: SUPER_ADMIN_USER_ID,
      actor_name: SUPER_ADMIN_NAME,
      actor_role: 'SUPER_ADMIN',
      target_label: '5 Protected Core Roles',
      action: 'RBAC_MATRIX_INITIALIZED',
      category: 'PERMISSION',
      previous_value: null,
      new_value: 'SUPER_ADMIN, ADMIN, DOCTOR, RECEPTIONIST, PATIENT',
      details: 'Default granular MODULE:ACTION permission matrix seeded with deny-by-default enforcement.',
      timestamp: now,
      severity: 'info',
    },
  ];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RBAC_AUDIT_PATH, JSON.stringify(initialLogs, null, 2), 'utf8');
}

export function readRbacAuditLogs(limit = 1000): RbacAuditLogEntry[] {
  ensureInitialAuditSeed();
  try {
    const raw = JSON.parse(fs.readFileSync(RBAC_AUDIT_PATH, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return (raw as RbacAuditLogEntry[]).slice(0, limit);
  } catch {
    return [];
  }
}

export function recordRbacAuditLog(
  entry: Omit<RbacAuditLogEntry, 'id' | 'timestamp'>,
): RbacAuditLogEntry {
  const existing = readRbacAuditLogs(5000);
  const fullEntry: RbacAuditLogEntry = {
    id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  const next = [fullEntry, ...existing].slice(0, 5000);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RBAC_AUDIT_PATH, JSON.stringify(next, null, 2), 'utf8');
  return fullEntry;
}

export function checkLoginLockout(email: string): { locked: boolean; retryAfterMinutes?: number } {
  const store = readRbacStore();
  const key = email.trim().toLowerCase();
  const state = store.login_failures[key];
  if (!state || !state.locked_until) return { locked: false };
  const lockEnd = new Date(state.locked_until).getTime();
  if (Number.isNaN(lockEnd) || lockEnd <= Date.now()) {
    delete store.login_failures[key];
    writeRbacStore(store);
    return { locked: false };
  }
  const mins = Math.max(1, Math.ceil((lockEnd - Date.now()) / 60000));
  return { locked: true, retryAfterMinutes: mins };
}

export function recordFailedLoginAttempt(email: string): {
  lockedNow: boolean;
  attemptsRemaining: number;
} {
  const store = readRbacStore();
  const key = email.trim().toLowerCase();
  const maxAttempts = Math.max(2, Number(store.security_settings.max_failed_login_attempts || 5));
  const lockoutMins = Math.max(1, Number(store.security_settings.lockout_minutes || 15));
  const prev = store.login_failures[key] || { count: 0, locked_until: null };
  const nextCount = prev.count + 1;
  const lockedNow = nextCount >= maxAttempts;
  store.login_failures[key] = {
    count: nextCount,
    locked_until: lockedNow ? new Date(Date.now() + lockoutMins * 60000).toISOString() : null,
  };
  writeRbacStore(store);
  return {
    lockedNow,
    attemptsRemaining: Math.max(0, maxAttempts - nextCount),
  };
}

export function clearFailedLoginAttempts(email: string): void {
  const store = readRbacStore();
  const key = email.trim().toLowerCase();
  if (store.login_failures[key]) {
    delete store.login_failures[key];
    writeRbacStore(store);
  }
}

export function isDisallowedLegacyFakeAdmin(email?: string | null, fullName?: string | null): boolean {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(fullName || '').trim().toLowerCase();
  return (
    ['admin', 'admin@hospital.com', 'admin@carepulse.local'].includes(cleanEmail) ||
    cleanName.includes('kavita rao')
  );
}

export function hydrateAuthUserFromStore(baseUser: AuthUser): {
  user: AuthUser | null;
  blockedStatus?: AccountStatus;
} {
  const store = readRbacStore();
  const key = normalizeUserKey(baseUser.email, baseUser.user_id);

  if (
    isProtectedSuperAdminIdentity({
      role: baseUser.role,
      email: baseUser.email,
      username: baseUser.username,
      full_name: baseUser.full_name,
    })
  ) {
    return {
      user: {
        ...baseUser,
        user_id: SUPER_ADMIN_USER_ID,
        username: SUPER_ADMIN_USERNAME,
        email: SUPER_ADMIN_EMAIL,
        full_name: SUPER_ADMIN_NAME,
        role: 'SUPER_ADMIN',
        roles: ['SUPER_ADMIN'],
        status: 'ACTIVE',
        grants: [],
        revokes: [],
        permissions: [...ALL_CANONICAL_PERMISSIONS],
        auth_mode: 'system',
      },
    };
  }

  const effectiveRole = store.user_role_overrides[key] || baseUser.role;
  const status: AccountStatus = store.user_statuses[key] || baseUser.status || 'ACTIVE';

  if (status !== 'ACTIVE') {
    return { user: null, blockedStatus: status };
  }

  const override = store.user_overrides[key] || { grants: [], revokes: [] };
  const effectivePermissions = computeEffectivePermissions(effectiveRole, store.role_matrix, override);

  return {
    user: {
      ...baseUser,
      role: effectiveRole,
      roles: [effectiveRole],
      status,
      grants: override.grants,
      revokes: override.revokes,
      permissions: effectivePermissions,
    },
  };
}

export function buildUnifiedUsersDirectory(
  ordsUsers: UserAccount[],
  bridgeAccounts: BridgeUserDescriptor[],
  doctors: Doctor[] = [],
): ManagedUserRecord[] {
  const store = readRbacStore();
  const byEmail = new Map<string, ManagedUserRecord>();

  const toRecord = (input: {
    user_id: number;
    username: string;
    email: string;
    full_name: string;
    phone_number?: string | null;
    defaultRole: RoleName;
    defaultActive?: boolean;
    doctor_id?: number | null;
    patient_id?: number | null;
    created_on?: string;
    source: 'system' | 'ords' | 'managed';
  }): ManagedUserRecord => {
    const key = normalizeUserKey(input.email, input.user_id);
    const isSuperAdmin = isProtectedSuperAdminIdentity({
      role: input.defaultRole,
      email: input.email,
      username: input.username,
      full_name: input.full_name,
    });
    const role: RoleName = isSuperAdmin
      ? 'SUPER_ADMIN'
      : store.user_role_overrides[key] || input.defaultRole;
    const status: AccountStatus = isSuperAdmin
      ? 'ACTIVE'
      : store.user_statuses[key] || (input.defaultActive === false ? 'INACTIVE' : 'ACTIVE');
    const override = isSuperAdmin
      ? { grants: [], revokes: [] }
      : store.user_overrides[key] || { grants: [], revokes: [] };
    const rolePerms = isSuperAdmin
      ? [...ALL_CANONICAL_PERMISSIONS]
      : store.role_matrix[role] || DEFAULT_ROLE_PERMISSION_MATRIX[role] || [];
    const effectivePerms = computeEffectivePermissions(role, store.role_matrix, override);

    return {
      user_key: key,
      user_id: isSuperAdmin ? SUPER_ADMIN_USER_ID : input.user_id,
      username: isSuperAdmin ? SUPER_ADMIN_USERNAME : input.username,
      email: isSuperAdmin ? SUPER_ADMIN_EMAIL : input.email,
      full_name: isSuperAdmin ? SUPER_ADMIN_NAME : input.full_name,
      phone_number: input.phone_number ?? null,
      role,
      status,
      doctor_id: input.doctor_id ?? null,
      patient_id: input.patient_id ?? null,
      grants: override.grants,
      revokes: override.revokes,
      role_permissions: rolePerms,
      effective_permissions: effectivePerms,
      created_on: input.created_on,
      source: input.source,
      is_protected: isSuperAdmin,
    };
  };

  // 1. Always insert immutable Super Admin first
  byEmail.set(
    SUPER_ADMIN_EMAIL.toLowerCase(),
    toRecord({
      user_id: SUPER_ADMIN_USER_ID,
      username: SUPER_ADMIN_USERNAME,
      email: SUPER_ADMIN_EMAIL,
      full_name: SUPER_ADMIN_NAME,
      defaultRole: 'SUPER_ADMIN',
      defaultActive: true,
      created_on: '2025-11-01T09:00:00.000Z',
      source: 'system',
    }),
  );

  // 2. Managed staff accounts created in local RBAC store
  for (const m of store.managed_users) {
    const cleanEmail = m.email.trim().toLowerCase();
    if (!cleanEmail || isDisallowedLegacyFakeAdmin(cleanEmail, m.full_name)) continue;
    byEmail.set(
      cleanEmail,
      toRecord({
        user_id: m.user_id,
        username: m.username,
        email: cleanEmail,
        full_name: m.full_name,
        phone_number: m.phone_number,
        defaultRole: m.role,
        defaultActive: true,
        doctor_id: m.doctor_id,
        patient_id: m.patient_id,
        created_on: m.created_on,
        source: 'managed',
      }),
    );
  }

  // 3. Oracle ORDS GIRISH_USERS accounts
  for (const u of ordsUsers) {
    const cleanEmail = (u.email || '').trim().toLowerCase();
    if (!cleanEmail || isDisallowedLegacyFakeAdmin(cleanEmail, u.full_name)) continue;
    const rawRole = String(u.role_name || 'PATIENT').toUpperCase();
    const mappedRole: RoleName =
      rawRole === 'ADMIN' || rawRole === 'DOCTOR' || rawRole === 'RECEPTIONIST' || rawRole === 'PATIENT'
        ? rawRole
        : 'PATIENT';
    // Skip duplicate reception@hospital.com alias if real receptionists exist
    if (cleanEmail === 'reception@hospital.com') continue;

    // Resolve doctor_id by name if ORDS user didn't include doctor_id
    let docId = u.doctor_id ?? null;
    if (!docId && mappedRole === 'DOCTOR') {
      const targetName = (u.full_name || '').replace(/^dr\.?\s*/i, '').trim().toLowerCase();
      const docMatch = doctors.find(
        (d) => `${d.first_name} ${d.last_name}`.trim().toLowerCase() === targetName,
      );
      if (docMatch) docId = docMatch.doctor_id;
    }

    const existing = byEmail.get(cleanEmail);
    if (!existing) {
      byEmail.set(
        cleanEmail,
        toRecord({
          user_id: u.user_id,
          username: u.username || cleanEmail,
          email: cleanEmail,
          full_name: u.full_name,
          phone_number: u.phone_number,
          defaultRole: mappedRole,
          defaultActive: u.is_active !== 'N',
          doctor_id: docId,
          patient_id: u.patient_id,
          created_on: u.created_on,
          source: 'ords',
        }),
      );
    }
  }

  // 4. Bridge system accounts (Girish DR, Priya Sharma, John Doe, Meera Kulkarni) if not already in ORDS
  for (const b of bridgeAccounts) {
    const cleanEmail = b.email.trim().toLowerCase();
    if (!cleanEmail || cleanEmail === 'reception@carepulse.local') continue;
    if (!byEmail.has(cleanEmail)) {
      byEmail.set(
        cleanEmail,
        toRecord({
          user_id: b.user_id,
          username: b.username,
          email: cleanEmail,
          full_name: b.full_name,
          defaultRole: b.role,
          defaultActive: true,
          doctor_id: b.doctor_id,
          patient_id: b.patient_id,
          created_on: '2025-11-01T09:00:00.000Z',
          source: 'system',
        }),
      );
    }
  }

  return Array.from(byEmail.values()).sort((a, b) => {
    const rank = (r: RoleName) =>
      r === 'SUPER_ADMIN' ? 0 : r === 'ADMIN' ? 1 : r === 'DOCTOR' ? 2 : r === 'RECEPTIONIST' ? 3 : 4;
    const diff = rank(a.role) - rank(b.role);
    if (diff !== 0) return diff;
    return a.full_name.localeCompare(b.full_name);
  });
}

export function buildRoleDefinitions(directory: ManagedUserRecord[]): RoleDefinition[] {
  const store = readRbacStore();
  return PROTECTED_CORE_ROLES.map((role) => {
    const meta = ROLE_META[role];
    const matched = directory.filter((u) => u.role === role);
    const activeMatched = matched.filter((u) => u.status === 'ACTIVE');
    const perms =
      role === 'SUPER_ADMIN'
        ? [...ALL_CANONICAL_PERMISSIONS]
        : store.role_matrix[role] || DEFAULT_ROLE_PERMISSION_MATRIX[role];
    return {
      role,
      label: meta.label,
      description: meta.description,
      is_protected: meta.isProtected,
      is_immutable: meta.isImmutable,
      allow_public_registration:
        role === 'PATIENT' ? store.security_settings.allow_patient_registration : meta.allowPublicRegistration,
      max_accounts: meta.maxAccounts,
      user_count: matched.length,
      active_count: activeMatched.length,
      permission_count: perms.length,
      permissions: perms,
    };
  });
}

export function findManagedUserRecord(
  directory: ManagedUserRecord[],
  userKeyOrId: string,
): ManagedUserRecord | undefined {
  const clean = decodeURIComponent(userKeyOrId).trim().toLowerCase();
  return directory.find(
    (u) =>
      u.user_key.toLowerCase() === clean ||
      u.email.toLowerCase() === clean ||
      String(u.user_id) === clean ||
      `uid:${u.user_id}` === clean,
  );
}
