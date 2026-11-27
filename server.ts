import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import type {
  AccountStatus,
  AnalyticsDatasetResponse,
  AnalyticsVisitRecord,
  Appointment,
  AuthUser,
  CancellationRule,
  ConsultationMode,
  DashboardSummaryResponse,
  Department,
  Doctor,
  DoctorLeave,
  DoctorShiftConfig,
  MedicalRecordEntry,
  ModuleKey,
  Patient,
  Payment,
  PendingOutcomeItem,
  PermissionAction,
  PortalNotification,
  PrescriptionEntry,
  RbacAuditLogEntry,
  RoleName,
  ShiftChangeRequest,
  ShiftSession,
  Slot,
  SlotTemplate,
  TokenQueueItem,
  UserAccount,
  UtilisationReportRow,
} from './src/types/opd.ts';
import {
  DEFAULT_ROLE_PERMISSION_MATRIX,
  RBAC_MODULES,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_LABELS,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_NAME,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_NAME,
  SUPER_ADMIN_USERNAME,
  canActorModifyTargetUser,
  computeEffectivePermissions,
  diffPermissionSets,
  hasAnyEffectivePermission,
  hasEffectivePermission,
  isProtectedSuperAdminIdentity,
  isSingleAdminUser,
} from './src/utils/permissions.ts';
import {
  ALL_CANONICAL_PERMISSIONS,
  SUPER_ADMIN_USER_ID,
  normalizeCanonicalPermissions,
} from './src/utils/rbac.ts';
import {
  doesLoginNameMatch,
  enrichAppointments,
  enrichSlots,
  formatDisplayDate,
  getIsoDatePart,
  getNextHoldExpiryMs,
  isAppointmentHoldExpired,
  normalizeOrdsError,
} from './src/utils/rules.ts';
import {
  buildWorkingHourWindows,
  DEFAULT_HOSPITAL_TIMEZONE,
  DEFAULT_WORKING_DAYS,
  deriveShiftDefaultsFromTemplates,
  formatShiftSummary,
  getHospitalNowParts,
  getTodayIsoLocal,
  getWeekdayName,
  getAppointmentsAwaitingOutcome,
  isAppointmentTimeReached,
  isDateCoveredByApprovedLeave,
  isSlotEndExpired,
  isValidSlotTimeRange,
  validateShiftSessions,
} from './src/utils/calendar.ts';
import {
  evaluateCancellationRefund,
  isRefundCompletionDue,
  type RefundLifecycleStatus,
} from './src/utils/refunds.ts';
import {
  DEFAULT_SEEDED_PATIENT_REGIONS,
  normalizeRegionText,
  type PatientRegion,
} from './src/utils/regions.ts';
import {
  deriveDeterministicConsultationMode,
  generateHistoricalAnalyticsSeed,
} from './src/utils/analyticsSeed.ts';
import {
  buildOracleAuditPayload,
  describeBookingAuditDetails,
  describeCancellationAuditDetails,
} from './src/utils/auditLogs.ts';
import {
  buildScopedPortalNotifications,
  canDecideLeaveOrShiftRequest,
  canViewAllShiftChangeRequests,
  scopeLeavesForUser,
  shouldIncludePendingApprovalsCount,
} from './src/utils/notifications.ts';
import { normalizeRecordConsultationMode } from './src/utils/analytics.ts';
import {
  buildRoleDefinitions,
  buildUnifiedUsersDirectory,
  checkLoginLockout,
  clearFailedLoginAttempts,
  findManagedUserRecord,
  hashPasswordScrypt,
  hydrateAuthUserFromStore,
  isDisallowedLegacyFakeAdmin,
  normalizeUserKey,
  readRbacAuditLogs,
  readRbacStore,
  recordFailedLoginAttempt,
  recordRbacAuditLog,
  registerExternalAuditLogSink,
  verifyPasswordScrypt,
  writeRbacStore,
} from './server/rbacStore.ts';
import {
  readClinicalStore,
  writeClinicalStore,
  type PatientNotificationRecord,
} from './server/clinicalStore.ts';
import {
  mergeByIdWithOraclePriority,
  mergeShiftMaps,
  parseOracleDoctorShiftRow,
  parseOracleMedicalRecordRow,
  parseOraclePrescriptionRow,
  parseOracleShiftChangeRequestRow,
  serializeDoctorShiftForOracle,
  serializeMedicalRecordForOracle,
  serializePrescriptionForOracle,
  serializeShiftChangeRequestForOracle,
} from './src/utils/clinicalAndShifts.ts';
import type {
  GlobalBranch,
  GlobalBranchDepartment,
  GlobalBranchUtilisationRow,
  GlobalCountry,
  GlobalDoctorBranch,
  GlobalPatientProfile,
  GlobalPaymentBranchLink,
} from './src/types/opd.ts';
import {
  computeBranchUtilisation,
  enrichAppointmentsWithBranch,
  enrichPaymentsWithBranch,
  enrichSlotsWithBranch,
  getDoctorEffectiveBranchFee,
  getHeadquartersBranch,
} from './src/utils/globalBranch.ts';
import {
  getNextNumericId,
  readGlobalStore,
  writeGlobalStore,
  type GlobalSidecarStoreData,
} from './server/globalStore.ts';

const HOSPITAL_TIMEZONE = process.env.HOSPITAL_TIMEZONE || DEFAULT_HOSPITAL_TIMEZONE;
function getServerTodayIso(): string {
  return getTodayIsoLocal(new Date(), HOSPITAL_TIMEZONE);
}

import {
  ALL_OIC_PHASES,
  OIC_INTEGRATIONS_CATALOG,
  OIC_PHASE_SPECS,
  classifyEndpointPhase,
  normalizeBackendMode,
  normalizeBackendPayload,
  normalizeEnabledPhases,
  normalizeOicBaseUrl,
  normalizeOicMutationPayload,
  parseBackendMode,
  resolveRoutingDecision,
  sanitizeEnvValue,
  type BackendMode,
  type OicPhaseId,
  type ServedBy,
} from './src/utils/backendRouter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ORDS_BASE_URL = (
  sanitizeEnvValue(process.env.ORDS_BASE_URL) ||
  'https://ga97be9115f23e9-moviestreamworkshop.adb.ap-mumbai-1.oraclecloudapps.com/ords/nov_2026_batch/girish_opd_api/v1'
).replace(/\/+$/, '');
const OIC_BASE_URL = normalizeOicBaseUrl(process.env.OIC_BASE_URL);
const OIC_TOKEN_URL = sanitizeEnvValue(process.env.OIC_TOKEN_URL);
const OIC_CLIENT_ID = sanitizeEnvValue(process.env.OIC_CLIENT_ID);
const OIC_CLIENT_SECRET = sanitizeEnvValue(process.env.OIC_CLIENT_SECRET);
const OIC_SCOPE = sanitizeEnvValue(process.env.OIC_SCOPE);
const OIC_USERNAME = sanitizeEnvValue(process.env.OIC_USERNAME);
const OIC_PASSWORD = sanitizeEnvValue(process.env.OIC_PASSWORD);
const OIC_OAUTH_CONFIGURED = Boolean(
  OIC_BASE_URL && OIC_TOKEN_URL && OIC_CLIENT_ID && OIC_CLIENT_SECRET,
);
const OIC_BASIC_CONFIGURED = Boolean(OIC_BASE_URL && OIC_USERNAME && OIC_PASSWORD);
const OIC_CONFIGURED = OIC_OAUTH_CONFIGURED || OIC_BASIC_CONFIGURED;
const BACKEND_MODE_PATH = path.resolve(__dirname, 'data', 'backend_mode.json');

interface PersistedBackendState {
  mode: BackendMode;
  oic_phases: OicPhaseId[];
}

function readBackendState(): PersistedBackendState {
  const defaultMode: BackendMode = OIC_CONFIGURED ? 'HYBRID' : 'ORDS';
  try {
    if (fs.existsSync(BACKEND_MODE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BACKEND_MODE_PATH, 'utf8')) as {
        mode?: unknown;
        oic_phases?: unknown;
      };
      const parsedMode = normalizeBackendMode(raw.mode, OIC_CONFIGURED, defaultMode);
      const parsedPhases = normalizeEnabledPhases(raw.oic_phases);
      return {
        mode: parsedMode,
        oic_phases: parsedPhases.length > 0 ? parsedPhases : [...ALL_OIC_PHASES],
      };
    }
  } catch {
    // Fall back to defaults
  }
  return { mode: defaultMode, oic_phases: [...ALL_OIC_PHASES] };
}

function writeBackendState(next: PersistedBackendState): void {
  try {
    fs.mkdirSync(path.dirname(BACKEND_MODE_PATH), { recursive: true });
    fs.writeFileSync(BACKEND_MODE_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // Keep in-memory state if disk write fails
  }
}

let backendState: PersistedBackendState = readBackendState();

let cachedOicToken: { accessToken: string; expiresAtMs: number } | null = null;
let inFlightOicTokenPromise: Promise<string> | null = null;

async function getOicAccessToken(forceRefresh = false): Promise<string> {
  if (!OIC_OAUTH_CONFIGURED) {
    throw new Error('OIC OAuth 2.0 client credentials are not configured.');
  }
  const now = Date.now();
  if (!forceRefresh && cachedOicToken && cachedOicToken.expiresAtMs - 60_000 > now) {
    return cachedOicToken.accessToken;
  }
  if (!forceRefresh && inFlightOicTokenPromise) {
    return inFlightOicTokenPromise;
  }

  inFlightOicTokenPromise = (async () => {
    const basicCreds = Buffer.from(`${OIC_CLIENT_ID}:${OIC_CLIENT_SECRET}`).toString('base64');
    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');
    if (OIC_SCOPE) {
      form.set('scope', OIC_SCOPE);
    }

    const tokenRes = await fetch(OIC_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basicCreds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenText = await tokenRes.text();
    let tokenJson: {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } = {};
    try {
      tokenJson = tokenText ? (JSON.parse(tokenText) as typeof tokenJson) : {};
    } catch {
      // Non-JSON error body
    }

    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(
        tokenJson.error_description ||
          tokenJson.error ||
          `OIC OAuth token request failed (HTTP ${tokenRes.status})`,
      );
    }

    const ttlSec = Math.max(60, Number(tokenJson.expires_in || 3600));
    cachedOicToken = {
      accessToken: tokenJson.access_token,
      expiresAtMs: Date.now() + ttlSec * 1000,
    };
    return cachedOicToken.accessToken;
  })();

  try {
    return await inFlightOicTokenPromise;
  } finally {
    inFlightOicTokenPromise = null;
  }
}

interface RequestRoutingContext {
  mode: BackendMode;
  servedBy: ServedBy | null;
  integrationName: string | null;
  res: Response;
}

const requestRoutingStorage = new AsyncLocalStorage<RequestRoutingContext>();

function getActiveBackendMode(): BackendMode {
  return requestRoutingStorage.getStore()?.mode ?? backendState.mode;
}

function recordRequestServedBy(
  servedBy: ServedBy,
  integrationName?: string | null,
  explicitRes?: Response,
): void {
  const ctx = requestRoutingStorage.getStore();
  if (ctx) {
    if (ctx.servedBy !== 'OIC' || servedBy === 'OIC') {
      ctx.servedBy = servedBy;
      ctx.integrationName = integrationName ?? null;
    }
    if (!ctx.res.headersSent) {
      ctx.res.setHeader('X-Served-By', ctx.servedBy);
      if (ctx.integrationName) {
        ctx.res.setHeader('X-OIC-Integration', ctx.integrationName);
      }
    }
  } else if (explicitRes && !explicitRes.headersSent) {
    explicitRes.setHeader('X-Served-By', servedBy);
    if (integrationName) {
      explicitRes.setHeader('X-OIC-Integration', integrationName);
    }
  }
}

let auditLogsEndpointMissingUntilMs = 0;

function syncAuditLogToOracleDirect(entry: RbacAuditLogEntry): void {
  if (Date.now() < auditLogsEndpointMissingUntilMs) {
    return;
  }
  const payload = buildOracleAuditPayload(entry);
  const url = `${ORDS_BASE_URL}/audit-logs`;
  // Out-of-band direct ORDS sync: bypasses fetchUpstreamWithRetry and requestRoutingStorage
  // so OIC routing and X-Served-By / X-OIC-Integration headers remain completely untouched.
  void fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  })
    .then(async (res) => {
      if (res.status === 404 || res.status === 405) {
        auditLogsEndpointMissingUntilMs = Date.now() + 5 * 60 * 1000;
        return;
      }
      if (!res.ok) {
        return;
      }
      const txt = await res.text().catch(() => '');
      if (txt) {
        try {
          const parsed = JSON.parse(txt) as { status?: string; message?: string };
          if (parsed?.status === 'error') {
            console.warn('[audit-sync] Oracle ORDS POST /audit-logs returned error:', parsed.message);
          }
        } catch {
          // Non-JSON 2xx response is acceptable
        }
      }
    })
    .catch(() => {
      // Non-blocking audit sync: never interrupt primary portal operations
    });
}

async function resolveUpstreamTarget(
  endpoint: string,
  method = 'GET',
  forceRefreshToken = false,
): Promise<{
  servedBy: ServedBy;
  backend: ServedBy;
  mode: BackendMode;
  phase: OicPhaseId;
  integrationName: string | null;
  url: string;
  headers: Record<string, string>;
}> {
  const activeMode = getActiveBackendMode();
  const decision = resolveRoutingDecision({
    mode: activeMode,
    method,
    endpoint,
    oicConfigured: OIC_CONFIGURED,
    ordsBaseUrl: ORDS_BASE_URL,
    oicBaseUrl: OIC_BASE_URL,
    enabledPhases: backendState.oic_phases,
  });

  const headers: Record<string, string> = {};
  if (decision.servedBy === 'OIC') {
    if (OIC_OAUTH_CONFIGURED) {
      const token = await getOicAccessToken(forceRefreshToken);
      headers.Authorization = `Bearer ${token}`;
    } else if (OIC_BASIC_CONFIGURED) {
      const auth = Buffer.from(`${OIC_USERNAME}:${OIC_PASSWORD}`).toString('base64');
      headers.Authorization = `Basic ${auth}`;
    }
  }

  return {
    servedBy: decision.servedBy,
    backend: decision.servedBy,
    mode: decision.mode,
    phase: decision.phase,
    integrationName: decision.integrationName,
    url: decision.url,
    headers,
  };
}

const SESSION_SECRET = process.env.SESSION_SECRET || 'carepulse-opd-dev-session-secret-2026';
const SESSION_COOKIE = 'carepulse_opd_session';

interface SessionPayload {
  user: AuthUser;
  exp: number;
}

interface BridgeCredential {
  user_id: number;
  username: string;
  email: string;
  password: string;
  full_name: string;
  role: RoleName;
  doctor_id?: number | null;
  patient_id?: number | null;
}

const BRIDGE_ACCOUNTS: BridgeCredential[] = [
  {
    user_id: 1,
    username: 'girish.dr',
    email: SINGLE_ADMIN_EMAIL,
    password: process.env.DEMO_ADMIN_PASSWORD || 'Admin@123',
    full_name: SINGLE_ADMIN_NAME,
    role: 'ADMIN',
  },
  {
    user_id: 21,
    username: 'priya.sharma',
    email: 'priya@hospital.com',
    password: process.env.DEMO_DOCTOR_PASSWORD || 'Doctor@123',
    full_name: 'Dr. Priya Sharma',
    role: 'DOCTOR',
    doctor_id: 2,
  },
  {
    user_id: 41,
    username: 'anil.mehta',
    email: 'anil.mehta@hospital.com',
    password: process.env.DEMO_DOCTOR_PASSWORD || 'Doctor@123',
    full_name: 'Dr. Anil Mehta',
    role: 'DOCTOR',
    doctor_id: 3,
  },
  {
    user_id: 42,
    username: 'john.doe@example.com',
    email: 'john.doe@example.com',
    password: process.env.DEMO_PATIENT_PASSWORD || 'Patient@123',
    full_name: 'John Doe',
    role: 'PATIENT',
    patient_id: 1,
  },
  {
    user_id: 43,
    username: 'meera.kulkarni',
    email: 'meera.kulkarni@hospital.com',
    password: process.env.DEMO_RECEPTIONIST_PASSWORD || 'Reception@123',
    full_name: 'Meera Kulkarni',
    role: 'RECEPTIONIST',
  },
  {
    user_id: 1004,
    username: 'receptionist',
    email: 'reception@carepulse.local',
    password: process.env.DEMO_RECEPTIONIST_PASSWORD || 'Reception@123',
    full_name: 'Meera Kulkarni',
    role: 'RECEPTIONIST',
  },
];

function getSessionTtlMs(): number {
  const store = readRbacStore();
  const hours = Math.max(1, Math.min(168, Number(store.security_settings.session_ttl_hours || 12)));
  return hours * 60 * 60 * 1000;
}

function signSession(user: AuthUser): string {
  const payload: SessionPayload = {
    user,
    exp: Date.now() + getSessionTtlMs(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySession(token?: string | null): AuthUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.user;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

function getRequestToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] || null;
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: getSessionTtlMs(),
    path: '/',
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
  });
}

async function fetchUpstreamWithRetry(
  endpoint: string,
  init?: RequestInit,
): Promise<{
  response: globalThis.Response;
  target: Awaited<ReturnType<typeof resolveUpstreamTarget>>;
}> {
  const method = String(init?.method || 'GET').toUpperCase();
  let target = await resolveUpstreamTarget(endpoint, method, false);
  let body = init?.body;

  if (
    target.servedBy === 'OIC' &&
    method !== 'GET' &&
    method !== 'HEAD' &&
    typeof body === 'string' &&
    body.trim()
  ) {
    try {
      const parsedBody = JSON.parse(body);
      body = JSON.stringify(normalizeOicMutationPayload(method, endpoint, parsedBody));
    } catch {
      // Keep original body if non-JSON
    }
  }

  const fetchWithTimeout = async (activeTarget: typeof target) => {
    try {
      return await fetch(activeTarget.url, {
        ...init,
        method,
        body,
        signal: init?.signal ?? AbortSignal.timeout(25_000),
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...activeTarget.headers,
          ...(init?.headers || {}),
        },
      });
    } catch (err) {
      const cause = (err as Error & { cause?: { code?: string; message?: string } })?.cause;
      const detail = cause?.code || cause?.message || (err instanceof Error ? err.message : 'Network error');
      const wrapped = new Error(
        `${activeTarget.servedBy} request failed (${activeTarget.integrationName || endpoint}): ${detail}`,
      );
      (wrapped as Error & { statusCode?: number }).statusCode = 502;
      throw wrapped;
    }
  };

  let response = await fetchWithTimeout(target);

  if (response.status === 401 && target.servedBy === 'OIC' && OIC_OAUTH_CONFIGURED) {
    target = await resolveUpstreamTarget(endpoint, method, true);
    response = await fetchWithTimeout(target);
  }

  recordRequestServedBy(target.servedBy, target.integrationName);
  return { response, target };
}

async function fetchOrdsJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const { response, target } = await fetchUpstreamWithRetry(endpoint, init);
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = normalizeBackendPayload(JSON.parse(text));
    } catch {
      parsed = { message: text };
    }
  }
  if (!response.ok) {
    const label = target.servedBy;
    const err = new Error(normalizeOrdsError(parsed, `${label} returned HTTP ${response.status}`));
    (err as Error & { statusCode?: number }).statusCode = response.status;
    throw err;
  }
  return parsed as T;
}

async function fetchOrdsItems<T>(endpoint: string): Promise<T[]> {
  const separator = endpoint.includes('?') ? '&' : '?';
  const data = await fetchOrdsJson<{ items?: T[]; hasMore?: boolean; links?: Array<{ rel: string; href: string }> }>(
    `${endpoint}${separator}limit=500`,
  );
  return Array.isArray(data.items) ? data.items : [];
}

let inFlightExpireHolds: Promise<number> | null = null;
let lastExpireHoldsCheckMs = 0;
let knownNextHoldExpiryMs: number | null = null;

function trackNextHoldExpiry(appointments: Array<Pick<Appointment, 'status' | 'hold_expires_at'>>): void {
  knownNextHoldExpiryMs = getNextHoldExpiryMs(appointments);
}

async function runOrdsExpireHolds(options?: {
  overdueAppointments?: Appointment[];
  triggerActor?: Pick<AuthUser, 'user_id' | 'full_name' | 'email' | 'role'> | null;
}): Promise<number> {
  if (inFlightExpireHolds) return inFlightExpireHolds;
  inFlightExpireHolds = (async () => {
    try {
      let overdueToAudit = (options?.overdueAppointments || []).filter((a) =>
        isAppointmentHoldExpired(a),
      );
      if (overdueToAudit.length === 0) {
        const currentAppts = await fetchOrdsItems<Appointment>('appointments').catch(
          () => [] as Appointment[],
        );
        overdueToAudit = currentAppts.filter((a) => isAppointmentHoldExpired(a));
      }

      const res = await fetchOrdsJson<{ status?: string; expired_count?: number }>(
        'appointments/expire-holds',
        { method: 'POST', body: '{}' },
      );
      lastExpireHoldsCheckMs = Date.now();
      knownNextHoldExpiryMs = null;
      const expiredCount = Number(res?.expired_count || 0);

      if (expiredCount > 0 && overdueToAudit.length > 0) {
        const actor = options?.triggerActor;
        for (const expiredAppt of overdueToAudit) {
          recordRbacAuditLog({
            actor_user_id: actor?.user_id ?? null,
            actor_name: actor?.full_name || 'Hold Expiry Scheduler',
            actor_email: actor?.email ?? null,
            actor_role: actor?.role || 'SYSTEM',
            target_label: expiredAppt.appointment_ref,
            action: 'APPOINTMENT_HOLD_EXPIRED',
            category: 'APPOINTMENTS',
            previous_value: 'HELD',
            new_value: 'CANCELLED (HOLD_EXPIRED)',
            details: `10-minute unpaid hold expired for ${expiredAppt.appointment_ref} (${expiredAppt.patient_name || `Patient #${expiredAppt.patient_id}`}); slot #${expiredAppt.slot_id} released automatically.`,
            severity: 'info',
          });
        }
      }

      return expiredCount;
    } catch {
      lastExpireHoldsCheckMs = Date.now();
      return 0;
    } finally {
      inFlightExpireHolds = null;
    }
  })();
  return inFlightExpireHolds;
}

async function ensureOverdueHoldsExpired(options?: {
  force?: boolean;
  appointmentsHint?: Appointment[];
  triggerActor?: Pick<AuthUser, 'user_id' | 'full_name' | 'email' | 'role'> | null;
}): Promise<boolean> {
  if (options?.appointmentsHint) {
    trackNextHoldExpiry(options.appointmentsHint);
    const overdue = options.appointmentsHint.filter((a) => isAppointmentHoldExpired(a));
    if (!options.force && overdue.length === 0) {
      return false;
    }
    const expired = await runOrdsExpireHolds({
      overdueAppointments: overdue,
      triggerActor: options.triggerActor,
    });
    return expired > 0;
  }

  const now = Date.now();
  const dueByKnownHold = knownNextHoldExpiryMs !== null && now >= knownNextHoldExpiryMs;
  const dueByInterval = now - lastExpireHoldsCheckMs >= 30_000;
  if (!options?.force && !dueByKnownHold && !dueByInterval) {
    return false;
  }
  const expired = await runOrdsExpireHolds({ triggerActor: options?.triggerActor });
  return expired > 0;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const rawUser = verifySession(getRequestToken(req));
  if (!rawUser) {
    res.status(401).json({ status: 'error', message: 'Authentication required' });
    return;
  }
  const hydrated = hydrateAuthUserFromStore(rawUser);
  if (!hydrated.user) {
    clearSessionCookie(req, res);
    res.status(403).json({
      status: 'error',
      message: `Account is ${(hydrated.blockedStatus || 'INACTIVE').toLowerCase()}. Access denied.`,
    });
    return;
  }
  (req as Request & { authUser?: AuthUser }).authUser = hydrated.user;
  next();
}

function requirePermission(
  user: AuthUser,
  res: Response,
  requiredPermission: string,
  resourceLabel: string,
): boolean {
  if (hasEffectivePermission(user.permissions, user.role, requiredPermission)) {
    return true;
  }
  recordRbacAuditLog({
    actor_user_id: user.user_id,
    actor_name: user.full_name,
    actor_role: user.role,
    target_label: resourceLabel,
    action: 'UNAUTHORIZED_ACCESS',
    category: 'SECURITY',
    previous_value: null,
    new_value: `DENIED:${requiredPermission}`,
    details: `Blocked ${user.role} (${user.email}) from accessing ${resourceLabel} — missing ${requiredPermission}.`,
    severity: 'warning',
  });
  res.status(403).json({
    status: 'error',
    message: `Access denied: missing required permission (${requiredPermission}) for ${resourceLabel}.`,
  });
  return false;
}

function requireAnyPermission(
  user: AuthUser,
  res: Response,
  candidates: string[],
  resourceLabel: string,
): boolean {
  if (hasAnyEffectivePermission(user.permissions, user.role, candidates)) {
    return true;
  }
  recordRbacAuditLog({
    actor_user_id: user.user_id,
    actor_name: user.full_name,
    actor_role: user.role,
    target_label: resourceLabel,
    action: 'UNAUTHORIZED_ACCESS',
    category: 'SECURITY',
    previous_value: null,
    new_value: `DENIED:${candidates.join('|')}`,
    details: `Blocked ${user.role} (${user.email}) from accessing ${resourceLabel} — requires one of [${candidates.join(', ')}].`,
    severity: 'warning',
  });
  res.status(403).json({
    status: 'error',
    message: `Access denied: insufficient permissions for ${resourceLabel}.`,
  });
  return false;
}

function isHospitalAdminOrSuper(user: AuthUser): boolean {
  return user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
}

const SHIFT_STORE_DIR = path.resolve(__dirname, 'data');
const SHIFT_STORE_PATH = path.join(SHIFT_STORE_DIR, 'doctor_shifts.json');
const NOTIF_ACK_PATH = path.join(SHIFT_STORE_DIR, 'notifications_ack.json');
const PATIENT_PW_PATH = path.join(SHIFT_STORE_DIR, 'patient_passwords.json');
const PATIENT_REGIONS_PATH = path.join(SHIFT_STORE_DIR, 'patient_regions.json');
const HISTORICAL_ANALYTICS_PATH = path.join(SHIFT_STORE_DIR, 'historical_analytics_seed.json');
const APPT_METADATA_PATH = path.join(SHIFT_STORE_DIR, 'appointment_metadata.json');

interface AppointmentMetadataEntry {
  consultation_mode: ConsultationMode;
  rescheduled_from_id?: number | null;
  appointment_ref?: string | null;
  appointment_id?: number | null;
  patient_id?: number;
  slot_id?: number;
  recorded_outcome?: 'COMPLETED' | 'NO_SHOW' | null;
  outcome_recorded_at?: string | null;
  outcome_recorded_by?: string | null;
  payment_status?: 'UNPAID' | 'SUCCESS' | 'REFUND_PENDING' | 'REFUNDED' | 'NO_REFUND' | null;
  paid_amount?: number | null;
  payment_ref?: string | null;
  payment_method?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
  refund_status?: RefundLifecycleStatus | null;
  refund_due_at?: string | null;
  refund_completed_at?: string | null;
  refund_amount?: number | null;
  refund_percentage?: number | null;
  refund_rule_name?: string | null;
  cancellation_fee?: number | null;
  updated_at: string;
}

function readAppointmentMetadata(): Record<string, AppointmentMetadataEntry> {
  try {
    if (!fs.existsSync(APPT_METADATA_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(APPT_METADATA_PATH, 'utf8'));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, AppointmentMetadataEntry>)
      : {};
  } catch {
    return {};
  }
}

function saveAppointmentMetadata(entry: AppointmentMetadataEntry): void {
  const store = readAppointmentMetadata();
  const existing =
    (entry.appointment_id && entry.appointment_id > 0 ? store[`id:${entry.appointment_id}`] : undefined) ||
    (entry.appointment_ref ? store[`ref:${entry.appointment_ref}`] : undefined);
  const merged: AppointmentMetadataEntry = {
    ...(existing || {}),
    ...entry,
    updated_at: entry.updated_at || new Date().toISOString(),
  };
  if (merged.appointment_id && merged.appointment_id > 0) {
    store[`id:${merged.appointment_id}`] = merged;
  }
  if (merged.appointment_ref) {
    store[`ref:${merged.appointment_ref}`] = merged;
  }
  fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
  fs.writeFileSync(APPT_METADATA_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function syncDueRefunds(nowMs = Date.now()): boolean {
  const store = readAppointmentMetadata();
  let changed = false;
  const completedKeys = new Set<string>();

  for (const [key, entry] of Object.entries(store)) {
    if (!entry || entry.refund_status !== 'REFUND_PENDING') continue;
    if (!isRefundCompletionDue(entry.refund_status, entry.refund_due_at, nowMs)) continue;

    const completedAt = entry.refund_due_at || new Date(nowMs).toISOString();
    const updated: AppointmentMetadataEntry = {
      ...entry,
      refund_status: 'REFUNDED',
      payment_status: 'REFUNDED',
      refund_completed_at: completedAt,
      updated_at: new Date(nowMs).toISOString(),
    };
    store[key] = updated;
    if (updated.appointment_id && updated.appointment_id > 0) {
      store[`id:${updated.appointment_id}`] = updated;
    }
    if (updated.appointment_ref) {
      store[`ref:${updated.appointment_ref}`] = updated;
    }
    changed = true;

    const dedupeId = updated.appointment_ref || String(updated.appointment_id || key);
    if (!completedKeys.has(dedupeId)) {
      completedKeys.add(dedupeId);
      recordRbacAuditLog({
        actor_user_id: 0,
        actor_name: 'Refund Scheduler',
        actor_role: 'SUPER_ADMIN',
        target_label: dedupeId,
        action: 'REFUND_COMPLETED',
        category: 'BILLING',
        previous_value: 'REFUND_PENDING',
        new_value: 'REFUNDED',
        details: `Completed 2-hour rule-based refund of ₹${Number(updated.refund_amount || 0).toFixed(2)} (${updated.refund_percentage ?? 0}% via ${updated.refund_rule_name || 'Cancellation Rule'}) for ${dedupeId}.`,
        severity: 'info',
      });
    }
  }

  if (changed) {
    fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
    fs.writeFileSync(APPT_METADATA_PATH, JSON.stringify(store, null, 2), 'utf8');
  }
  return changed;
}

function attachRefundsToPayments(payments: Payment[]): Payment[] {
  syncDueRefunds();
  const meta = readAppointmentMetadata();
  return payments.map((p) => {
    const metaEntry =
      meta[`id:${p.appointment_id}`] ||
      (p.appointment_ref ? meta[`ref:${p.appointment_ref}`] : undefined);
    if (!metaEntry || !metaEntry.refund_status) return p;

    if (p.status === 'FAILED') return p;
    const paidAmt = Number(metaEntry.paid_amount ?? p.amount ?? 0);
    if (metaEntry.refund_status === 'REFUND_PENDING') {
      return {
        ...p,
        status: 'REFUND_PENDING',
        paid_amount: paidAmt,
        refund_status: 'REFUND_PENDING',
        refund_due_at: metaEntry.refund_due_at ?? null,
        refund_completed_at: null,
        refund_amount: metaEntry.refund_amount ?? 0,
        refund_percentage: metaEntry.refund_percentage ?? 0,
        refund_rule_name: metaEntry.refund_rule_name ?? null,
        cancellation_fee: metaEntry.cancellation_fee ?? 0,
        cancelled_at: metaEntry.cancelled_at ?? null,
      };
    }
    if (metaEntry.refund_status === 'REFUNDED') {
      return {
        ...p,
        status: 'REFUNDED',
        paid_amount: paidAmt,
        refund_status: 'REFUNDED',
        refund_due_at: metaEntry.refund_due_at ?? null,
        refund_completed_at: metaEntry.refund_completed_at ?? null,
        refund_amount: metaEntry.refund_amount ?? paidAmt,
        refund_percentage: metaEntry.refund_percentage ?? 100,
        refund_rule_name: metaEntry.refund_rule_name ?? null,
        cancellation_fee: metaEntry.cancellation_fee ?? 0,
        cancelled_at: metaEntry.cancelled_at ?? null,
      };
    }
    return {
      ...p,
      paid_amount: paidAmt,
      refund_status: 'NO_REFUND',
      refund_amount: 0,
      refund_percentage: metaEntry.refund_percentage ?? 0,
      refund_rule_name: metaEntry.refund_rule_name ?? null,
      cancellation_fee: metaEntry.cancellation_fee ?? 0,
      cancelled_at: metaEntry.cancelled_at ?? null,
    };
  });
}

function getEffectiveCollectedPaymentAmount(p: Payment): number {
  if (p.status === 'SUCCESS' || p.status === 'REFUND_PENDING') {
    return Number(p.amount || 0);
  }
  if (p.status === 'REFUNDED') {
    const gross = Number(p.paid_amount ?? p.amount ?? 0);
    const refunded = Number(p.refund_amount ?? gross);
    return Math.max(0, Math.round((gross - refunded) * 100) / 100);
  }
  return 0;
}

function recordAppointmentOutcomeOverlay(
  appt: Pick<Appointment, 'appointment_id' | 'appointment_ref' | 'patient_id' | 'slot_id' | 'consultation_mode' | 'rescheduled_from_id'>,
  outcome: 'COMPLETED' | 'NO_SHOW' | null,
  actorName: string,
): void {
  const store = readAppointmentMetadata();
  const existing =
    store[`id:${appt.appointment_id}`] ||
    (appt.appointment_ref ? store[`ref:${appt.appointment_ref}`] : undefined);
  saveAppointmentMetadata({
    consultation_mode:
      existing?.consultation_mode ||
      normalizeConsultationModeInput(appt.consultation_mode) ||
      'FACE_TO_FACE',
    rescheduled_from_id: existing?.rescheduled_from_id ?? appt.rescheduled_from_id ?? null,
    appointment_ref: appt.appointment_ref || existing?.appointment_ref || null,
    appointment_id: appt.appointment_id,
    patient_id: appt.patient_id ?? existing?.patient_id,
    slot_id: appt.slot_id ?? existing?.slot_id,
    recorded_outcome: outcome,
    outcome_recorded_at: outcome ? new Date().toISOString() : null,
    outcome_recorded_by: outcome ? actorName : null,
    updated_at: new Date().toISOString(),
  });
}

function normalizeConsultationModeInput(value: unknown): ConsultationMode | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'ONLINE') return 'ONLINE';
  if (normalized === 'FACE_TO_FACE') return 'FACE_TO_FACE';
  return null;
}

function attachConsultationMode(
  appointments: Appointment[],
  payments: Payment[] = [],
): Appointment[] {
  syncDueRefunds();
  const meta = readAppointmentMetadata();
  const payByApptId = new Map<number, Payment>();
  for (const p of payments) {
    if (p.status === 'SUCCESS' || p.status === 'REFUND_PENDING' || p.status === 'REFUNDED') {
      payByApptId.set(p.appointment_id, p);
    }
  }
  return appointments.map((a) => {
    const directMode = normalizeConsultationModeInput(a.consultation_mode);
    const metaEntry = meta[`id:${a.appointment_id}`] || (a.appointment_ref ? meta[`ref:${a.appointment_ref}`] : undefined);
    const matchedPay = payByApptId.get(a.appointment_id);
    const mode: ConsultationMode = directMode || metaEntry?.consultation_mode || 'FACE_TO_FACE';
    const rescheduledFrom = a.rescheduled_from_id ?? metaEntry?.rescheduled_from_id ?? null;
    const effectiveStatus =
      a.status === 'CONFIRMED' &&
      (metaEntry?.recorded_outcome === 'COMPLETED' || metaEntry?.recorded_outcome === 'NO_SHOW')
        ? metaEntry.recorded_outcome
        : a.status;
    const paidAmount =
      metaEntry?.paid_amount ?? (matchedPay ? Number(matchedPay.amount || 0) : null);
    const paymentStatus =
      metaEntry?.refund_status ||
      metaEntry?.payment_status ||
      (matchedPay
        ? matchedPay.status === 'FAILED'
          ? 'UNPAID'
          : matchedPay.status
        : 'UNPAID');
    return {
      ...a,
      status: effectiveStatus,
      consultation_mode: mode,
      rescheduled_from_id: rescheduledFrom,
      payment_status: paymentStatus,
      paid_amount: paidAmount,
      payment_ref: metaEntry?.payment_ref ?? matchedPay?.payment_ref ?? null,
      payment_method: metaEntry?.payment_method ?? matchedPay?.payment_method ?? null,
      paid_at: metaEntry?.paid_at ?? matchedPay?.created_on ?? null,
      cancelled_at: metaEntry?.cancelled_at ?? null,
      refund_status: metaEntry?.refund_status ?? null,
      refund_due_at: metaEntry?.refund_due_at ?? null,
      refund_completed_at: metaEntry?.refund_completed_at ?? null,
      refund_amount: metaEntry?.refund_amount ?? null,
      refund_percentage: metaEntry?.refund_percentage ?? null,
      refund_rule_name: metaEntry?.refund_rule_name ?? null,
      cancellation_fee: metaEntry?.cancellation_fee ?? null,
    };
  });
}

function countActiveConsultations(appointments: Appointment[]): {
  online: number;
  faceToFace: number;
  totalActive: number;
} {
  const supersededIds = new Set<number>();
  for (const a of appointments) {
    if (a.rescheduled_from_id && a.rescheduled_from_id > 0) {
      supersededIds.add(a.rescheduled_from_id);
    }
  }
  let online = 0;
  let faceToFace = 0;
  for (const a of appointments) {
    if (a.status === 'CANCELLED') continue;
    if (supersededIds.has(a.appointment_id)) continue;
    if (normalizeConsultationModeInput(a.consultation_mode) === 'ONLINE') {
      online += 1;
    } else {
      faceToFace += 1;
    }
  }
  return { online, faceToFace, totalActive: online + faceToFace };
}

function readPatientRegions(): Record<string, PatientRegion> {
  const merged: Record<string, PatientRegion> = {};
  for (const [id, reg] of Object.entries(DEFAULT_SEEDED_PATIENT_REGIONS)) {
    merged[String(id)] = reg;
  }
  try {
    if (!fs.existsSync(PATIENT_REGIONS_PATH)) {
      fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
      fs.writeFileSync(PATIENT_REGIONS_PATH, JSON.stringify(merged, null, 2), 'utf8');
      return merged;
    }
    const raw = JSON.parse(fs.readFileSync(PATIENT_REGIONS_PATH, 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object') {
        const city = normalizeRegionText((v as PatientRegion).city);
        const locality = normalizeRegionText((v as PatientRegion).locality);
        if (city || locality) {
          merged[k] = { city, locality };
        }
      }
    }
  } catch {
    // Keep seeded defaults
  }
  return merged;
}

function writePatientRegions(regions: Record<string, PatientRegion>): void {
  fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
  fs.writeFileSync(PATIENT_REGIONS_PATH, JSON.stringify(regions, null, 2), 'utf8');
}

function savePatientRegion(patientId: number, city: string, locality: string): void {
  if (!patientId || patientId <= 0) return;
  const regions = readPatientRegions();
  regions[String(patientId)] = {
    city: normalizeRegionText(city),
    locality: normalizeRegionText(locality),
  };
  writePatientRegions(regions);
}

function attachRegionsToPatients(patients: Patient[]): Patient[] {
  const regions = readPatientRegions();
  return patients.map((p) => {
    const stored = regions[String(p.patient_id)];
    const city = normalizeRegionText(p.city) || stored?.city || null;
    const locality = normalizeRegionText(p.locality) || stored?.locality || null;
    return {
      ...p,
      city,
      locality,
    };
  });
}

function computePatientAgeGroup(dob?: string | null): AnalyticsVisitRecord['patient_age_group'] {
  if (!dob) return 'Unknown';
  const year = Number(String(dob).slice(0, 4));
  if (!year || year < 1900 || year > 2026) return 'Unknown';
  const age = 2026 - year;
  if (age <= 18) return '0-18';
  if (age <= 35) return '19-35';
  if (age <= 55) return '36-55';
  return '56+';
}

function loadOrSeedHistoricalAnalytics(
  doctors: Doctor[],
  departments: Department[],
): AnalyticsVisitRecord[] {
  const docTeleMap = new Map<number, Doctor['tele_consult_flag']>(
    doctors.map((d) => [d.doctor_id, d.tele_consult_flag]),
  );
  try {
    if (fs.existsSync(HISTORICAL_ANALYTICS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORICAL_ANALYTICS_PATH, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        const records = parsed as AnalyticsVisitRecord[];
        let needsBackfill = false;
        const hydrated = records.map((r) => {
          if (r.consultation_mode === 'ONLINE' || r.consultation_mode === 'FACE_TO_FACE') {
            return r;
          }
          needsBackfill = true;
          return {
            ...r,
            consultation_mode: deriveDeterministicConsultationMode(
              r.id,
              docTeleMap.get(r.doctor_id),
            ),
          };
        });
        if (needsBackfill) {
          fs.writeFileSync(HISTORICAL_ANALYTICS_PATH, JSON.stringify(hydrated, null, 2), 'utf8');
        }
        return hydrated;
      }
    }
  } catch {
    // Regenerate seed if unreadable
  }
  const seeded = generateHistoricalAnalyticsSeed(doctors, departments);
  fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
  fs.writeFileSync(HISTORICAL_ANALYTICS_PATH, JSON.stringify(seeded, null, 2), 'utf8');
  return seeded;
}

function normalizePhoneDigits(phone?: string | null): string {
  const digits = String(phone || '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function readPatientPasswordOverrides(): Record<string, string> {
  try {
    if (!fs.existsSync(PATIENT_PW_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(PATIENT_PW_PATH, 'utf8')) as Record<string, unknown>;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.includes(':')) clean[k.toLowerCase()] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

function writePatientPasswordOverride(email: string, password: string): void {
  const current = readPatientPasswordOverrides();
  current[email.trim().toLowerCase()] = hashPasswordScrypt(password);
  fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
  fs.writeFileSync(PATIENT_PW_PATH, JSON.stringify(current, null, 2), 'utf8');
}

interface ShiftStoreData {
  shifts: Record<string, DoctorShiftConfig>;
  change_requests: ShiftChangeRequest[];
  opened_slot_keys: string[];
  template_doctor_map: Record<string, number>;
  opened_slots_initialized?: boolean;
}

const KNOWN_HISTORICAL_TEMPLATE_DOCTORS: Record<string, number> = {
  '261': 2,
  '293': 2,
  '325': 2,
  '327': 3,
  '545': 4,
};

function makeSlotKey(doctorId: number, slotDate: string, startTime: string): string {
  return `${doctorId}|${getIsoDatePart(slotDate)}|${startTime.trim()}`;
}

function readShiftStore(): ShiftStoreData {
  try {
    if (!fs.existsSync(SHIFT_STORE_PATH)) {
      return {
        shifts: {},
        change_requests: [],
        opened_slot_keys: [],
        template_doctor_map: { ...KNOWN_HISTORICAL_TEMPLATE_DOCTORS },
        opened_slots_initialized: true,
      };
    }
    const raw = fs.readFileSync(SHIFT_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ShiftStoreData>;
    const shifts = parsed.shifts && typeof parsed.shifts === 'object' ? parsed.shifts : {};
    const change_requests = Array.isArray(parsed.change_requests) ? parsed.change_requests : [];
    let opened_slot_keys = Array.isArray(parsed.opened_slot_keys)
      ? parsed.opened_slot_keys.filter((k): k is string => typeof k === 'string')
      : [];
    const template_doctor_map: Record<string, number> = {
      ...KNOWN_HISTORICAL_TEMPLATE_DOCTORS,
      ...(parsed.template_doctor_map && typeof parsed.template_doctor_map === 'object'
        ? parsed.template_doctor_map
        : {}),
    };

    if (!parsed.opened_slots_initialized) {
      // Preserve explicit slot opened by Dr. Rohit (#46) today while hiding old bulk-seeded open slots
      if (shifts['46'] && !opened_slot_keys.includes('46|2026-11-15|10:20')) {
        opened_slot_keys = [...opened_slot_keys, '46|2026-11-15|10:20'];
      }
      const migrated: ShiftStoreData = {
        shifts,
        change_requests,
        opened_slot_keys,
        template_doctor_map,
        opened_slots_initialized: true,
      };
      writeShiftStore(migrated);
      return migrated;
    }

    return {
      shifts,
      change_requests,
      opened_slot_keys,
      template_doctor_map,
      opened_slots_initialized: true,
    };
  } catch {
    return {
      shifts: {},
      change_requests: [],
      opened_slot_keys: [],
      template_doctor_map: { ...KNOWN_HISTORICAL_TEMPLATE_DOCTORS },
      opened_slots_initialized: true,
    };
  }
}

function writeShiftStore(data: ShiftStoreData): void {
  fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
  fs.writeFileSync(
    SHIFT_STORE_PATH,
    JSON.stringify({ ...data, opened_slots_initialized: true }, null, 2),
    'utf8',
  );
}

let slotTemplatesMissingUntilMs = 0;

async function fetchSlotTemplatesSafe(): Promise<SlotTemplate[]> {
  if (Date.now() < slotTemplatesMissingUntilMs) {
    return [];
  }
  try {
    return await fetchOrdsItems<SlotTemplate>('slot_templates');
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404 || statusCode === 405 || isMissingOracleEndpointError(err)) {
      slotTemplatesMissingUntilMs = Date.now() + 5 * 60 * 1000;
    }
    return [];
  }
}

function buildTemplateDoctorMap(
  templates: SlotTemplate[],
  store = readShiftStore(),
): Map<number, number> {
  const map = new Map<number, number>();
  for (const [k, v] of Object.entries(store.template_doctor_map || {})) {
    const tid = Number(k);
    if (tid > 0 && Number(v) > 0) map.set(tid, Number(v));
  }
  for (const t of templates) {
    map.set(t.template_id, t.doctor_id);
  }
  return map;
}

function resolveSlotDoctorId(
  s: Pick<Slot, 'doctor_id' | 'template_id'>,
  tmplDoctorMap: Map<number, number>,
): number | undefined {
  if (s.doctor_id != null && Number(s.doctor_id) > 0) {
    return Number(s.doctor_id);
  }
  if (s.template_id != null) {
    return tmplDoctorMap.get(s.template_id);
  }
  return undefined;
}

function attachDoctorIdsToSlots(
  rawSlots: Slot[],
  templates: SlotTemplate[],
  store = readShiftStore(),
): Slot[] {
  const tmplDoctorMap = buildTemplateDoctorMap(templates, store);
  return rawSlots.map((s) => {
    const resolvedDocId = resolveSlotDoctorId(s, tmplDoctorMap);
    return resolvedDocId ? { ...s, doctor_id: resolvedDocId } : s;
  });
}

function filterConfirmedSlots(
  rawSlots: Slot[],
  templates: SlotTemplate[],
  store = readShiftStore(),
): Slot[] {
  const tmplDoctorMap = buildTemplateDoctorMap(templates, store);
  const openedSet = new Set(store.opened_slot_keys);

  return rawSlots
    .filter((s) => {
      // Always preserve real booked slots
      if (s.booked_patients > 0 || s.status === 'SOLD_OUT') return true;
      // Drop orphaned/cancelled bulk-seeded slots; only keep AVAILABLE slots explicitly opened by the doctor
      if (s.status !== 'AVAILABLE') return false;
      const doctorId = resolveSlotDoctorId(s, tmplDoctorMap);
      if (!doctorId) return false;
      return openedSet.has(makeSlotKey(doctorId, s.slot_date, s.start_time));
    })
    .map((s) => {
      const doctorId = resolveSlotDoctorId(s, tmplDoctorMap);
      return doctorId ? { ...s, doctor_id: doctorId } : s;
    });
}

function readNotificationAcks(): Record<string, string[]> {
  try {
    if (!fs.existsSync(NOTIF_ACK_PATH)) return {};
    const raw = fs.readFileSync(NOTIF_ACK_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) clean[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return clean;
  } catch {
    return {};
  }
}

function writeNotificationAcks(acks: Record<string, string[]>): void {
  fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
  fs.writeFileSync(NOTIF_ACK_PATH, JSON.stringify(acks, null, 2), 'utf8');
}

function resolveDoctorShift(
  doctorId: number,
  templates: SlotTemplate[],
  doctorName?: string,
  store = readShiftStore(),
): DoctorShiftConfig {
  const stored = store.shifts[String(doctorId)];
  const pendingReq =
    store.change_requests.find(
      (r) => r.doctor_id === doctorId && r.status === 'PENDING',
    ) ?? null;

  if (stored) {
    return {
      ...stored,
      doctor_id: doctorId,
      doctor_name: doctorName || stored.doctor_name,
      pending_change_request: pendingReq,
    };
  }

  const derived = deriveShiftDefaultsFromTemplates(doctorId, templates, doctorName);
  return {
    ...derived,
    pending_change_request: pendingReq,
  };
}

function normalizeShiftSessions(raw: unknown): ShiftSession[] {
  if (!Array.isArray(raw)) return [];
  const result = validateShiftSessions(
    raw.map((item) => ({
      start_time: String((item as ShiftSession)?.start_time || '').trim(),
      end_time: String((item as ShiftSession)?.end_time || '').trim(),
    })),
  );
  if (!result.valid) {
    throw new Error(result.message);
  }
  return result.sessions;
}

async function syncShiftToOracleTemplates(
  doctorId: number,
  sessions: ShiftSession[],
  durationMins: number,
  workingDays: string[],
): Promise<void> {
  if (Date.now() < slotTemplatesMissingUntilMs) {
    return;
  }
  try {
    const existingTemplates = await fetchSlotTemplatesSafe();
    if (Date.now() < slotTemplatesMissingUntilMs) {
      return;
    }
    const activeDocTemplates = existingTemplates.filter(
      (t) => t.doctor_id === doctorId && t.is_active === 'Y',
    );

    // Remember template -> doctor attribution before deactivating so booked historical slots keep doctor_id
    if (activeDocTemplates.length > 0) {
      const store = readShiftStore();
      for (const tmpl of activeDocTemplates) {
        store.template_doctor_map[String(tmpl.template_id)] = doctorId;
      }
      writeShiftStore(store);
    }

    // Deactivate old active templates for this doctor so Oracle templates match the new approved shift
    for (const tmpl of activeDocTemplates) {
      try {
        await fetchOrdsJson(`slot_templates/${tmpl.template_id}`, { method: 'DELETE' });
      } catch {
        // Continue syncing remaining templates
      }
    }

    const daysToSync = workingDays.length > 0 ? workingDays : DEFAULT_WORKING_DAYS;
    for (const day of daysToSync) {
      for (const sess of sessions) {
        await fetchOrdsJson('slot_templates', {
          method: 'POST',
          body: JSON.stringify({
            doctor_id: doctorId,
            day_of_week: day.toUpperCase(),
            start_time: sess.start_time,
            end_time: sess.end_time,
            slot_duration_mins: durationMins,
            max_patients_per_slot: 1,
          }),
        });
      }
    }
  } catch {
    // Legacy GIRISH_SLOT_TEMPLATES is optional once GIRISH_DOCTOR_SHIFT_WINDOWS + GIRISH_SLOTS.DOCTOR_ID are active
  }
}

async function getBookedPatientIdsForDoctor(doctorId: number): Promise<Set<number>> {
  const [appointments, slots, templates] = await Promise.all([
    fetchOrdsItems<Appointment>('appointments'),
    fetchOrdsItems<Slot>('slots'),
    fetchSlotTemplatesSafe(),
  ]);
  const tmplDoctorMap = buildTemplateDoctorMap(templates);
  const docSlotIds = new Set(
    slots
      .filter((s) => resolveSlotDoctorId(s, tmplDoctorMap) === doctorId)
      .map((s) => s.slot_id),
  );
  return new Set(
    appointments.filter((a) => docSlotIds.has(a.slot_id)).map((a) => a.patient_id),
  );
}

function isMissingOracleEndpointError(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number } | null)?.statusCode;
  if (statusCode === 404) return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  return /\b404\b|not found/i.test(msg);
}

async function loadShiftStoreHydrated(): Promise<ShiftStoreData> {
  const local = readShiftStore();
  const [oracleShiftRows, oracleReqRows] = await Promise.all([
    fetchOrdsItems<Record<string, unknown>>('doctor-shifts').catch((err) => {
      if (!isMissingOracleEndpointError(err)) {
        // Fallback safely to local cache on transient read errors
      }
      return null;
    }),
    fetchOrdsItems<Record<string, unknown>>('shift-change-requests').catch((err) => {
      if (!isMissingOracleEndpointError(err)) {
        // Fallback safely to local cache on transient read errors
      }
      return null;
    }),
  ]);

  const parsedShifts = (oracleShiftRows || [])
    .map(parseOracleDoctorShiftRow)
    .filter((s): s is DoctorShiftConfig => Boolean(s));
  const parsedReqs = (oracleReqRows || [])
    .map(parseOracleShiftChangeRequestRow)
    .filter((r): r is ShiftChangeRequest => Boolean(r));

  return {
    ...local,
    shifts: parsedShifts.length > 0 ? mergeShiftMaps(parsedShifts, local.shifts) : local.shifts,
    change_requests:
      parsedReqs.length > 0
        ? mergeByIdWithOraclePriority(
            parsedReqs,
            local.change_requests,
            (r) => r.request_id,
            (r) => r.requested_on,
          )
        : local.change_requests,
  };
}

async function syncDoctorShiftToOracle(shift: DoctorShiftConfig): Promise<void> {
  try {
    const resp = await fetchOrdsJson<{ status?: string; message?: string }>('doctor-shifts', {
      method: 'POST',
      body: JSON.stringify(serializeDoctorShiftForOracle(shift)),
    });
    if (resp?.status === 'error') {
      throw new Error(resp.message || 'Oracle rejected doctor shift update');
    }
  } catch (err) {
    if (isMissingOracleEndpointError(err)) return;
    throw err;
  }
}

async function syncShiftChangeRequestToOracle(reqItem: ShiftChangeRequest): Promise<void> {
  try {
    const resp = await fetchOrdsJson<{ status?: string; message?: string }>('shift-change-requests', {
      method: 'POST',
      body: JSON.stringify(serializeShiftChangeRequestForOracle(reqItem)),
    });
    if (resp?.status === 'error') {
      throw new Error(resp.message || 'Oracle rejected shift change request');
    }
  } catch (err) {
    if (isMissingOracleEndpointError(err)) return;
    throw err;
  }
}

async function syncShiftChangeDecisionToOracle(
  requestId: string,
  decision: 'APPROVED' | 'REJECTED',
  decidedBy: string,
  comments: string | null,
): Promise<void> {
  try {
    const resp = await fetchOrdsJson<{ status?: string; message?: string }>(
      `shift-change-requests/${encodeURIComponent(requestId)}/decide`,
      {
        method: 'POST',
        body: JSON.stringify({
          decision,
          decided_by: decidedBy,
          comments,
        }),
      },
    );
    if (resp?.status === 'error') {
      if (/not found/i.test(resp.message || '')) return;
      throw new Error(resp.message || 'Oracle rejected shift change decision');
    }
  } catch (err) {
    if (isMissingOracleEndpointError(err)) return;
    throw err;
  }
}

async function loadMedicalRecordsHydrated(): Promise<MedicalRecordEntry[]> {
  const local = readClinicalStore().medical_records;
  try {
    const rows = await fetchOrdsItems<Record<string, unknown>>('medical-records');
    const parsed = rows
      .map(parseOracleMedicalRecordRow)
      .filter((r): r is MedicalRecordEntry => Boolean(r));
    return parsed;
  } catch (err) {
    if (isMissingOracleEndpointError(err)) return local;
    return local;
  }
}

async function loadPrescriptionsHydrated(): Promise<PrescriptionEntry[]> {
  const local = readClinicalStore().prescriptions;
  try {
    const rows = await fetchOrdsItems<Record<string, unknown>>('prescriptions');
    const parsed = rows
      .map(parseOraclePrescriptionRow)
      .filter((p): p is PrescriptionEntry => Boolean(p));
    return parsed;
  } catch (err) {
    if (isMissingOracleEndpointError(err)) return local;
    return local;
  }
}

async function startServer() {
  registerExternalAuditLogSink(syncAuditLogToOracleDirect);
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', (req, res, next) => {
    const headerMode = parseBackendMode(req.header('X-Backend-Mode'));
    const activeMode = headerMode
      ? normalizeBackendMode(headerMode, OIC_CONFIGURED, backendState.mode)
      : backendState.mode;
    const ctx: RequestRoutingContext = {
      mode: activeMode,
      servedBy: null,
      integrationName: null,
      res,
    };
    const origJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      if (!res.headersSent) {
        res.setHeader('X-Served-By', ctx.servedBy || 'ORDS');
        if (ctx.integrationName) {
          res.setHeader('X-OIC-Integration', ctx.integrationName);
        }
      }
      return origJson(body);
    }) as Response['json'];
    requestRoutingStorage.run(ctx, () => next());
  });

  app.get('/api/health', async (_req, res) => {
    try {
      const depts = await fetchOrdsItems<Department>('departments/');
      res.json({ ok: true, ords_reachable: true, departments_count: depts.length });
    } catch (err) {
      res.status(502).json({
        ok: false,
        ords_reachable: false,
        message: err instanceof Error ? err.message : 'Unable to reach ORDS',
      });
    }
  });

  app.get('/api/auth/security-policy', (_req, res) => {
    const store = readRbacStore();
    res.json({
      status: 'success',
      allow_patient_registration: store.security_settings.allow_patient_registration,
      min_password_length: store.security_settings.min_password_length,
      enforce_strict_role_portal: store.security_settings.enforce_strict_role_portal,
    });
  });

  app.post('/api/auth/patient/forgot-password', async (req, res) => {
    const emailInput = String(req.body?.email || '').trim().toLowerCase();
    const phoneInput = normalizePhoneDigits(req.body?.phone_number);
    const newPassword = String(req.body?.new_password || '');
    const confirmPassword = String(req.body?.confirm_password || '');
    const store = readRbacStore();
    const minLen = Math.max(6, Number(store.security_settings.min_password_length || 6));

    if (!emailInput || !phoneInput || !newPassword || !confirmPassword) {
      res.status(400).json({
        status: 'error',
        message: 'Email ID, registered phone number, and new password are required.',
      });
      return;
    }

    if (newPassword.length < minLen) {
      res.status(400).json({
        status: 'error',
        message: `New password must be at least ${minLen} characters.`,
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      res.status(400).json({
        status: 'error',
        message: 'New password and confirmation password do not match.',
      });
      return;
    }

    if (
      emailInput === SINGLE_ADMIN_EMAIL.toLowerCase() ||
      emailInput === SUPER_ADMIN_EMAIL.toLowerCase()
    ) {
      recordRbacAuditLog({
        actor_user_id: null,
        actor_name: emailInput,
        actor_email: emailInput,
        actor_role: 'PUBLIC',
        target_label: emailInput,
        action: 'PASSWORD_SELF_RESET_BLOCKED',
        category: 'SECURITY',
        details: `Blocked patient self-service password reset attempt for protected administrator email ${emailInput}.`,
        severity: 'warning',
      });
      res.status(403).json({
        status: 'error',
        message: 'Password reset is only available for Patient accounts.',
      });
      return;
    }

    try {
      const [users, patients] = await Promise.all([
        fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]),
        fetchOrdsItems<Patient>('patients').catch(() => [] as Patient[]),
      ]);

      const nonPatientUser = users.find(
        (u) =>
          (u.email || '').trim().toLowerCase() === emailInput &&
          u.role_name &&
          u.role_name !== 'PATIENT',
      );
      if (
        nonPatientUser ||
        BRIDGE_ACCOUNTS.some((b) => b.email.toLowerCase() === emailInput && b.role !== 'PATIENT') ||
        store.managed_users.some((m) => m.email.toLowerCase() === emailInput && m.role !== 'PATIENT')
      ) {
        recordRbacAuditLog({
          actor_user_id: nonPatientUser?.user_id ?? null,
          actor_name: nonPatientUser?.full_name || emailInput,
          actor_email: emailInput,
          actor_role: nonPatientUser?.role_name || 'STAFF',
          target_label: emailInput,
          action: 'PASSWORD_SELF_RESET_BLOCKED',
          category: 'SECURITY',
          details: `Blocked patient self-service password reset attempt for non-patient account ${emailInput}.`,
          severity: 'warning',
        });
        res.status(403).json({
          status: 'error',
          message: 'Password self-reset is only permitted for Patient accounts.',
        });
        return;
      }

      const matchedPatient = patients.find(
        (p) =>
          (p.email || '').trim().toLowerCase() === emailInput &&
          normalizePhoneDigits(p.phone_number) === phoneInput,
      );

      if (!matchedPatient) {
        recordRbacAuditLog({
          actor_user_id: null,
          actor_name: emailInput,
          actor_email: emailInput,
          actor_role: 'PATIENT',
          target_label: emailInput,
          action: 'PASSWORD_SELF_RESET_FAILED',
          category: 'AUTH',
          details: `Patient self-reset failed: no patient matched email ${emailInput} with provided registered phone.`,
          severity: 'warning',
        });
        res.status(400).json({
          status: 'error',
          message: 'No patient record matches that email ID and registered phone number.',
        });
        return;
      }

      writePatientPasswordOverride(emailInput, newPassword);
      const updatedStore = readRbacStore();
      updatedStore.password_overrides[emailInput] = hashPasswordScrypt(newPassword);
      writeRbacStore(updatedStore);
      recordRbacAuditLog({
        actor_user_id: matchedPatient.patient_id,
        actor_name: `${matchedPatient.first_name} ${matchedPatient.last_name}`,
        actor_email: emailInput,
        actor_role: 'PATIENT',
        target_label: emailInput,
        action: 'PASSWORD_SELF_RESET',
        category: 'AUTH',
        details: 'Patient verified email + registered phone and updated password.',
        severity: 'info',
      });

      res.json({
        status: 'success',
        message: 'Password updated successfully. Please sign in with your new password.',
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to reset password',
      });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const emailInput = String(req.body?.email || req.body?.identifier || '').trim().toLowerCase();
    const fullNameInput = String(req.body?.full_name || '').trim();
    const password = String(req.body?.password || '');
    const expectedRoleRaw = String(req.body?.expected_role || '').trim().toUpperCase();
    const expectedRole = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'].includes(
      expectedRoleRaw,
    )
      ? (expectedRoleRaw as RoleName)
      : undefined;

    if (!emailInput || !fullNameInput || !password) {
      res.status(400).json({
        status: 'error',
        message: 'Full name, email ID, and password are required to sign in.',
      });
      return;
    }

    const store = readRbacStore();
    const strictPortal = store.security_settings.enforce_strict_role_portal;

    const lockout = checkLoginLockout(emailInput);
    if (lockout.locked) {
      recordRbacAuditLog({
        actor_user_id: null,
        actor_name: fullNameInput || emailInput,
        actor_email: emailInput,
        actor_role: expectedRole || 'UNKNOWN',
        target_label: emailInput,
        action: 'LOGIN_LOCKED_OUT',
        category: 'SECURITY',
        details: `Blocked login attempt while account locked (${lockout.retryAfterMinutes} min remaining).`,
        severity: 'warning',
      });
      res.status(429).json({
        status: 'error',
        message: `Too many failed sign-in attempts. Please wait ${lockout.retryAfterMinutes} minute(s) before retrying.`,
      });
      return;
    }

    // Never permit legacy fake admin emails
    if (isDisallowedLegacyFakeAdmin(emailInput, fullNameInput)) {
      recordRbacAuditLog({
        actor_user_id: null,
        actor_name: fullNameInput || emailInput,
        actor_email: emailInput,
        actor_role: expectedRole || 'ADMIN',
        target_label: emailInput,
        action: 'LOGIN_BLOCKED_ADMIN_RESTRICTION',
        category: 'SECURITY',
        details: `Blocked disallowed legacy admin login attempt (${emailInput}).`,
        severity: 'warning',
      });
      res.status(403).json({
        status: 'error',
        message: `Restricted system administrator account (${SINGLE_ADMIN_EMAIL}) required for Admin access.`,
      });
      return;
    }

    const finalizeAndRespond = (rawUser: AuthUser): boolean => {
      const hydrated = hydrateAuthUserFromStore(rawUser);
      if (!hydrated.user) {
        const blockedStatus = hydrated.blockedStatus || 'INACTIVE';
        recordRbacAuditLog({
          actor_user_id: rawUser.user_id,
          actor_name: rawUser.full_name,
          actor_email: rawUser.email,
          actor_role: rawUser.role,
          target_label: rawUser.email,
          action: 'LOGIN_BLOCKED_STATUS',
          category: 'SECURITY',
          new_value: blockedStatus,
          details: `Denied login for ${rawUser.email}: account status is ${blockedStatus}.`,
          severity: 'warning',
        });
        res.status(403).json({
          status: 'error',
          message: `This account is currently ${blockedStatus.toLowerCase()}. Please contact the Super Admin.`,
        });
        return true;
      }

      if (strictPortal && expectedRole && hydrated.user.role !== expectedRole) {
        recordRbacAuditLog({
          actor_user_id: hydrated.user.user_id,
          actor_name: hydrated.user.full_name,
          actor_email: hydrated.user.email,
          actor_role: hydrated.user.role,
          target_label: hydrated.user.email,
          action: 'LOGIN_BLOCKED_PORTAL_MISMATCH',
          category: 'SECURITY',
          previous_value: `Expected:${expectedRole}`,
          new_value: `Actual:${hydrated.user.role}`,
          details: `Blocked strict-portal sign-in for ${hydrated.user.email}: selected ${expectedRole}, account role is ${hydrated.user.role}.`,
          severity: 'warning',
        });
        res.status(403).json({
          status: 'error',
          message: `This account is registered as ${ROLE_LABELS[hydrated.user.role]}. Please go back and select ${ROLE_LABELS[hydrated.user.role]} to sign in.`,
        });
        return true;
      }

      clearFailedLoginAttempts(emailInput);
      recordRbacAuditLog({
        actor_user_id: hydrated.user.user_id,
        actor_name: hydrated.user.full_name,
        actor_email: hydrated.user.email,
        actor_role: hydrated.user.role,
        target_label: hydrated.user.email,
        action: 'LOGIN_SUCCESS',
        category: 'AUTH',
        details: `Signed in via ${hydrated.user.auth_mode || 'system'} portal.`,
        severity: 'info',
      });

      const token = signSession(hydrated.user);
      setSessionCookie(req, res, token);
      res.json({ status: 'success', user: hydrated.user, token });
      return true;
    };

    const failLogin = (statusCode: number, message: string) => {
      const failure = recordFailedLoginAttempt(emailInput);
      recordRbacAuditLog({
        actor_user_id: null,
        actor_name: fullNameInput || emailInput,
        actor_email: emailInput,
        actor_role: expectedRole || 'UNKNOWN',
        target_label: emailInput,
        action: 'LOGIN_FAILED',
        category: 'SECURITY',
        details: `${message}${failure.lockedNow ? ' (Account locked out)' : ''}`,
        severity: failure.lockedNow ? 'critical' : 'warning',
      });
      res.status(statusCode).json({
        status: 'error',
        message: failure.lockedNow
          ? `Too many failed attempts. Account temporarily locked for ${store.security_settings.lockout_minutes} minutes.`
          : message,
      });
    };

    // 0A. Immutable Super Admin login (Karan Tulsani)
    if (
      emailInput === SUPER_ADMIN_EMAIL.toLowerCase() ||
      emailInput === SUPER_ADMIN_USERNAME.toLowerCase()
    ) {
      if (!doesLoginNameMatch(fullNameInput, SUPER_ADMIN_NAME, 'SUPER_ADMIN')) {
        failLogin(401, 'Entered full name does not match the registered Super Admin.');
        return;
      }
      if (!verifyPasswordScrypt(password, store.super_admin_password_hash)) {
        failLogin(401, 'Invalid full name, email ID, or password.');
        return;
      }
      finalizeAndRespond({
        user_id: SUPER_ADMIN_USER_ID,
        username: SUPER_ADMIN_USERNAME,
        email: SUPER_ADMIN_EMAIL,
        full_name: SUPER_ADMIN_NAME,
        role: 'SUPER_ADMIN',
        roles: ['SUPER_ADMIN'],
        status: 'ACTIVE',
        permissions: [...ALL_CANONICAL_PERMISSIONS],
        auth_mode: 'system',
      });
      return;
    }

    // 0B. Managed Staff Accounts created by Super Admin / Admin in RBAC Store
    const managedMatch = store.managed_users.find(
      (m) => m.email.toLowerCase() === emailInput || m.username.toLowerCase() === emailInput,
    );
    if (managedMatch) {
      if (!doesLoginNameMatch(fullNameInput, managedMatch.full_name, managedMatch.role)) {
        failLogin(401, 'Entered full name does not match the registered account.');
        return;
      }
      const pwHash = store.password_overrides[managedMatch.email.toLowerCase()] || managedMatch.password_hash;
      if (!verifyPasswordScrypt(password, pwHash)) {
        failLogin(401, 'Invalid full name, email ID, or password.');
        return;
      }
      let doctorId = managedMatch.doctor_id ?? null;
      let departmentId: number | null = null;
      let departmentName: string | null = null;
      let specialization: string | null = null;
      if (managedMatch.role === 'DOCTOR') {
        try {
          const [doctors, departments] = await Promise.all([
            fetchOrdsItems<Doctor>('doctors'),
            fetchOrdsItems<Department>('departments/'),
          ]);
          const doc =
            (doctorId ? doctors.find((d) => d.doctor_id === doctorId) : undefined) ||
            doctors.find((d) =>
              doesLoginNameMatch(
                managedMatch.full_name,
                `Dr. ${d.first_name} ${d.last_name}`,
                'DOCTOR',
              ),
            );
          if (doc) {
            doctorId = doc.doctor_id;
            departmentId = doc.department_id;
            specialization = doc.specialization ?? null;
            departmentName =
              departments.find((dp) => dp.department_id === doc.department_id)?.department_name ?? null;
          }
        } catch {
          // Non-fatal
        }
      }
      finalizeAndRespond({
        user_id: managedMatch.user_id,
        username: managedMatch.username,
        email: managedMatch.email,
        full_name: managedMatch.full_name,
        phone_number: managedMatch.phone_number ?? null,
        role: managedMatch.role,
        roles: [managedMatch.role],
        permissions: computeEffectivePermissions(managedMatch.role, store.role_matrix),
        doctor_id: doctorId,
        patient_id: managedMatch.patient_id ?? null,
        department_id: departmentId,
        department_name: departmentName,
        specialization,
        auth_mode: 'managed',
      });
      return;
    }

    // 0C. Password overrides (Super Admin resets + Patient Forgot Password)
    const pwOverrides = { ...readPatientPasswordOverrides(), ...store.password_overrides };
    if (pwOverrides[emailInput]) {
      if (!verifyPasswordScrypt(password, pwOverrides[emailInput])) {
        failLogin(401, 'Invalid full name, email ID, or password.');
        return;
      }
      try {
        const [patients, users, doctors, departments] = await Promise.all([
          fetchOrdsItems<Patient>('patients').catch(() => [] as Patient[]),
          fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]),
          fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
          fetchOrdsItems<Department>('departments/').catch(() => [] as Department[]),
        ]);
        const directory = buildUnifiedUsersDirectory(users, BRIDGE_ACCOUNTS, doctors);
        const dirMatch = directory.find((u) => u.email.toLowerCase() === emailInput);
        const pat = patients.find((p) => (p.email || '').trim().toLowerCase() === emailInput);
        const resolvedRole: RoleName = dirMatch?.role || 'PATIENT';
        const resolvedName =
          dirMatch?.full_name || (pat ? `${pat.first_name} ${pat.last_name}` : '');
        if (!resolvedName || !doesLoginNameMatch(fullNameInput, resolvedName, resolvedRole)) {
          failLogin(401, 'Entered name does not match the account registered for this email ID.');
          return;
        }
        let docId = dirMatch?.doctor_id ?? null;
        let deptId: number | null = null;
        let deptName: string | null = null;
        let spec: string | null = null;
        if (resolvedRole === 'DOCTOR' && docId) {
          const d = doctors.find((item) => item.doctor_id === docId);
          if (d) {
            deptId = d.department_id;
            spec = d.specialization ?? null;
            deptName = departments.find((dp) => dp.department_id === d.department_id)?.department_name ?? null;
          }
        }
        finalizeAndRespond({
          user_id: dirMatch?.user_id ?? (pat ? 2000 + pat.patient_id : Date.now()),
          username: dirMatch?.username || emailInput,
          email: emailInput,
          full_name: resolvedName,
          role: resolvedRole,
          roles: [resolvedRole],
          permissions: [],
          patient_id: dirMatch?.patient_id ?? pat?.patient_id ?? null,
          doctor_id: docId,
          department_id: deptId,
          department_name: deptName,
          specialization: spec,
          auth_mode: 'ords',
        });
        return;
      } catch {
        // Fall through if lookup fails
      }
    }

    // 1. Prefer Oracle ORDS /auth/login
    let ordsUnavailableOrNotFound = false;
    try {
      const ordsAuth = await fetchOrdsJson<Record<string, unknown>>('auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: emailInput,
          email: emailInput,
          full_name: fullNameInput,
          password,
        }),
      });
      const authStatus = String(ordsAuth.status || '').trim().toLowerCase();
      const rawUpstreamUser =
        (ordsAuth.user as AuthUser | undefined) ||
        (Array.isArray(ordsAuth.items) ? (ordsAuth.items[0] as AuthUser | undefined) : undefined) ||
        (ordsAuth.user_id || ordsAuth.email ? (ordsAuth as unknown as AuthUser) : undefined);

      if ((authStatus === 'success' || (!authStatus && Boolean(rawUpstreamUser))) && rawUpstreamUser) {
        const rawDocId = rawUpstreamUser.doctor_id;
        const rawPatId = rawUpstreamUser.patient_id;
        const candidate: AuthUser = {
          ...rawUpstreamUser,
          doctor_id:
            rawDocId !== undefined && rawDocId !== null && String(rawDocId).trim() !== ''
              ? Number(rawDocId) || null
              : null,
          patient_id:
            rawPatId !== undefined && rawPatId !== null && String(rawPatId).trim() !== ''
              ? Number(rawPatId) || null
              : null,
          auth_mode: 'ords',
        };

        const resolvedViaOverride = Boolean(
          store.user_role_overrides[normalizeUserKey(candidate.email, candidate.user_id)],
        );
        if (candidate.role === 'ADMIN' && !isSingleAdminUser(candidate) && !resolvedViaOverride) {
          recordRbacAuditLog({
            actor_user_id: candidate.user_id,
            actor_name: candidate.full_name,
            actor_email: candidate.email,
            actor_role: candidate.role,
            target_label: candidate.email,
            action: 'LOGIN_BLOCKED_ADMIN_RESTRICTION',
            category: 'SECURITY',
            details: `Blocked unrecognized ORDS ADMIN account (${candidate.email}).`,
            severity: 'warning',
          });
          res.status(403).json({
            status: 'error',
            message: `Unrecognized Administrator account. Only authorized Hospital Admins may sign in.`,
          });
          return;
        }

        if (!doesLoginNameMatch(fullNameInput, candidate.full_name, candidate.role)) {
          failLogin(401, 'Entered name does not match the account registered for this email ID.');
          return;
        }

        if (candidate.role === 'DOCTOR') {
          try {
            const [doctors, departments] = await Promise.all([
              fetchOrdsItems<Doctor>('doctors'),
              fetchOrdsItems<Department>('departments/'),
            ]);
            const byId = candidate.doctor_id
              ? doctors.find((d) => d.doctor_id === candidate.doctor_id)
              : undefined;
            const exactDoc =
              byId ||
              doctors.find((d) =>
                doesLoginNameMatch(
                  candidate.full_name,
                  `Dr. ${d.first_name} ${d.last_name}`,
                  'DOCTOR',
                ),
              );
            if (exactDoc) {
              candidate.doctor_id = exactDoc.doctor_id;
              candidate.department_id = exactDoc.department_id;
              candidate.specialization = exactDoc.specialization ?? null;
              const dept = departments.find((d) => d.department_id === exactDoc.department_id);
              candidate.department_name = dept?.department_name ?? null;
            }
          } catch {
            // Keep ORDS doctor_id if lookup temporarily fails
          }
        } else if (candidate.role === 'PATIENT' && !candidate.patient_id) {
          try {
            const patients = await fetchOrdsItems<Patient>('patients');
            const pat =
              patients.find((p) => (p.email || '').trim().toLowerCase() === emailInput) ||
              patients.find((p) =>
                doesLoginNameMatch(
                  candidate.full_name,
                  `${p.first_name} ${p.last_name}`,
                  'PATIENT',
                ),
              );
            if (pat) {
              candidate.patient_id = pat.patient_id;
            }
          } catch {
            // Keep base identity if lookup fails
          }
        }

        finalizeAndRespond(candidate);
        return;
      }
      if (authStatus === 'error') {
        const msg = String(ordsAuth.message || '').toLowerCase();
        if (
          msg.includes('invalid email') ||
          msg.includes('no account found') ||
          msg.includes('not found')
        ) {
          ordsUnavailableOrNotFound = true;
        } else {
          failLogin(401, String(ordsAuth.message || 'Invalid credentials'));
          return;
        }
      }
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      const errMsg = ((err as Error).message || '').toLowerCase();
      if (
        !statusCode ||
        statusCode === 404 ||
        statusCode === 405 ||
        errMsg.includes('invalid email') ||
        errMsg.includes('no account found') ||
        errMsg.includes('not found')
      ) {
        ordsUnavailableOrNotFound = true;
      } else {
        failLogin(401, (err as Error).message);
        return;
      }
    }

    // 2. Fallback / Bridge identity resolution tied to real Oracle records
    let matched = BRIDGE_ACCOUNTS.find(
      (acct) =>
        (acct.email.toLowerCase() === emailInput || acct.username.toLowerCase() === emailInput) &&
        doesLoginNameMatch(fullNameInput, acct.full_name, acct.role) &&
        acct.password === password,
    );

    let resolvedDoctor: Doctor | undefined;
    let resolvedPatient: Patient | undefined;

    if (!matched && ordsUnavailableOrNotFound) {
      try {
        const [doctors, patients] = await Promise.all([
          fetchOrdsItems<Doctor>('doctors'),
          fetchOrdsItems<Patient>('patients'),
        ]);

        if (password === (process.env.DEMO_DOCTOR_PASSWORD || 'Doctor@123')) {
          resolvedDoctor = doctors.find((d) => {
            const docFull = `Dr. ${d.first_name} ${d.last_name}`;
            const slug = `${d.first_name}.${d.last_name}`.toLowerCase().replace(/[^a-z0-9]+/g, '.');
            const emailMatch =
              emailInput === `${slug}@hospital.com` ||
              emailInput === `${slug}.${d.doctor_id}@hospital.com` ||
              (d.doctor_id === 2 && emailInput === 'priya@hospital.com');
            return emailMatch && doesLoginNameMatch(fullNameInput, docFull, 'DOCTOR');
          });
          if (resolvedDoctor) {
            matched = {
              user_id: 3000 + resolvedDoctor.doctor_id,
              username: emailInput,
              email: emailInput,
              password,
              full_name: `Dr. ${resolvedDoctor.first_name} ${resolvedDoctor.last_name}`,
              role: 'DOCTOR',
              doctor_id: resolvedDoctor.doctor_id,
            };
          }
        }

        if (!matched && password === (process.env.DEMO_PATIENT_PASSWORD || 'Patient@123')) {
          resolvedPatient = patients.find((p) => {
            const pEmail = (p.email || '').trim().toLowerCase();
            const pName = `${p.first_name} ${p.last_name}`;
            return pEmail === emailInput && doesLoginNameMatch(fullNameInput, pName, 'PATIENT');
          });
          if (resolvedPatient) {
            matched = {
              user_id: 2000 + resolvedPatient.patient_id,
              username: emailInput,
              email: emailInput,
              password,
              full_name: `${resolvedPatient.first_name} ${resolvedPatient.last_name}`,
              role: 'PATIENT',
              patient_id: resolvedPatient.patient_id,
            };
          }
        }
      } catch {
        // Ignore lookup error
      }
    }

    if (!matched) {
      failLogin(401, 'Invalid full name, email ID, or password.');
      return;
    }

    let doctorId: number | null = matched.doctor_id ?? null;
    let patientId: number | null = matched.patient_id ?? null;
    let departmentId: number | null = null;
    let departmentName: string | null = null;
    let specialization: string | null = null;
    let fullName = matched.full_name;

    try {
      if (matched.role === 'DOCTOR') {
        const [doctors, departments] = await Promise.all([
          fetchOrdsItems<Doctor>('doctors'),
          fetchOrdsItems<Department>('departments/'),
        ]);
        const doc =
          resolvedDoctor ||
          (doctorId ? doctors.find((d) => d.doctor_id === doctorId) : undefined) ||
          doctors.find((d) =>
            doesLoginNameMatch(fullName, `Dr. ${d.first_name} ${d.last_name}`, 'DOCTOR'),
          );
        if (doc) {
          doctorId = doc.doctor_id;
          departmentId = doc.department_id;
          specialization = doc.specialization ?? null;
          fullName = `Dr. ${doc.first_name} ${doc.last_name}`;
          const dept = departments.find((d) => d.department_id === doc.department_id);
          departmentName = dept?.department_name ?? null;
        }
      } else if (matched.role === 'PATIENT') {
        const patients = await fetchOrdsItems<Patient>('patients');
        const pat =
          resolvedPatient ||
          (patientId ? patients.find((p) => p.patient_id === patientId) : undefined) ||
          patients.find((p) => (p.email || '').toLowerCase() === emailInput);
        if (pat) {
          patientId = pat.patient_id;
          fullName = `${pat.first_name} ${pat.last_name}`;
        }
      }
    } catch {
      // Keep base identity if lookup fails
    }

    const user: AuthUser = {
      user_id: matched.user_id,
      username: matched.username,
      email: matched.email,
      full_name: fullName,
      role: matched.role,
      roles: [matched.role],
      permissions: computeEffectivePermissions(matched.role, store.role_matrix),
      doctor_id: doctorId,
      patient_id: patientId,
      department_id: departmentId,
      department_name: departmentName,
      specialization,
      auth_mode: 'bridge',
    };

    if (user.role === 'ADMIN' && !isSingleAdminUser(user)) {
      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: user.email,
        action: 'LOGIN_BLOCKED_ADMIN_RESTRICTION',
        category: 'SECURITY',
        details: `Blocked unrecognized bridge ADMIN account (${user.email}).`,
        severity: 'warning',
      });
      res.status(403).json({
        status: 'error',
        message: `Unrecognized Administrator account. Only authorized Hospital Admins may sign in.`,
      });
      return;
    }

    finalizeAndRespond(user);
  });

  app.post('/api/auth/register', async (req, res) => {
    const store = readRbacStore();
    if (!store.security_settings.allow_patient_registration) {
      const regEmail = String(req.body?.email || '').trim().toLowerCase() || 'anonymous';
      recordRbacAuditLog({
        actor_user_id: null,
        actor_name: regEmail,
        actor_email: regEmail,
        actor_role: 'PATIENT',
        target_label: regEmail,
        action: 'USER_REGISTRATION_BLOCKED',
        category: 'SECURITY',
        details: 'Blocked public patient registration while disabled in Security Settings.',
        severity: 'warning',
      });
      res.status(403).json({
        status: 'error',
        message: 'Public patient registration is currently disabled by Security Settings.',
      });
      return;
    }

    const minLen = Math.max(6, Number(store.security_settings.min_password_length || 6));
    const first_name = String(req.body?.first_name || '').trim();
    const last_name = String(req.body?.last_name || '').trim();
    const phone_number = String(req.body?.phone_number || '').trim();
    const email = String(req.body?.email || '').trim();
    const city = normalizeRegionText(req.body?.city);
    const locality = normalizeRegionText(req.body?.locality);
    const date_of_birth = String(req.body?.date_of_birth || '').trim();
    const gender = String(req.body?.gender || '').trim().toUpperCase();
    const blood_group = String(req.body?.blood_group || '').trim();
    const password = String(req.body?.password || '');

    if (!first_name || !last_name || !phone_number || !email || !city || !locality || !password) {
      res.status(400).json({
        status: 'error',
        message: 'First name, last name, phone number, email, city, locality, and password are required',
      });
      return;
    }

    if (password.length < minLen) {
      res.status(400).json({
        status: 'error',
        message: `Password must be at least ${minLen} characters`,
      });
      return;
    }

    if (gender && !['MALE', 'FEMALE', 'OTHER'].includes(gender)) {
      res.status(400).json({ status: 'error', message: 'Gender must be MALE, FEMALE, or OTHER' });
      return;
    }

    const finishRegister = (rawUser: AuthUser, statusCode: number, message?: string) => {
      const hydrated = hydrateAuthUserFromStore(rawUser).user || rawUser;
      recordRbacAuditLog({
        actor_user_id: hydrated.user_id,
        actor_name: hydrated.full_name,
        actor_email: hydrated.email,
        actor_role: 'PATIENT',
        target_user_id: hydrated.user_id,
        target_label: hydrated.email,
        action: 'USER_REGISTERED',
        category: 'AUTH',
        new_value: `PATIENT:ACTIVE${hydrated.patient_id ? ` (Patient #${hydrated.patient_id})` : ''}`,
        details: `Self-registered patient account ${hydrated.full_name} (${city}, ${locality}).`,
        severity: 'info',
      });
      const token = signSession(hydrated);
      setSessionCookie(req, res, token);
      res.status(statusCode).json({
        status: 'success',
        ...(message ? { message } : {}),
        user: hydrated,
        token,
      });
    };

    try {
      const ordsReg = await fetchOrdsJson<Record<string, unknown>>('auth/register', {
        method: 'POST',
        body: JSON.stringify({
          first_name,
          last_name,
          phone_number,
          email,
          city,
          locality,
          date_of_birth: date_of_birth || null,
          gender: gender || null,
          blood_group: blood_group || null,
          password,
        }),
      });
      const regStatus = String(ordsReg.status || '').trim().toLowerCase();
      const regUserRaw =
        (ordsReg.user as AuthUser | undefined) ||
        (Array.isArray(ordsReg.items) ? (ordsReg.items[0] as AuthUser | undefined) : undefined);

      if (regStatus === 'success' || (!regStatus && Boolean(regUserRaw))) {
        const resolvedBaseUser: AuthUser = regUserRaw
          ? { ...regUserRaw, auth_mode: 'ords' }
          : {
              user_id: Number(ordsReg.user_id || ordsReg.patient_id || Date.now()),
              username: email.toLowerCase(),
              email: email.toLowerCase(),
              full_name: `${first_name} ${last_name}`,
              phone_number,
              role: 'PATIENT',
              roles: ['PATIENT'],
              permissions: computeEffectivePermissions('PATIENT', store.role_matrix),
              patient_id: ordsReg.patient_id ? Number(ordsReg.patient_id) : null,
              doctor_id: null,
              auth_mode: 'ords',
            };
        let resolvedPatientId = resolvedBaseUser.patient_id ?? null;
        if (!resolvedPatientId) {
          const matches = await fetchOrdsItems<Patient>(
            `patients?phone=${encodeURIComponent(phone_number)}`,
          ).catch(() => [] as Patient[]);
          resolvedPatientId = matches[0]?.patient_id ?? null;
          if (resolvedPatientId) resolvedBaseUser.patient_id = resolvedPatientId;
        }
        if (resolvedPatientId) {
          savePatientRegion(resolvedPatientId, city, locality);
        }
        finishRegister(resolvedBaseUser, 201);
        return;
      }
      if (regStatus === 'error') {
        res.status(400).json({ status: 'error', message: normalizeOrdsError(ordsReg) });
        return;
      }
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      if (statusCode && statusCode !== 404 && statusCode !== 405) {
        res.status(400).json({ status: 'error', message: (err as Error).message });
        return;
      }
    }

    try {
      const createRes = await fetchOrdsJson<{ status?: string; message?: string }>('patients', {
        method: 'POST',
        body: JSON.stringify({
          first_name,
          last_name,
          phone_number,
          email,
          date_of_birth: date_of_birth || null,
          gender: gender || null,
          blood_group: blood_group || null,
        }),
      });

      if (createRes.status === 'error') {
        res.status(400).json({
          status: 'error',
          message: normalizeOrdsError(createRes, 'Could not register patient'),
        });
        return;
      }

      const matches = await fetchOrdsItems<Patient>(
        `patients?phone=${encodeURIComponent(phone_number)}`,
      );
      const created = matches[0];
      if (created?.patient_id) {
        savePatientRegion(created.patient_id, city, locality);
      }

      const user: AuthUser = {
        user_id: created?.patient_id ? 2000 + created.patient_id : Date.now(),
        username: email.toLowerCase(),
        email: email.toLowerCase(),
        full_name: `${first_name} ${last_name}`,
        phone_number,
        role: 'PATIENT',
        roles: ['PATIENT'],
        permissions: computeEffectivePermissions('PATIENT', store.role_matrix),
        patient_id: created?.patient_id ?? null,
        doctor_id: null,
        auth_mode: 'bridge',
      };

      finishRegister(user, 201, 'Patient registered in Oracle database');
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Patient registration failed',
      });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    const rawUser = verifySession(getRequestToken(req));
    if (!rawUser) {
      res.json({ status: 'unauthenticated', user: null });
      return;
    }
    const hydrated = hydrateAuthUserFromStore(rawUser);
    if (!hydrated.user) {
      clearSessionCookie(req, res);
      res.json({ status: 'unauthenticated', user: null });
      return;
    }
    res.json({ status: 'success', user: hydrated.user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const rawUser = verifySession(getRequestToken(req));
    if (rawUser) {
      recordRbacAuditLog({
        actor_user_id: rawUser.user_id,
        actor_name: rawUser.full_name,
        actor_email: rawUser.email,
        actor_role: rawUser.role,
        target_label: rawUser.email,
        action: 'LOGOUT',
        category: 'AUTH',
        details: `${rawUser.full_name} (${rawUser.role}) signed out cleanly.`,
        severity: 'info',
      });
    }
    clearSessionCookie(req, res);
    res.json({ status: 'success', message: 'Signed out' });
  });

  app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'DASHBOARD:VIEW', 'Dashboard Summary')) return;

    try {
      await ensureOverdueHoldsExpired();
      const [
        departments,
        doctors,
        patients,
        initialRawAppointments,
        initialRawSlots,
        templates,
        payments,
        tokenQueue,
        utilisation,
      ] = await Promise.all([
        fetchOrdsItems<Department>('departments/'),
        fetchOrdsItems<Doctor>('doctors'),
        user.role === 'PATIENT' ? Promise.resolve([] as Patient[]) : fetchOrdsItems<Patient>('patients'),
        fetchOrdsItems<Appointment>('appointments'),
        fetchOrdsItems<Slot>('slots'),
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Payment>('payments'),
        fetchOrdsItems<TokenQueueItem>('token_queue'),
        user.role === 'PATIENT'
          ? Promise.resolve([] as UtilisationReportRow[])
          : fetchOrdsItems<UtilisationReportRow>('reports/utilisation'),
      ]);

      let rawAppointments = initialRawAppointments;
      let rawSlots = initialRawSlots;
      if (await ensureOverdueHoldsExpired({ appointmentsHint: rawAppointments })) {
        [rawAppointments, rawSlots] = await Promise.all([
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Slot>('slots'),
        ]);
        trackNextHoldExpiry(rawAppointments);
      }

      const activeDeptIds = new Set(departments.map((d) => d.department_id));
      const missingDeptIds = Array.from(
        new Set(doctors.map((d) => d.department_id).filter((id) => !activeDeptIds.has(id))),
      );
      const extraDepts = (
        await Promise.all(
          missingDeptIds.map((id) =>
            fetchOrdsItems<Department>(`departments/${id}`)
              .then((items) => items[0] ?? null)
              .catch(() => null),
          ),
        )
      ).filter((d): d is Department => Boolean(d));
      const departmentsForJoin = [...departments, ...extraDepts];

      const shiftStore = await loadShiftStoreHydrated();
      const paymentsWithRefunds = attachRefundsToPayments(payments);
      const confirmedRawSlots = filterConfirmedSlots(rawSlots, templates, shiftStore);
      const rawSlotsWithDoctors = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const fullSlotsForApptJoin = enrichSlots(rawSlotsWithDoctors, templates, doctors, departmentsForJoin);
      const enrichedSlots = enrichSlots(confirmedRawSlots, templates, doctors, departmentsForJoin);
      const enrichedAppointments = enrichAppointments(
        attachConsultationMode(rawAppointments, paymentsWithRefunds),
        fullSlotsForApptJoin,
        doctors,
      );
      const todayIso = getServerTodayIso();

      let scopedAppointments = enrichedAppointments;
      let scopedSlots = enrichedSlots;
      let scopedPayments = hasEffectivePermission(user.permissions, user.role, 'PAYMENTS:VIEW')
        ? paymentsWithRefunds
        : [];
      let scopedTokens = tokenQueue;
      let scopedUtilisation = utilisation;
      let patientProfile: Patient | null = null;
      let doctorProfile: Doctor | null = null;
      let doctorTemplates: SlotTemplate[] = [];
      let doctorShift: DoctorShiftConfig | null = null;
      let allDoctorShifts: DoctorShiftConfig[] | undefined;
      let doctorAllSlots: Slot[] = [];
      let doctorLeaves: DoctorLeave[] = [];
      let doctorSlotsTodayCount: number | undefined;
      let doctorOnLeaveToday: boolean | undefined;
      let scopedPatientCount = patients.length;

      if (user.role === 'PATIENT') {
        scopedPatientCount = 1;
        scopedAppointments = enrichedAppointments.filter((a) => a.patient_id === user.patient_id);
        const apptIds = new Set(scopedAppointments.map((a) => a.appointment_id));
        scopedPayments = scopedPayments.filter((p) => apptIds.has(p.appointment_id));
        scopedTokens = tokenQueue.filter((t) => apptIds.has(t.appointment_id));
        scopedSlots = enrichedSlots.filter((s) => s.status === 'AVAILABLE').slice(0, 12);

        if (user.patient_id) {
          const allPatients = attachRegionsToPatients(await fetchOrdsItems<Patient>('patients'));
          patientProfile = allPatients.find((p) => p.patient_id === user.patient_id) || null;
        }
      } else if (user.role === 'DOCTOR') {
        doctorProfile = doctors.find((d) => d.doctor_id === user.doctor_id) || null;
        doctorTemplates = templates.filter((t) => t.doctor_id === user.doctor_id);
        scopedSlots = enrichedSlots.filter((s) => s.doctor_id === user.doctor_id);
        doctorAllSlots = scopedSlots;
        scopedAppointments = enrichedAppointments.filter((a) => a.doctor_id === user.doctor_id);
        const bookedPatientIds = new Set(scopedAppointments.map((a) => a.patient_id));
        scopedPatientCount = bookedPatientIds.size;
        const apptIds = new Set(scopedAppointments.map((a) => a.appointment_id));
        scopedTokens = tokenQueue.filter(
          (t) => apptIds.has(t.appointment_id) || t.department_id === user.department_id,
        );
        scopedPayments = [];
        doctorShift = user.doctor_id
          ? resolveDoctorShift(
              user.doctor_id,
              templates,
              doctorProfile
                ? `Dr. ${doctorProfile.first_name} ${doctorProfile.last_name}`
                : user.full_name,
              shiftStore,
            )
          : null;
        try {
          const allLeaves = await fetchOrdsItems<DoctorLeave>('leaves');
          doctorLeaves = allLeaves.filter((l) => l.doctor_id === user.doctor_id);
        } catch {
          doctorLeaves = [];
        }
        const localTodayIso = getServerTodayIso();
        doctorSlotsTodayCount = scopedSlots.filter(
          (s) => getIsoDatePart(s.slot_date) === localTodayIso && s.status !== 'CANCELLED',
        ).length;
        doctorOnLeaveToday = isDateCoveredByApprovedLeave(
          localTodayIso,
          doctorLeaves,
          user.doctor_id,
        );
        if (doctorProfile) {
          const fullDocName = `${doctorProfile.first_name} ${doctorProfile.last_name}`.toLowerCase();
          scopedUtilisation = utilisation.filter(
            (u) => u.doctor_name.toLowerCase() === fullDocName,
          );
        }
      } else {
        allDoctorShifts = doctors.map((d) =>
          resolveDoctorShift(
            d.doctor_id,
            templates,
            `Dr. ${d.first_name} ${d.last_name}`,
            shiftStore,
          ),
        );
        const todaysOrUpcoming = enrichedSlots.filter(
          (s) =>
            getIsoDatePart(s.slot_date) >= todayIso &&
            s.status === 'AVAILABLE' &&
            s.doctor_name &&
            !isSlotEndExpired(s.slot_date, s.start_time, s.end_time, new Date(), HOSPITAL_TIMEZONE),
        );
        const fallbackUpcoming = enrichedSlots.filter(
          (s) =>
            s.status !== 'CANCELLED' &&
            !isSlotEndExpired(s.slot_date, s.start_time, s.end_time, new Date(), HOSPITAL_TIMEZONE),
        );
        scopedSlots = (
          todaysOrUpcoming.length > 0 ? todaysOrUpcoming : fallbackUpcoming
        ).slice(0, 15);
      }

      const localTodayIso = getServerTodayIso();
      const todaysAppointments = scopedAppointments.filter(
        (a) => getIsoDatePart(a.slot_date || a.created_on) === localTodayIso,
      );
      const slotsToday = (user.role === 'DOCTOR' ? scopedSlots : enrichedSlots).filter(
        (s) => getIsoDatePart(s.slot_date) === localTodayIso,
      );
      const referenceSlots = slotsToday.length > 0 ? slotsToday : scopedSlots;

      let pendingApprovalsCount: number | null = null;
      if (shouldIncludePendingApprovalsCount(user)) {
        const pendingShiftReqs = shiftStore.change_requests.filter(
          (r) => r.status === 'PENDING',
        ).length;
        try {
          const allLeaves = await fetchOrdsItems<DoctorLeave>('leaves');
          pendingApprovalsCount =
            allLeaves.filter((l) => l.leave_status === 'PENDING').length + pendingShiftReqs;
        } catch {
          pendingApprovalsCount = pendingShiftReqs;
        }
      }

      const consultationCounts = countActiveConsultations(scopedAppointments);
      const pendingOutcomeAppointments =
        user.role === 'DOCTOR'
          ? getAppointmentsAwaitingOutcome(
              scopedAppointments,
              user.doctor_id,
              new Date(),
              HOSPITAL_TIMEZONE,
            )
          : [];

      const payload: DashboardSummaryResponse = {
        role: user.role,
        generated_at: new Date().toISOString(),
        source: 'oracle_ords',
        metrics: {
          total_patients: scopedPatientCount,
          total_doctors: doctors.length,
          total_departments: departments.length,
          total_appointments: scopedAppointments.length,
          todays_appointments: todaysAppointments.length,
          held_appointments: scopedAppointments.filter((a) => a.status === 'HELD').length,
          confirmed_appointments: scopedAppointments.filter((a) => a.status === 'CONFIRMED').length,
          completed_appointments: scopedAppointments.filter((a) => a.status === 'COMPLETED').length,
          cancelled_appointments: scopedAppointments.filter((a) => a.status === 'CANCELLED').length,
          online_consultations: consultationCounts.online,
          face_to_face_consultations: consultationCounts.faceToFace,
          available_slots_today: referenceSlots.filter(
            (s) =>
              s.status === 'AVAILABLE' &&
              !isSlotEndExpired(s.slot_date, s.start_time, s.end_time, new Date(), HOSPITAL_TIMEZONE),
          ).length,
          total_slots_today: referenceSlots.length,
          total_payments_amount: scopedPayments.reduce(
            (sum, p) => sum + getEffectiveCollectedPaymentAmount(p),
            0,
          ),
          payments_count: scopedPayments.length,
          waiting_tokens: scopedTokens.filter((t) => t.status === 'WAITING').length,
          in_consultation_tokens: scopedTokens.filter((t) => t.status === 'IN_CONSULTATION').length,
          done_tokens: scopedTokens.filter((t) => t.status === 'DONE').length,
          pending_approvals: pendingApprovalsCount,
        },
        recent_appointments: scopedAppointments.slice(0, 10),
        upcoming_slots: scopedSlots.slice(0, 12),
        departments,
        doctors,
        token_queue: scopedTokens.slice(0, 12),
        payments: scopedPayments.slice(0, 10),
        utilisation: scopedUtilisation.slice(0, 10),
        patient_profile: patientProfile,
        doctor_profile: doctorProfile,
        doctor_templates: doctorTemplates,
        doctor_shift: doctorShift,
        ...(allDoctorShifts ? { all_doctor_shifts: allDoctorShifts } : {}),
        ...(user.role === 'DOCTOR'
          ? {
              doctor_all_slots: doctorAllSlots,
              doctor_leaves: doctorLeaves,
              doctor_slots_today_count: doctorSlotsTodayCount,
              doctor_on_leave_today: doctorOnLeaveToday,
              pending_outcome_appointments: pendingOutcomeAppointments,
            }
          : {}),
      };

      res.json(payload);
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to fetch dashboard data from Oracle ORDS',
      });
    }
  });

  app.get('/api/analytics', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const analyticsPermissions = [
      'REVENUE_ANALYTICS:VIEW',
      'DOCTOR_ANALYTICS:VIEW',
      'DEPARTMENT_ANALYTICS:VIEW',
      'GEOGRAPHIC_ANALYTICS:VIEW',
    ];
    if (!requireAnyPermission(user, res, analyticsPermissions, 'Analytics & Insights')) {
      return;
    }

    const allowedSections = {
      revenue: hasEffectivePermission(user.permissions, user.role, 'REVENUE_ANALYTICS:VIEW'),
      doctor: hasEffectivePermission(user.permissions, user.role, 'DOCTOR_ANALYTICS:VIEW'),
      department: hasEffectivePermission(user.permissions, user.role, 'DEPARTMENT_ANALYTICS:VIEW'),
      geographic: hasEffectivePermission(user.permissions, user.role, 'GEOGRAPHIC_ANALYTICS:VIEW'),
      export_revenue: hasEffectivePermission(user.permissions, user.role, 'REVENUE_ANALYTICS:EXPORT'),
      export_doctor: hasEffectivePermission(user.permissions, user.role, 'DOCTOR_ANALYTICS:EXPORT'),
      export_department: hasEffectivePermission(user.permissions, user.role, 'DEPARTMENT_ANALYTICS:EXPORT'),
      export_geographic: hasEffectivePermission(user.permissions, user.role, 'GEOGRAPHIC_ANALYTICS:EXPORT'),
    };

    try {
      const [departments, doctors, rawPatients, rawAppointments, rawSlots, templates, payments] =
        await Promise.all([
          fetchOrdsItems<Department>('departments/'),
          fetchOrdsItems<Doctor>('doctors'),
          fetchOrdsItems<Patient>('patients'),
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Slot>('slots'),
          fetchSlotTemplatesSafe(),
          fetchOrdsItems<Payment>('payments'),
        ]);

      const activeDeptIds = new Set(departments.map((d) => d.department_id));
      const missingDeptIds = Array.from(
        new Set(doctors.map((d) => d.department_id).filter((id) => !activeDeptIds.has(id))),
      );
      const extraDepts = (
        await Promise.all(
          missingDeptIds.map((id) =>
            fetchOrdsItems<Department>(`departments/${id}`)
              .then((items) => items[0] ?? null)
              .catch(() => null),
          ),
        )
      ).filter((d): d is Department => Boolean(d));
      const allDepartments = [...departments, ...extraDepts];

      const shiftStore = readShiftStore();
      const rawSlotsWithDoctors = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const joinedSlots = enrichSlots(rawSlotsWithDoctors, templates, doctors, allDepartments);
      const enrichedAppointments = enrichAppointments(
        attachConsultationMode(rawAppointments),
        joinedSlots,
        doctors,
      );

      const patientsWithRegions = attachRegionsToPatients(rawPatients);
      const patientMap = new Map<number, Patient>(
        patientsWithRegions.map((p) => [p.patient_id, p]),
      );
      const doctorMap = new Map<number, Doctor>(doctors.map((d) => [d.doctor_id, d]));
      const deptNameMap = new Map<number, string>(
        allDepartments.map((d) => [d.department_id, d.department_name]),
      );
      const paymentsWithRefunds = attachRefundsToPayments(payments);
      const paymentByApptId = new Map<number, Payment>();
      for (const p of paymentsWithRefunds) {
        if (p.status === 'SUCCESS' || p.status === 'REFUND_PENDING' || p.status === 'REFUNDED') {
          paymentByApptId.set(p.appointment_id, p);
        }
      }

      const historicalRecords = loadOrSeedHistoricalAnalytics(doctors, allDepartments);
      const now = new Date();
      const pendingOutcomes: PendingOutcomeItem[] = [];
      const liveRecords: AnalyticsVisitRecord[] = [];

      for (const a of enrichedAppointments) {
        const pat = patientMap.get(a.patient_id);
        const doc = a.doctor_id ? doctorMap.get(a.doctor_id) : undefined;
        const pay = paymentByApptId.get(a.appointment_id);
        const visitDate = getIsoDatePart(a.slot_date || a.created_on) || getServerTodayIso();
        const deptId = a.department_id ?? doc?.department_id ?? 0;
        const deptName =
          a.department_name ||
          (deptId ? deptNameMap.get(deptId) : undefined) ||
          'General OPD';
        const doctorName =
          a.doctor_name || (doc ? `Dr. ${doc.first_name} ${doc.last_name}` : `Slot #${a.slot_id}`);
        const patientName =
          a.patient_name || (pat ? `${pat.first_name} ${pat.last_name}` : `Patient #${a.patient_id}`);

        if (a.status === 'HELD') {
          // Holds are provisional and not completed consultations
          continue;
        }

        if (a.status === 'CONFIRMED') {
          const slotEnded = a.slot_date
            ? isSlotEndExpired(a.slot_date, a.start_time, a.end_time, now, HOSPITAL_TIMEZONE)
            : visitDate < getServerTodayIso();
          if (slotEnded) {
            // Past confirmed visit still awaiting explicit doctor COMPLETED / NO_SHOW confirmation
            pendingOutcomes.push({
              appointment_id: a.appointment_id,
              appointment_ref: a.appointment_ref,
              doctor_id: a.doctor_id || doc?.doctor_id || 0,
              doctor_name: doctorName,
              department_name: deptName,
              patient_name: patientName,
              slot_date: visitDate,
              start_time: a.start_time || '',
              end_time: a.end_time || '',
            });
          }
          // Do not inject unverified or future CONFIRMED bookings into completed/no-show analytics
          continue;
        }

        const rawMethod = String(pay?.payment_method || '').trim().toUpperCase();
        const paymentMethod: AnalyticsVisitRecord['payment_method'] = pay
          ? rawMethod === 'UPI' || rawMethod === 'CARD' || rawMethod === 'CASH' || rawMethod === 'NETBANKING'
            ? rawMethod
            : 'CASH'
          : 'UNPAID';

        const amount = pay
          ? Number(pay.amount || 0)
          : a.status === 'COMPLETED'
            ? Number(a.consultation_fee || doc?.consultation_fee || 0)
            : 0;

        liveRecords.push({
          id: `LIVE-${a.appointment_id}`,
          source: 'LIVE',
          visit_date: visitDate,
          visit_month: visitDate.slice(0, 7),
          start_time: a.start_time || '09:00',
          doctor_id: a.doctor_id || doc?.doctor_id || 0,
          doctor_name: doctorName,
          department_id: deptId,
          department_name: deptName,
          specialization: doc?.specialization || 'General OPD',
          patient_id: a.patient_id,
          patient_name: patientName,
          patient_gender: (pat?.gender as AnalyticsVisitRecord['patient_gender']) || 'UNKNOWN',
          patient_age_group: computePatientAgeGroup(pat?.date_of_birth),
          city: normalizeRegionText(pat?.city) || 'Unspecified',
          locality: normalizeRegionText(pat?.locality) || 'Unspecified',
          status: a.status,
          booking_source: a.booking_source === 'WALK_IN' ? 'WALK_IN' : 'ONLINE',
          consultation_mode: a.consultation_mode === 'ONLINE' ? 'ONLINE' : 'FACE_TO_FACE',
          rescheduled_from_id: a.rescheduled_from_id ?? null,
          payment_method: allowedSections.revenue ? paymentMethod : 'UNPAID',
          amount: allowedSections.revenue ? amount : 0,
        });
      }

      pendingOutcomes.sort(
        (a, b) =>
          a.slot_date.localeCompare(b.slot_date) ||
          a.start_time.localeCompare(b.start_time) ||
          a.appointment_id - b.appointment_id,
      );

      const sanitizedHistorical = allowedSections.revenue
        ? historicalRecords
        : historicalRecords.map((r) => ({ ...r, amount: 0, payment_method: 'UNPAID' as const }));

      const records = [...liveRecords, ...sanitizedHistorical].sort((a, b) =>
        b.visit_date.localeCompare(a.visit_date),
      );

      const responsePayload: AnalyticsDatasetResponse = {
        status: 'success',
        generated_at: new Date().toISOString(),
        range_start: '2025-11-01',
        range_end: getServerTodayIso(),
        historical_count: historicalRecords.length,
        live_count: liveRecords.length,
        pending_outcome_count: pendingOutcomes.length,
        pending_outcomes: allowedSections.doctor ? pendingOutcomes : [],
        records,
        allowed_sections: allowedSections,
      };
      res.json(responsePayload);
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to compile hospital analytics',
      });
    }
  });

  async function buildNotificationsForUser(user: AuthUser): Promise<PortalNotification[]> {
    const ackKey = `${user.role}:${user.user_id}`;
    const dismissed = new Set(readNotificationAcks()[ackKey] || []);

    if (user.role === 'ADMIN') {
      const [shiftStore, leaves] = await Promise.all([
        loadShiftStoreHydrated(),
        fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]),
      ]);
      return buildScopedPortalNotifications({
        user,
        shiftChangeRequests: shiftStore.change_requests,
        leaves,
        doctorAppointments: [],
        patientNotifications: [],
        dismissedIds: dismissed,
      });
    }

    if (user.role === 'DOCTOR' && user.doctor_id) {
      const [shiftStore, rawAppts, rawSlots, templates, doctors, leaves] = await Promise.all([
        loadShiftStoreHydrated(),
        fetchOrdsItems<Appointment>('appointments').catch(() => [] as Appointment[]),
        fetchOrdsItems<Slot>('slots').catch(() => [] as Slot[]),
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
        fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]),
      ]);

      const rawSlotsWithDoctors = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const joinedSlots = enrichSlots(rawSlotsWithDoctors, templates, doctors, []);
      const docAppts = enrichAppointments(rawAppts, joinedSlots, doctors).filter(
        (a) => a.doctor_id === user.doctor_id && ['HELD', 'CONFIRMED'].includes(a.status),
      );

      return buildScopedPortalNotifications({
        user,
        shiftChangeRequests: shiftStore.change_requests,
        leaves,
        doctorAppointments: docAppts,
        patientNotifications: [],
        dismissedIds: dismissed,
      });
    }

    if (user.role === 'PATIENT' && user.patient_id) {
      const clinicalStore = readClinicalStore();
      return buildScopedPortalNotifications({
        user,
        shiftChangeRequests: [],
        leaves: [],
        doctorAppointments: [],
        patientNotifications: clinicalStore.patient_notifications,
        dismissedIds: dismissed,
      });
    }

    return [];
  }

  app.get('/api/notifications', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    try {
      const notifications = await buildNotificationsForUser(user);
      const unreadCount = notifications.filter((n) => !n.read).length;
      res.json({ status: 'success', unread_count: unreadCount, notifications });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to load notifications',
      });
    }
  });

  async function handleNotificationAck(req: Request, res: Response): Promise<void> {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    try {
      const notifications = await buildNotificationsForUser(user);
      const acks = readNotificationAcks();
      const ackKey = `${user.role}:${user.user_id}`;
      const curSet = new Set(acks[ackKey] || []);
      if (req.body?.all) {
        for (const n of notifications) curSet.add(n.id);
      } else if (Array.isArray(req.body?.ids)) {
        for (const id of req.body.ids) {
          if (typeof id === 'string') curSet.add(id);
        }
      } else if (typeof req.body?.id === 'string') {
        curSet.add(req.body.id);
      }
      acks[ackKey] = Array.from(curSet);
      writeNotificationAcks(acks);
      const updated = notifications.map((n) => ({ ...n, read: curSet.has(n.id) }));
      res.json({
        status: 'success',
        unread_count: updated.filter((n) => !n.read).length,
        notifications: updated,
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to update notifications',
      });
    }
  }

  app.post('/api/notifications/dismiss', requireAuth, handleNotificationAck);
  app.post('/api/notifications/read', requireAuth, handleNotificationAck);

  // Helper to resolve or create a weekday slot template ONLY as a pre-migration legacy fallback
  async function ensureDoctorWeekdayTemplate(
    doctorId: number,
    weekday: string,
    workStart: string,
    workEnd: string,
    durationMins: number,
    cachedTemplates: SlotTemplate[],
  ): Promise<number> {
    const existing = cachedTemplates.find(
      (t) =>
        t.doctor_id === doctorId &&
        (t.day_of_week || '').toUpperCase() === weekday.toUpperCase() &&
        t.is_active === 'Y',
    );
    if (existing) return existing.template_id;

    await fetchOrdsJson('slot_templates', {
      method: 'POST',
      body: JSON.stringify({
        doctor_id: doctorId,
        day_of_week: weekday.toUpperCase(),
        start_time: workStart,
        end_time: workEnd,
        slot_duration_mins: durationMins,
        max_patients_per_slot: 1,
      }),
    });

    const refreshed = await fetchSlotTemplatesSafe();
    const created = refreshed.find(
      (t) =>
        t.doctor_id === doctorId &&
        (t.day_of_week || '').toUpperCase() === weekday.toUpperCase() &&
        t.is_active === 'Y',
    );
    if (!created) {
      throw new Error(`Could not resolve slot template for doctor #${doctorId} on ${weekday}`);
    }
    cachedTemplates.push(created);
    return created.template_id;
  }

  async function createOracleSlotForDoctor(params: {
    doctorId: number;
    slotDate: string;
    startTime: string;
    endTime: string;
    maxPatientsPerSlot: number;
    fallbackStart: string;
    fallbackEnd: string;
    fallbackDur: number;
    cachedTemplates: SlotTemplate[];
  }): Promise<{ slot_id?: number; template_id: number | null }> {
    const directRes = await fetchOrdsJson<{
      status?: string;
      message?: string;
      slot_id?: number;
      id?: number;
    }>('slots', {
      method: 'POST',
      body: JSON.stringify({
        doctor_id: params.doctorId,
        slot_date: params.slotDate,
        start_time: params.startTime,
        end_time: params.endTime,
        max_patients_per_slot: params.maxPatientsPerSlot,
      }),
    });

    if (String(directRes?.status || '').trim().toLowerCase() !== 'error') {
      return { slot_id: directRes.slot_id ?? directRes.id, template_id: null };
    }

    const msg = directRes.message || 'Oracle rejected slot creation';
    // Graceful compatibility if script 13 (DOCTOR_ID column + nullable TEMPLATE_ID) hasn't been executed in APEX yet
    if (!/TEMPLATE_ID|ORA-01400|cannot insert NULL/i.test(msg)) {
      throw new Error(msg);
    }

    const weekday = getWeekdayName(params.slotDate);
    const tmplId = await ensureDoctorWeekdayTemplate(
      params.doctorId,
      weekday,
      params.fallbackStart,
      params.fallbackEnd,
      params.fallbackDur,
      params.cachedTemplates,
    );

    const legacyRes = await fetchOrdsJson<{
      status?: string;
      message?: string;
      slot_id?: number;
    }>('slots', {
      method: 'POST',
      body: JSON.stringify({
        doctor_id: params.doctorId,
        template_id: tmplId,
        slot_date: params.slotDate,
        start_time: params.startTime,
        end_time: params.endTime,
        max_patients_per_slot: params.maxPatientsPerSlot,
      }),
    });
    if (legacyRes.status === 'error') {
      throw new Error(legacyRes.message || 'Oracle rejected slot creation');
    }
    return { slot_id: legacyRes.slot_id, template_id: tmplId };
  }

  // Doctor Shift Window & Shift Change Approval Endpoints
  app.get('/api/doctor/shifts', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    try {
      const [doctors, templates, store] = await Promise.all([
        fetchOrdsItems<Doctor>('doctors'),
        fetchSlotTemplatesSafe(),
        loadShiftStoreHydrated(),
      ]);

      if (user.role === 'DOCTOR') {
        if (!user.doctor_id) {
          res.status(400).json({ status: 'error', message: 'Doctor profile is not linked' });
          return;
        }
        const doc = doctors.find((d) => d.doctor_id === user.doctor_id);
        const shift = resolveDoctorShift(
          user.doctor_id,
          templates,
          doc ? `Dr. ${doc.first_name} ${doc.last_name}` : user.full_name,
          store,
        );
        const requests = store.change_requests.filter((r) => r.doctor_id === user.doctor_id);
        res.json({ status: 'success', shift, shifts: [shift], change_requests: requests });
        return;
      }

      const shifts = doctors.map((d) =>
        resolveDoctorShift(
          d.doctor_id,
          templates,
          `Dr. ${d.first_name} ${d.last_name}`,
          store,
        ),
      );
      res.json({
        status: 'success',
        shifts,
        change_requests: canViewAllShiftChangeRequests(user) ? store.change_requests : [],
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to fetch doctor shift windows',
      });
    }
  });

  app.post('/api/doctor/shift/register', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'DOCTOR' || !user.doctor_id) {
      res.status(403).json({ status: 'error', message: 'Only doctors can register their shift window' });
      return;
    }

    try {
      const sessions = normalizeShiftSessions(req.body?.sessions);
      const durationMins = Number(req.body?.slot_duration_mins || 30);
      const workingDaysRaw = Array.isArray(req.body?.working_days)
        ? req.body.working_days.map((d: unknown) => String(d).trim().toUpperCase()).filter(Boolean)
        : DEFAULT_WORKING_DAYS;

      if (sessions.length === 0) {
        res.status(400).json({ status: 'error', message: 'At least one valid shift window is required' });
        return;
      }
      if (Number.isNaN(durationMins) || durationMins < 10 || durationMins > 120) {
        res.status(400).json({ status: 'error', message: 'Slot duration must be between 10 and 120 minutes' });
        return;
      }
      if (workingDaysRaw.length === 0) {
        res.status(400).json({ status: 'error', message: 'Select at least one working day' });
        return;
      }

      const [doctors, templates, hydratedStore] = await Promise.all([
        fetchOrdsItems<Doctor>('doctors'),
        fetchSlotTemplatesSafe(),
        loadShiftStoreHydrated(),
      ]);
      const existing = resolveDoctorShift(user.doctor_id, templates, user.full_name, hydratedStore);
      if (existing.is_registered) {
        res.status(400).json({
          status: 'error',
          message: 'Your shift window is already registered. Submit a Shift Change Request for administrator approval.',
        });
        return;
      }

      const doc = doctors.find((d) => d.doctor_id === user.doctor_id);
      const doctorName = doc ? `Dr. ${doc.first_name} ${doc.last_name}` : user.full_name;
      const nowIso = new Date().toISOString();

      await syncShiftToOracleTemplates(user.doctor_id, sessions, durationMins, workingDaysRaw);

      const savedShift: DoctorShiftConfig = {
        doctor_id: user.doctor_id,
        doctor_name: doctorName,
        sessions,
        slot_duration_mins: durationMins,
        working_days: workingDaysRaw,
        is_registered: true,
        registered_at: nowIso,
        updated_at: nowIso,
      };
      await syncDoctorShiftToOracle(savedShift);

      const store = readShiftStore();
      store.shifts[String(user.doctor_id)] = savedShift;
      writeShiftStore(store);

      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: `${doctorName} (Doctor #${user.doctor_id})`,
        action: 'SHIFT_WINDOW_REGISTERED',
        category: 'SHIFTS_LEAVES',
        new_value: `${formatShiftSummary(sessions, durationMins)} · ${workingDaysRaw.join(',')}`,
        details: `${user.full_name} registered initial shift window: ${formatShiftSummary(sessions, durationMins)} on ${workingDaysRaw.join(', ')}.`,
        severity: 'info',
      });

      res.json({
        status: 'success',
        message: 'Shift window registered successfully',
        shift: savedShift,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to register shift window',
      });
    }
  });

  app.post('/api/doctor/shift/change-request', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'DOCTOR' || !user.doctor_id) {
      res.status(403).json({ status: 'error', message: 'Only doctors can submit shift change requests' });
      return;
    }

    try {
      const requestedSessions = normalizeShiftSessions(req.body?.sessions);
      const requestedDuration = Number(req.body?.slot_duration_mins || 30);
      const requestedDays = Array.isArray(req.body?.working_days)
        ? req.body.working_days.map((d: unknown) => String(d).trim().toUpperCase()).filter(Boolean)
        : DEFAULT_WORKING_DAYS;
      const reason = String(req.body?.reason || '').trim();

      if (requestedSessions.length === 0) {
        res.status(400).json({ status: 'error', message: 'At least one valid shift window is required' });
        return;
      }
      if (Number.isNaN(requestedDuration) || requestedDuration < 10 || requestedDuration > 120) {
        res.status(400).json({ status: 'error', message: 'Slot duration must be between 10 and 120 minutes' });
        return;
      }
      if (!reason) {
        res.status(400).json({ status: 'error', message: 'Please provide a reason for the shift change request' });
        return;
      }

      const [doctors, templates, hydratedStore] = await Promise.all([
        fetchOrdsItems<Doctor>('doctors'),
        fetchSlotTemplatesSafe(),
        loadShiftStoreHydrated(),
      ]);
      const alreadyPending = hydratedStore.change_requests.find(
        (r) => r.doctor_id === user.doctor_id && r.status === 'PENDING',
      );
      if (alreadyPending) {
        res.status(400).json({
          status: 'error',
          message: 'You already have a pending shift change request awaiting administrator review.',
        });
        return;
      }

      const doc = doctors.find((d) => d.doctor_id === user.doctor_id);
      const doctorName = doc ? `Dr. ${doc.first_name} ${doc.last_name}` : user.full_name;
      const currentShift = resolveDoctorShift(user.doctor_id, templates, doctorName, hydratedStore);

      const changeReq: ShiftChangeRequest = {
        request_id: `SCR-${Date.now()}`,
        doctor_id: user.doctor_id,
        doctor_name: doctorName,
        current_sessions: currentShift.sessions,
        current_slot_duration_mins: currentShift.slot_duration_mins,
        current_working_days: currentShift.working_days,
        requested_sessions: requestedSessions,
        requested_slot_duration_mins: requestedDuration,
        requested_working_days: requestedDays.length > 0 ? requestedDays : DEFAULT_WORKING_DAYS,
        reason,
        status: 'PENDING',
        requested_on: new Date().toISOString(),
        decided_on: null,
        decided_by: null,
        decision_comments: null,
      };

      await syncShiftChangeRequestToOracle(changeReq);

      const store = readShiftStore();
      store.change_requests.unshift(changeReq);
      writeShiftStore(store);

      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: `${doctorName} (${changeReq.request_id})`,
        action: 'SHIFT_CHANGE_REQUESTED',
        category: 'SHIFTS_LEAVES',
        previous_value: formatShiftSummary(currentShift.sessions, currentShift.slot_duration_mins),
        new_value: formatShiftSummary(requestedSessions, requestedDuration),
        details: `${doctorName} submitted shift change request ${changeReq.request_id} for ${formatShiftSummary(requestedSessions, requestedDuration)} (${requestedDays.join(', ')}). Reason: ${reason}`,
        severity: 'info',
      });

      res.status(201).json({
        status: 'success',
        message: 'Shift change request submitted for administrator approval',
        request: changeReq,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to submit shift change request',
      });
    }
  });

  app.get('/api/admin/shift-change-requests', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!canViewAllShiftChangeRequests(user)) {
      res.status(403).json({
        status: 'error',
        message: 'Only hospital administrators can view hospital-wide shift change requests.',
      });
      return;
    }
    if (!requirePermission(user, res, 'SLOTS:UPDATE', 'Shift Change Requests')) return;
    const store = await loadShiftStoreHydrated();
    res.json({ status: 'success', requests: store.change_requests });
  });

  app.post('/api/admin/shift-change-requests/:id/decide', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!canDecideLeaveOrShiftRequest(user)) {
      res.status(403).json({
        status: 'error',
        message: 'Only hospital administrators can approve or reject shift change requests.',
      });
      return;
    }
    if (!requirePermission(user, res, 'SLOTS:UPDATE', 'Shift Change Decision')) return;

    const requestId = req.params.id;
    const decision = String(req.body?.decision || '').trim().toUpperCase();
    const comments = String(req.body?.comments || '').trim() || null;

    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      res.status(400).json({ status: 'error', message: 'Decision must be APPROVED or REJECTED' });
      return;
    }

    const hydratedStore = await loadShiftStoreHydrated();
    const target = hydratedStore.change_requests.find((r) => r.request_id === requestId);
    if (!target) {
      res.status(404).json({ status: 'error', message: 'Shift change request not found' });
      return;
    }
    if (target.status !== 'PENDING') {
      res.status(400).json({ status: 'error', message: 'This shift change request has already been decided' });
      return;
    }

    try {
      const nowIso = new Date().toISOString();
      const typedDecision = decision as 'APPROVED' | 'REJECTED';

      if (typedDecision === 'APPROVED') {
        await syncShiftToOracleTemplates(
          target.doctor_id,
          target.requested_sessions,
          target.requested_slot_duration_mins,
          target.requested_working_days,
        );
      }

      await syncShiftChangeDecisionToOracle(requestId, typedDecision, user.full_name, comments);

      const store = readShiftStore();
      if (typedDecision === 'APPROVED') {
        const existingShift = store.shifts[String(target.doctor_id)];
        const updatedShift: DoctorShiftConfig = {
          doctor_id: target.doctor_id,
          doctor_name: target.doctor_name,
          sessions: target.requested_sessions,
          slot_duration_mins: target.requested_slot_duration_mins,
          working_days: target.requested_working_days,
          is_registered: true,
          registered_at: existingShift?.registered_at || nowIso,
          updated_at: nowIso,
        };
        store.shifts[String(target.doctor_id)] = updatedShift;
        await syncDoctorShiftToOracle(updatedShift);
      }

      const localIdx = store.change_requests.findIndex((r) => r.request_id === requestId);
      const updatedReq: ShiftChangeRequest = {
        ...target,
        status: typedDecision,
        decided_on: nowIso,
        decided_by: user.full_name,
        decision_comments: comments,
      };
      if (localIdx >= 0) {
        store.change_requests[localIdx] = updatedReq;
      } else {
        store.change_requests.unshift(updatedReq);
      }
      writeShiftStore(store);

      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: `${target.doctor_name} (${requestId})`,
        action: typedDecision === 'APPROVED' ? 'SHIFT_CHANGE_APPROVED' : 'SHIFT_CHANGE_REJECTED',
        category: 'SHIFTS_LEAVES',
        previous_value: 'PENDING',
        new_value: typedDecision,
        details: `${user.full_name} (${user.role}) ${typedDecision.toLowerCase()} shift change request ${requestId} for ${target.doctor_name} (${formatShiftSummary(target.requested_sessions, target.requested_slot_duration_mins)})${comments ? ` · Notes: ${comments}` : ''}.`,
        severity: typedDecision === 'REJECTED' ? 'warning' : 'info',
      });

      res.json({
        status: 'success',
        message:
          typedDecision === 'APPROVED'
            ? `Shift change approved for ${target.doctor_name} (${formatShiftSummary(target.requested_sessions, target.requested_slot_duration_mins)})`
            : `Shift change request rejected for ${target.doctor_name}`,
        request: updatedReq,
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to apply shift change decision',
      });
    }
  });

  // Doctor ONLY confirms & generates specific working-hour slots for a single date (Admin is read-only)
  app.post('/api/doctor/slots/confirm', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'DOCTOR' || !user.doctor_id) {
      res.status(403).json({
        status: 'error',
        message: 'Only the respective doctor can confirm or generate their own OPD slots. Administrators have read-only access.',
      });
      return;
    }

    const targetDoctorId = user.doctor_id;

    const requestedSlots = Array.isArray(req.body?.slots)
      ? (req.body.slots as Array<{
          slot_date: string;
          start_time: string;
          end_time: string;
          template_id?: number;
          max_patients_per_slot?: number;
        }>)
      : [];

    if (requestedSlots.length === 0) {
      res.status(400).json({ status: 'error', message: 'At least one time slot is required' });
      return;
    }
    if (requestedSlots.length > 48) {
      res.status(400).json({ status: 'error', message: 'Too many slots in a single request (max 48)' });
      return;
    }

    const now = new Date();
    const nowParts = getHospitalNowParts(now, HOSPITAL_TIMEZONE);
    for (const s of requestedSlots) {
      if (!s.slot_date || !s.start_time || !s.end_time) {
        res.status(400).json({ status: 'error', message: 'Each slot requires slot_date, start_time, and end_time' });
        return;
      }
      if (s.slot_date < nowParts.isoDate) {
        res.status(400).json({ status: 'error', message: `Cannot generate slots for past date ${s.slot_date}` });
        return;
      }
      if (isSlotEndExpired(s.slot_date, s.start_time, s.end_time, now, HOSPITAL_TIMEZONE)) {
        res.status(400).json({
          status: 'error',
          message: `Cannot generate slot ending at ${s.end_time} on ${s.slot_date}: end time must be after current hospital time (${nowParts.timeHHMM} ${HOSPITAL_TIMEZONE}).`,
        });
        return;
      }
      if (!isValidSlotTimeRange(s.start_time, s.end_time)) {
        res.status(400).json({ status: 'error', message: `Invalid slot time range ${s.start_time}–${s.end_time}` });
        return;
      }
    }

    try {
      const [templates, existingSlots, leaves] = await Promise.all([
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Slot>('slots'),
        fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]),
      ]);

      const [store, hydratedShiftStore] = [readShiftStore(), await loadShiftStoreHydrated()];
      const openedSet = new Set(store.opened_slot_keys);

      const shift = resolveDoctorShift(targetDoctorId, templates, user.full_name, hydratedShiftStore);
      const fallbackStart = shift.sessions[0]?.start_time || '09:00';
      const fallbackEnd = shift.sessions[0]?.end_time || '17:00';
      const fallbackDur = shift.slot_duration_mins || 30;

      const tmplDoctorMap = buildTemplateDoctorMap(templates, hydratedShiftStore);
      const docExistingSlots = existingSlots.filter(
        (s) => resolveSlotDoctorId(s, tmplDoctorMap) === targetDoctorId,
      );

      let createdCount = 0;
      let skippedCount = 0;

      for (const reqSlot of requestedSlots) {
        if (isDateCoveredByApprovedLeave(reqSlot.slot_date, leaves, targetDoctorId)) {
          res.status(400).json({
            status: 'error',
            message: `Cannot confirm slots on ${reqSlot.slot_date}: doctor has an approved leave.`,
          });
          return;
        }

        const slotKey = makeSlotKey(targetDoctorId, reqSlot.slot_date, reqSlot.start_time);
        const alreadyInOracle = docExistingSlots.some(
          (s) =>
            getIsoDatePart(s.slot_date) === reqSlot.slot_date &&
            s.start_time === reqSlot.start_time &&
            s.status !== 'CANCELLED',
        );
        if (alreadyInOracle) {
          if (!openedSet.has(slotKey)) {
            openedSet.add(slotKey);
            createdCount += 1;
          } else {
            skippedCount += 1;
          }
          continue;
        }

        const created = await createOracleSlotForDoctor({
          doctorId: targetDoctorId,
          slotDate: reqSlot.slot_date,
          startTime: reqSlot.start_time,
          endTime: reqSlot.end_time,
          maxPatientsPerSlot: reqSlot.max_patients_per_slot || 1,
          fallbackStart,
          fallbackEnd,
          fallbackDur,
          cachedTemplates: templates,
        });

        docExistingSlots.push({
          slot_id: created.slot_id ?? -Date.now(),
          doctor_id: targetDoctorId,
          template_id: created.template_id,
          slot_date: reqSlot.slot_date,
          start_time: reqSlot.start_time,
          end_time: reqSlot.end_time,
          max_patients_per_slot: reqSlot.max_patients_per_slot || 1,
          booked_patients: 0,
          status: 'AVAILABLE',
        });
        openedSet.add(slotKey);
        createdCount += 1;
      }

      store.opened_slot_keys = Array.from(openedSet);
      writeShiftStore(store);

      const confirmedDates = Array.from(new Set(requestedSlots.map((s) => s.slot_date))).join(', ');
      const confirmedRange = requestedSlots
        .slice(0, 6)
        .map((s) => `${s.start_time}-${s.end_time}`)
        .join(', ');
      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: `${user.full_name} · ${confirmedDates}`,
        action: 'SLOTS_CONFIRMED',
        category: 'SHIFTS_LEAVES',
        new_value: `${createdCount} opened, ${skippedCount} already open`,
        details: `${user.full_name} confirmed ${requestedSlots.length} slot(s) on ${confirmedDates} [${confirmedRange}${requestedSlots.length > 6 ? ', ...' : ''}] (${createdCount} newly opened).`,
        severity: 'info',
      });

      res.json({
        status: 'success',
        created_count: createdCount,
        skipped_count: skippedCount,
        message:
          createdCount > 0
            ? `Confirmed and opened ${createdCount} slot${createdCount === 1 ? '' : 's'}${skippedCount > 0 ? ` (${skippedCount} already open)` : ''}.`
            : 'Selected time slot(s) were already open.',
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to confirm slots',
      });
    }
  });

  // Doctor ONLY confirms & generates all shift slots for ONE SINGLE DAY (no 1-week bulk generation)
  app.post('/api/doctor/slots/confirm-day', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'DOCTOR' || !user.doctor_id) {
      res.status(403).json({
        status: 'error',
        message: 'Only the respective doctor can confirm their daily OPD slots.',
      });
      return;
    }

    const targetDoctorId = user.doctor_id;
    const now = new Date();
    const nowParts = getHospitalNowParts(now, HOSPITAL_TIMEZONE);
    const todayIso = nowParts.isoDate;
    const targetDate = String(req.body?.slot_date || todayIso).slice(0, 10);

    if (targetDate < todayIso) {
      res.status(400).json({ status: 'error', message: 'Cannot confirm slots for a past date' });
      return;
    }

    try {
      const [templates, existingSlots, leaves] = await Promise.all([
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Slot>('slots'),
        fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]),
      ]);

      if (isDateCoveredByApprovedLeave(targetDate, leaves, targetDoctorId)) {
        res.status(400).json({
          status: 'error',
          message: `Cannot generate slots on ${targetDate}: you have an approved leave.`,
        });
        return;
      }

      const [store, hydratedShiftStore] = [readShiftStore(), await loadShiftStoreHydrated()];
      const openedSet = new Set(store.opened_slot_keys);
      const shift = resolveDoctorShift(targetDoctorId, templates, user.full_name, hydratedShiftStore);
      const docTemplates = templates.filter((t) => t.doctor_id === targetDoctorId);
      const tmplDoctorMap = buildTemplateDoctorMap(templates, hydratedShiftStore);
      const docExistingSlots = existingSlots.filter(
        (s) => resolveSlotDoctorId(s, tmplDoctorMap) === targetDoctorId,
      );

      const allWindows = buildWorkingHourWindows(targetDate, docTemplates, {
        shiftConfig: shift,
        durationMins: Number(req.body?.duration_mins || shift.slot_duration_mins || 30),
      });
      const windows = allWindows.filter((w) => {
        const wDate = w.slot_date || targetDate;
        return (
          !isSlotEndExpired(wDate, w.start_time, w.end_time, now, HOSPITAL_TIMEZONE) &&
          !isDateCoveredByApprovedLeave(wDate, leaves, targetDoctorId)
        );
      });
      if (targetDate === todayIso && windows.length === 0) {
        res.status(400).json({
          status: 'error',
          message: `No future slots remain today after ${nowParts.timeHHMM} (${HOSPITAL_TIMEZONE}). Please select a future date.`,
        });
        return;
      }

      let createdCount = 0;
      for (const w of windows) {
        const wDate = w.slot_date || targetDate;
        const slotKey = makeSlotKey(targetDoctorId, wDate, w.start_time);
        const exists = docExistingSlots.some(
          (s) =>
            getIsoDatePart(s.slot_date) === wDate &&
            s.start_time === w.start_time &&
            s.status !== 'CANCELLED',
        );
        if (exists) {
          if (!openedSet.has(slotKey)) {
            openedSet.add(slotKey);
            createdCount += 1;
          }
          continue;
        }

        const created = await createOracleSlotForDoctor({
          doctorId: targetDoctorId,
          slotDate: wDate,
          startTime: w.start_time,
          endTime: w.end_time,
          maxPatientsPerSlot: 1,
          fallbackStart: shift.sessions[0]?.start_time || '09:00',
          fallbackEnd: shift.sessions[0]?.end_time || '17:00',
          fallbackDur: shift.slot_duration_mins || 30,
          cachedTemplates: templates,
        });
        docExistingSlots.push({
          slot_id: created.slot_id ?? -Date.now(),
          doctor_id: targetDoctorId,
          template_id: created.template_id,
          slot_date: wDate,
          start_time: w.start_time,
          end_time: w.end_time,
          max_patients_per_slot: 1,
          booked_patients: 0,
          status: 'AVAILABLE',
        });
        openedSet.add(slotKey);
        createdCount += 1;
      }

      store.opened_slot_keys = Array.from(openedSet);
      writeShiftStore(store);

      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: `${user.full_name} · ${targetDate}`,
        action: 'SLOTS_DAY_CONFIRMED',
        category: 'SHIFTS_LEAVES',
        new_value: `${createdCount} slots opened`,
        details: `${user.full_name} confirmed daily shift slots for ${targetDate} (${createdCount} newly opened out of ${windows.length} shift window slots).`,
        severity: 'info',
      });

      res.json({
        status: 'success',
        created_count: createdCount,
        message:
          createdCount > 0
            ? `Confirmed ${createdCount} shift slot${createdCount === 1 ? '' : 's'} for ${targetDate}.`
            : `All shift slots for ${targetDate} are already open.`,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to confirm day slots',
      });
    }
  });

  // Pay concerned doctor fee & confirm/finalize appointment booking
  app.post('/api/appointments/:id/pay-and-confirm', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const apptId = Number(req.params.id);
    if (!apptId || Number.isNaN(apptId)) {
      res.status(400).json({ status: 'error', message: 'Invalid appointment ID.' });
      return;
    }

    const allowedPerms =
      user.role === 'PATIENT'
        ? ['APPOINTMENTS:UPDATE', 'APPOINTMENTS:CREATE']
        : ['APPOINTMENTS:UPDATE'];
    if (!requireAnyPermission(user, res, allowedPerms, `Pay & Confirm Appointment #${apptId}`)) {
      return;
    }

    const rawMethod = String(req.body?.payment_method || 'UPI').trim().toUpperCase();
    const paymentMethod = ['UPI', 'CARD', 'NET_BANKING', 'CASH'].includes(rawMethod)
      ? rawMethod
      : 'UPI';

    try {
      await ensureOverdueHoldsExpired();
      const [rawAppts, rawSlots, templates, doctors, departments, existingPayments] =
        await Promise.all([
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Slot>('slots'),
          fetchSlotTemplatesSafe(),
          fetchOrdsItems<Doctor>('doctors'),
          fetchOrdsItems<Department>('departments/'),
          fetchOrdsItems<Payment>('payments').catch(() => [] as Payment[]),
        ]);

      const shiftStore = readShiftStore();
      const slotsWithDoc = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const fullSlots = enrichSlots(slotsWithDoc, templates, doctors, departments);
      const enrichedAppts = enrichAppointments(
        attachConsultationMode(rawAppts, existingPayments),
        fullSlots,
        doctors,
      );

      const targetAppt = enrichedAppts.find((a) => a.appointment_id === apptId);
      if (!targetAppt) {
        res.status(404).json({ status: 'error', message: 'Appointment not found.' });
        return;
      }
      if (user.role === 'PATIENT' && targetAppt.patient_id !== user.patient_id) {
        res.status(403).json({
          status: 'error',
          message: 'Patients can only pay for and confirm their own appointments.',
        });
        return;
      }
      if (targetAppt.status === 'CANCELLED') {
        res.status(400).json({
          status: 'error',
          message: 'Cancelled appointments cannot be paid or confirmed.',
        });
        return;
      }
      if (isAppointmentHoldExpired(targetAppt)) {
        await ensureOverdueHoldsExpired({ force: true });
        res.status(409).json({
          status: 'error',
          code: 'HOLD_EXPIRED',
          message:
            'This 10-minute booking hold has expired and the slot has been released. Please book a new slot.',
        });
        return;
      }

      const doctorFee = Math.max(
        0,
        Number(targetAppt.consultation_fee ?? req.body?.amount ?? 0),
      );
      const alreadyPaid = existingPayments.find(
        (p) => p.appointment_id === apptId && p.status === 'SUCCESS',
      );

      let paymentRef = alreadyPaid?.payment_ref || '';
      let effectiveAmount = doctorFee;
      if (!alreadyPaid) {
        const payConfirmRoute = resolveRoutingDecision({
          mode: getActiveBackendMode(),
          method: 'POST',
          endpoint: `appointments/${apptId}/pay-and-confirm`,
          oicConfigured: OIC_CONFIGURED,
          ordsBaseUrl: ORDS_BASE_URL,
          oicBaseUrl: OIC_BASE_URL,
          enabledPhases: backendState.oic_phases,
        });

        if (payConfirmRoute.servedBy === 'OIC') {
          const oicPayRes = await fetchOrdsJson<{
            status?: string;
            message?: string;
            payment_ref?: string;
            amount?: number;
          }>(`appointments/${apptId}/pay-and-confirm`, {
            method: 'POST',
            body: JSON.stringify({ payment_method: paymentMethod, amount: doctorFee }),
          });
          if (String(oicPayRes?.status || '').trim().toLowerCase() === 'error') {
            res.status(400).json({
              status: 'error',
              message: oicPayRes.message || 'Unable to process payment and confirm booking via OIC.',
            });
            return;
          }
          paymentRef = oicPayRes.payment_ref || `PAY${Date.now()}`;
          if (typeof oicPayRes.amount === 'number' && !Number.isNaN(oicPayRes.amount)) {
            effectiveAmount = oicPayRes.amount;
          }
        } else {
          const payRes = await fetchOrdsJson<{
            status?: string;
            message?: string;
            payment_ref?: string;
          }>('payments', {
            method: 'POST',
            body: JSON.stringify({
              appointment_id: apptId,
              amount: doctorFee,
              payment_method: paymentMethod,
              status: 'SUCCESS',
            }),
          });
          if (payRes.status === 'error') {
            res.status(400).json({
              status: 'error',
              message: payRes.message || 'Unable to record consultation fee payment.',
            });
            return;
          }
          paymentRef = payRes.payment_ref || `PAY${Date.now()}`;

          // Ensure HELD appointment transitions to CONFIRMED even if upstream payment handler does not auto-confirm
          const refreshedAppts = await fetchOrdsItems<Appointment>('appointments').catch(
            () => [] as Appointment[],
          );
          const latestTarget = refreshedAppts.find((a) => a.appointment_id === apptId);
          if (latestTarget && latestTarget.status === 'HELD') {
            const confirmRes = await fetchOrdsJson<{ status?: string; message?: string }>(
              `appointments/${apptId}/confirm`,
              {
                method: 'POST',
                body: JSON.stringify({}),
              },
            );
            if (confirmRes.status === 'error') {
              res.status(400).json({
                status: 'error',
                message: confirmRes.message || 'Payment recorded, but appointment confirmation failed.',
              });
              return;
            }
          }
        }
      }

      const paidAt = new Date().toISOString();
      saveAppointmentMetadata({
        consultation_mode: targetAppt.consultation_mode || 'FACE_TO_FACE',
        rescheduled_from_id: targetAppt.rescheduled_from_id ?? null,
        appointment_ref: targetAppt.appointment_ref,
        appointment_id: apptId,
        patient_id: targetAppt.patient_id,
        slot_id: targetAppt.slot_id,
        payment_status: 'SUCCESS',
        paid_amount: effectiveAmount,
        payment_ref: paymentRef,
        payment_method: paymentMethod,
        paid_at: paidAt,
        updated_at: paidAt,
      });

      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: targetAppt.appointment_ref,
        action: 'APPOINTMENT_PAID_AND_CONFIRMED',
        category: 'BILLING',
        previous_value: targetAppt.status,
        new_value: `CONFIRMED (${paymentRef})`,
        details: `${user.full_name} (${user.role}) paid ₹${effectiveAmount.toFixed(2)} via ${paymentMethod} (${paymentRef}) and confirmed ${targetAppt.appointment_ref} for ${targetAppt.patient_name} with ${targetAppt.doctor_name || `Doctor #${targetAppt.doctor_id ?? ''}`} on ${getIsoDatePart(targetAppt.slot_date) || ''} ${targetAppt.start_time || ''} [${targetAppt.consultation_mode || 'FACE_TO_FACE'}].`,
        severity: 'info',
      });

      res.json({
        status: 'success',
        appointment_id: apptId,
        appointment_ref: targetAppt.appointment_ref,
        appointment_status: 'CONFIRMED',
        payment_ref: paymentRef,
        amount: effectiveAmount,
        payment_method: paymentMethod,
        message: `Payment of ₹${effectiveAmount.toFixed(2)} recorded and booking confirmed.`,
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to process payment and confirm booking',
      });
    }
  });

  // ============================================================================
  // SUPER ADMIN GOVERNANCE, RBAC MATRIX, OVERRIDES, AUDIT & SECURITY APIs
  // ============================================================================

  async function loadUnifiedDirectory() {
    const [ordsUsers, doctors] = await Promise.all([
      fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]),
      fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
    ]);
    return buildUnifiedUsersDirectory(ordsUsers, BRIDGE_ACCOUNTS, doctors);
  }

  app.get('/api/rbac/overview', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requireAnyPermission(user, res, ['USERS:VIEW', 'ROLES:VIEW'], 'RBAC Overview')) return;
    try {
      const [directory, rawAppts, rawSlots, templates, doctors] = await Promise.all([
        loadUnifiedDirectory(),
        fetchOrdsItems<Appointment>('appointments').catch(() => [] as Appointment[]),
        fetchOrdsItems<Slot>('slots').catch(() => [] as Slot[]),
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
      ]);
      const roles = buildRoleDefinitions(directory);
      const logs = readRbacAuditLogs(300);

      const shiftStore = readShiftStore();
      const joinedSlots = enrichSlots(
        attachDoctorIdsToSlots(rawSlots, templates, shiftStore),
        templates,
        doctors,
        [],
      );
      const enrichedAppointments = enrichAppointments(
        attachConsultationMode(rawAppts),
        joinedSlots,
        doctors,
      );
      const consultCounts = countActiveConsultations(enrichedAppointments);

      const recentRegistrations = [...directory]
        .sort((a, b) => (b.created_on || '').localeCompare(a.created_on || ''))
        .slice(0, 8);
      const recentPermissionChanges = logs
        .filter((l) => l.category === 'PERMISSION' || l.category === 'ROLE')
        .slice(0, 10);
      const recentSecurityActivities = logs
        .filter((l) => l.category === 'SECURITY' || l.category === 'AUTH')
        .slice(0, 10);

      res.json({
        status: 'success',
        generated_at: new Date().toISOString(),
        metrics: {
          total_users: directory.length,
          total_admins: directory.filter((u) => u.role === 'ADMIN').length,
          total_doctors: directory.filter((u) => u.role === 'DOCTOR').length,
          total_receptionists: directory.filter((u) => u.role === 'RECEPTIONIST').length,
          total_patients: directory.filter((u) => u.role === 'PATIENT').length,
          active_accounts: directory.filter((u) => u.status === 'ACTIVE').length,
          inactive_accounts: directory.filter((u) => u.status === 'INACTIVE').length,
          suspended_accounts: directory.filter((u) => u.status === 'SUSPENDED').length,
        },
        consultation_metrics: {
          total_active_appointments: consultCounts.totalActive,
          online_consultations: consultCounts.online,
          face_to_face_consultations: consultCounts.faceToFace,
        },
        recent_appointments: enrichedAppointments.slice(0, 8),
        recent_registrations: recentRegistrations,
        recent_permission_changes: recentPermissionChanges,
        recent_security_activities: recentSecurityActivities,
        roles,
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to load RBAC overview',
      });
    }
  });

  app.get('/api/rbac/users', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'USERS:VIEW', 'User Management Directory')) return;
    try {
      const directory = await loadUnifiedDirectory();
      const roles = buildRoleDefinitions(directory);
      res.json({ status: 'success', users: directory, roles });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to load users directory',
      });
    }
  });

  app.post('/api/rbac/users', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'USERS:CREATE', 'Create Staff Account')) return;

    const fullName = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneNumber = String(req.body?.phone_number || '').trim() || null;
    const password = String(req.body?.password || '');
    const requestedRole = String(req.body?.role_name || '').trim().toUpperCase() as RoleName;

    const store = readRbacStore();
    const minLen = Math.max(6, Number(store.security_settings.min_password_length || 6));

    if (!fullName || !email || !password || !requestedRole) {
      res.status(400).json({
        status: 'error',
        message: 'Full name, email ID, password, and role are required.',
      });
      return;
    }

    if (requestedRole === 'SUPER_ADMIN') {
      recordRbacAuditLog({
        actor_user_id: actor.user_id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        target_label: email,
        action: 'UNAUTHORIZED_ACCESS',
        category: 'SECURITY',
        new_value: 'CREATE:SUPER_ADMIN',
        details: `Blocked attempt by ${actor.email} to create a second SUPER_ADMIN account.`,
        severity: 'critical',
      });
      res.status(403).json({
        status: 'error',
        message: 'Public or secondary Super Admin creation is strictly prohibited.',
      });
      return;
    }

    if (!['ADMIN', 'DOCTOR', 'RECEPTIONIST'].includes(requestedRole)) {
      res.status(400).json({
        status: 'error',
        message: 'Staff creation supports ADMIN, DOCTOR, or RECEPTIONIST roles only.',
      });
      return;
    }

    if (requestedRole === 'ADMIN' && actor.role !== 'SUPER_ADMIN') {
      recordRbacAuditLog({
        actor_user_id: actor.user_id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        target_label: email,
        action: 'UNAUTHORIZED_ACCESS',
        category: 'SECURITY',
        new_value: 'CREATE:ADMIN',
        details: `Blocked non-Super-Admin (${actor.email}) from provisioning an ADMIN account.`,
        severity: 'warning',
      });
      res.status(403).json({
        status: 'error',
        message: 'Only the Super Admin can create Administrator accounts.',
      });
      return;
    }

    if (password.length < minLen) {
      res.status(400).json({
        status: 'error',
        message: `Password must be at least ${minLen} characters (per Security Settings).`,
      });
      return;
    }

    try {
      const directory = await loadUnifiedDirectory();
      if (directory.some((u) => u.email.toLowerCase() === email)) {
        res.status(400).json({
          status: 'error',
          message: `An account with email ${email} already exists.`,
        });
        return;
      }

      let linkedDoctorId: number | null = req.body?.doctor_id ? Number(req.body.doctor_id) : null;

      // Optional Doctor master creation if department_id supplied
      if (requestedRole === 'DOCTOR' && !linkedDoctorId && req.body?.department_id) {
        const cleanName = fullName.replace(/^dr\.?\s*/i, '').trim();
        const parts = cleanName.split(/\s+/);
        const firstName = parts[0] || cleanName;
        const lastName = parts.slice(1).join(' ') || 'Staff';
        await fetchOrdsJson('doctors', {
          method: 'POST',
          body: JSON.stringify({
            department_id: Number(req.body.department_id),
            first_name: firstName,
            last_name: lastName,
            specialization: String(req.body?.specialization || 'General Medicine').trim(),
            consultation_fee: Number(req.body?.consultation_fee || 500),
            tele_consult_flag: req.body?.tele_consult_flag === 'Y' ? 'Y' : 'N',
            employment_type: req.body?.employment_type === 'PART_TIME' ? 'PART_TIME' : 'FULL_TIME',
          }),
        }).catch(() => null);

        const refreshedDocs = await fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]);
        const matchedDoc = refreshedDocs
          .filter(
            (d) =>
              d.first_name.trim().toLowerCase() === firstName.toLowerCase() &&
              d.last_name.trim().toLowerCase() === lastName.toLowerCase(),
          )
          .sort((a, b) => b.doctor_id - a.doctor_id)[0];
        if (matchedDoc) {
          linkedDoctorId = matchedDoc.doctor_id;
        }
      }

      const usernameSlug = email.split('@')[0].replace(/[^a-z0-9._-]/g, '.');
      const nextId = 5000 + store.managed_users.length + Math.floor(Math.random() * 500);
      const formattedName =
        requestedRole === 'DOCTOR' && !/^dr\.?\s/i.test(fullName) ? `Dr. ${fullName}` : fullName;

      store.managed_users.push({
        user_id: nextId,
        username: usernameSlug,
        email,
        full_name: formattedName,
        phone_number: phoneNumber,
        role: requestedRole as Exclude<RoleName, 'SUPER_ADMIN'>,
        password_hash: hashPasswordScrypt(password),
        doctor_id: linkedDoctorId,
        patient_id: null,
        created_on: new Date().toISOString(),
      });
      store.user_statuses[email] = 'ACTIVE';
      writeRbacStore(store);

      // Sync DOCTOR/RECEPTIONIST to Oracle ORDS users when compatible (non-blocking)
      if (requestedRole === 'DOCTOR' || requestedRole === 'RECEPTIONIST') {
        fetchOrdsJson('users', {
          method: 'POST',
          body: JSON.stringify({
            username: `${usernameSlug}.${nextId}`,
            email,
            full_name: formattedName,
            password,
            role_name: requestedRole,
            phone_number: phoneNumber || undefined,
            ...(linkedDoctorId ? { doctor_id: linkedDoctorId } : {}),
          }),
        }).catch(() => null);
      }

      recordRbacAuditLog({
        actor_user_id: actor.user_id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        target_user_id: nextId,
        target_label: `${formattedName} (${email})`,
        action: 'USER_CREATED',
        category: 'USER',
        previous_value: null,
        new_value: `${requestedRole}:ACTIVE`,
        details: `Provisioned new ${requestedRole} account for ${formattedName}.`,
        severity: 'info',
      });

      const refreshed = await loadUnifiedDirectory();
      const created = findManagedUserRecord(refreshed, email);
      res.status(201).json({
        status: 'success',
        message: `${ROLE_LABELS[requestedRole]} account created for ${formattedName}.`,
        user: created,
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to provision account',
      });
    }
  });

  app.patch('/api/rbac/users/:userKey/status', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'USERS:UPDATE', 'Change Account Status')) return;

    const nextStatus = String(req.body?.status || '').trim().toUpperCase() as AccountStatus;
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(nextStatus)) {
      res.status(400).json({ status: 'error', message: 'Status must be ACTIVE, INACTIVE, or SUSPENDED.' });
      return;
    }

    const directory = await loadUnifiedDirectory();
    const target = findManagedUserRecord(directory, req.params.userKey);
    if (!target) {
      res.status(404).json({ status: 'error', message: 'User account not found.' });
      return;
    }

    const guard = canActorModifyTargetUser(actor, target, 'STATUS');
    if (!guard.allowed) {
      recordRbacAuditLog({
        actor_user_id: actor.user_id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        target_user_id: target.user_id,
        target_label: `${target.full_name} (${target.email})`,
        action: 'UNAUTHORIZED_ACCESS',
        category: 'SECURITY',
        new_value: `STATUS:${nextStatus}`,
        details: guard.reason || 'Blocked user status change.',
        severity: 'critical',
      });
      res.status(403).json({ status: 'error', message: guard.reason });
      return;
    }

    const store = readRbacStore();
    const prevStatus = target.status;
    store.user_statuses[target.user_key] = nextStatus;
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_user_id: target.user_id,
      target_label: `${target.full_name} (${target.email})`,
      action: 'USER_STATUS_CHANGED',
      category: 'USER',
      previous_value: prevStatus,
      new_value: nextStatus,
      details: `Account status changed from ${prevStatus} to ${nextStatus}.`,
      severity: nextStatus === 'SUSPENDED' ? 'warning' : 'info',
    });

    const refreshed = await loadUnifiedDirectory();
    res.json({
      status: 'success',
      message: `${target.full_name} is now ${nextStatus}.`,
      user: findManagedUserRecord(refreshed, target.user_key),
    });
  });

  app.patch('/api/rbac/users/:userKey/role', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'ROLES:UPDATE', 'Change User Role')) return;

    const nextRole = String(req.body?.role || '').trim().toUpperCase() as RoleName;
    if (!['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'].includes(nextRole)) {
      res.status(400).json({ status: 'error', message: 'Invalid role specified.' });
      return;
    }

    const directory = await loadUnifiedDirectory();
    const target = findManagedUserRecord(directory, req.params.userKey);
    if (!target) {
      res.status(404).json({ status: 'error', message: 'User account not found.' });
      return;
    }

    const guard = canActorModifyTargetUser(actor, target, 'ROLE', nextRole);
    if (!guard.allowed) {
      recordRbacAuditLog({
        actor_user_id: actor.user_id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        target_user_id: target.user_id,
        target_label: `${target.full_name} (${target.email})`,
        action: 'UNAUTHORIZED_ACCESS',
        category: 'SECURITY',
        new_value: `ROLE:${nextRole}`,
        details: guard.reason || 'Blocked role escalation or protected modification.',
        severity: 'critical',
      });
      res.status(403).json({ status: 'error', message: guard.reason });
      return;
    }

    const store = readRbacStore();
    const prevRole = target.role;
    store.user_role_overrides[target.user_key] = nextRole;
    const managedIdx = store.managed_users.findIndex(
      (m) => m.email.toLowerCase() === target.email.toLowerCase(),
    );
    if (managedIdx >= 0) {
      store.managed_users[managedIdx].role = nextRole as Exclude<RoleName, 'SUPER_ADMIN'>;
    }
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_user_id: target.user_id,
      target_label: `${target.full_name} (${target.email})`,
      action: 'USER_ROLE_CHANGED',
      category: 'ROLE',
      previous_value: prevRole,
      new_value: nextRole,
      details: `Changed assigned role from ${prevRole} to ${nextRole}.`,
      severity: 'info',
    });

    const refreshed = await loadUnifiedDirectory();
    res.json({
      status: 'success',
      message: `${target.full_name} role updated to ${ROLE_LABELS[nextRole]}.`,
      user: findManagedUserRecord(refreshed, target.user_key),
    });
  });

  app.put('/api/rbac/users/:userKey/permissions', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'PERMISSIONS:UPDATE', 'User Permission Overrides')) return;

    const directory = await loadUnifiedDirectory();
    const target = findManagedUserRecord(directory, req.params.userKey);
    if (!target) {
      res.status(404).json({ status: 'error', message: 'User account not found.' });
      return;
    }

    const guard = canActorModifyTargetUser(actor, target, 'PERMISSIONS');
    if (!guard.allowed) {
      recordRbacAuditLog({
        actor_user_id: actor.user_id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        target_user_id: target.user_id,
        target_label: `${target.full_name} (${target.email})`,
        action: 'UNAUTHORIZED_ACCESS',
        category: 'SECURITY',
        details: guard.reason || 'Blocked user permission override attempt.',
        severity: 'critical',
      });
      res.status(403).json({ status: 'error', message: guard.reason });
      return;
    }

    const store = readRbacStore();
    const roleDefaults = store.role_matrix[target.role] || DEFAULT_ROLE_PERMISSION_MATRIX[target.role];
    const roleDefaultSet = new Set(roleDefaults);

    let grants: string[] = [];
    let revokes: string[] = [];
    if (Array.isArray(req.body?.effective_permissions)) {
      const desired = new Set<string>(
        normalizeCanonicalPermissions(req.body.effective_permissions.map(String)),
      );
      grants = Array.from(desired).filter((p) => !roleDefaultSet.has(p));
      revokes = roleDefaults.filter((p) => !desired.has(p));
    } else {
      grants = normalizeCanonicalPermissions(
        Array.isArray(req.body?.grants) ? req.body.grants.map(String) : [],
      );
      revokes = normalizeCanonicalPermissions(
        Array.isArray(req.body?.revokes) ? req.body.revokes.map(String) : [],
      );
    }

    const beforeEffective = target.effective_permissions;
    const afterEffective = computeEffectivePermissions(target.role, store.role_matrix, {
      grants,
      revokes,
    });
    const diff = diffPermissionSets(beforeEffective, afterEffective);

    if (grants.length === 0 && revokes.length === 0) {
      delete store.user_overrides[target.user_key];
    } else {
      store.user_overrides[target.user_key] = { grants, revokes };
    }
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_user_id: target.user_id,
      target_label: `${target.full_name} (${target.email})`,
      action: 'USER_PERMISSIONS_UPDATED',
      category: 'PERMISSION',
      previous_value: diff.removed.length > 0 ? `-${diff.removed.join(', ')}` : 'No removals',
      new_value: diff.added.length > 0 ? `+${diff.added.join(', ')}` : 'No additions',
      details: `Updated overrides for ${target.full_name}: +${diff.added.length} granted, -${diff.removed.length} revoked (Effective: ${afterEffective.length}).`,
      severity: 'info',
    });

    const refreshed = await loadUnifiedDirectory();
    res.json({
      status: 'success',
      message: `Saved permission overrides for ${target.full_name}.`,
      diff,
      user: findManagedUserRecord(refreshed, target.user_key),
    });
  });

  app.post('/api/rbac/users/:userKey/reset-permissions', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'PERMISSIONS:UPDATE', 'Reset User Permissions')) return;

    const directory = await loadUnifiedDirectory();
    const target = findManagedUserRecord(directory, req.params.userKey);
    if (!target) {
      res.status(404).json({ status: 'error', message: 'User account not found.' });
      return;
    }

    const guard = canActorModifyTargetUser(actor, target, 'PERMISSIONS');
    if (!guard.allowed) {
      res.status(403).json({ status: 'error', message: guard.reason });
      return;
    }

    const store = readRbacStore();
    delete store.user_overrides[target.user_key];
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_user_id: target.user_id,
      target_label: `${target.full_name} (${target.email})`,
      action: 'USER_PERMISSIONS_RESET',
      category: 'PERMISSION',
      previous_value: `+${target.grants.length} / -${target.revokes.length} overrides`,
      new_value: `Role defaults (${target.role})`,
      details: `Reset ${target.full_name} permissions back to ${ROLE_LABELS[target.role]} role defaults.`,
      severity: 'info',
    });

    const refreshed = await loadUnifiedDirectory();
    res.json({
      status: 'success',
      message: `Reset ${target.full_name} permissions to ${ROLE_LABELS[target.role]} defaults.`,
      user: findManagedUserRecord(refreshed, target.user_key),
    });
  });

  app.post('/api/rbac/users/:userKey/reset-password', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'USERS:UPDATE', 'Reset User Password')) return;

    const directory = await loadUnifiedDirectory();
    const target = findManagedUserRecord(directory, req.params.userKey);
    if (!target) {
      res.status(404).json({ status: 'error', message: 'User account not found.' });
      return;
    }

    const guard = canActorModifyTargetUser(actor, target, 'RESET_PASSWORD');
    if (!guard.allowed) {
      res.status(403).json({ status: 'error', message: guard.reason });
      return;
    }

    const store = readRbacStore();
    const minLen = Math.max(6, Number(store.security_settings.min_password_length || 6));
    const newPassword = String(req.body?.new_password || '');
    if (newPassword.length < minLen) {
      res.status(400).json({
        status: 'error',
        message: `New password must be at least ${minLen} characters.`,
      });
      return;
    }

    const hashed = hashPasswordScrypt(newPassword);
    store.password_overrides[target.email.toLowerCase()] = hashed;
    const managedIdx = store.managed_users.findIndex(
      (m) => m.email.toLowerCase() === target.email.toLowerCase(),
    );
    if (managedIdx >= 0) {
      store.managed_users[managedIdx].password_hash = hashed;
    }
    delete store.login_failures[target.email.toLowerCase()];
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_user_id: target.user_id,
      target_label: `${target.full_name} (${target.email})`,
      action: 'USER_PASSWORD_RESET',
      category: 'SECURITY',
      details: `Administrator reset password and cleared login lockout for ${target.email}.`,
      severity: 'info',
    });

    res.json({
      status: 'success',
      message: `Password updated for ${target.full_name}.`,
    });
  });

  app.get('/api/rbac/roles', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requireAnyPermission(user, res, ['ROLES:VIEW', 'PERMISSIONS:VIEW'], 'Role Management')) return;
    try {
      const directory = await loadUnifiedDirectory();
      const roles = buildRoleDefinitions(directory);
      res.json({
        status: 'success',
        roles,
        modules: RBAC_MODULES,
        defaults: DEFAULT_ROLE_PERMISSION_MATRIX,
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to fetch role definitions',
      });
    }
  });

  app.put('/api/rbac/roles/:role/permissions', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'PERMISSIONS:UPDATE', 'Role Permission Matrix')) return;

    const targetRole = String(req.params.role || '').trim().toUpperCase() as RoleName;
    if (!['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'].includes(targetRole)) {
      res.status(400).json({ status: 'error', message: 'Unknown system role.' });
      return;
    }

    if (targetRole === 'SUPER_ADMIN') {
      res.status(403).json({
        status: 'error',
        message: 'SUPER_ADMIN role permissions are immutable and protected.',
      });
      return;
    }

    if (actor.role !== 'SUPER_ADMIN' && (targetRole === actor.role || targetRole === 'ADMIN')) {
      recordRbacAuditLog({
        actor_user_id: actor.user_id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        target_label: targetRole,
        action: 'UNAUTHORIZED_ACCESS',
        category: 'SECURITY',
        details: `Blocked ${actor.role} from modifying ${targetRole} role permissions.`,
        severity: 'critical',
      });
      res.status(403).json({
        status: 'error',
        message: 'Only the Super Admin can modify Administrator or peer role permissions.',
      });
      return;
    }

    const incoming = Array.isArray(req.body?.permissions)
      ? normalizeCanonicalPermissions(req.body.permissions)
      : [];
    const store = readRbacStore();
    const before = store.role_matrix[targetRole] || [];
    const diff = diffPermissionSets(before, incoming);

    store.role_matrix[targetRole] = incoming;
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_label: `${ROLE_LABELS[targetRole]} (${targetRole})`,
      action: 'ROLE_PERMISSIONS_UPDATED',
      category: 'PERMISSION',
      previous_value: diff.removed.length > 0 ? `-${diff.removed.join(', ')}` : `${before.length} perms`,
      new_value: diff.added.length > 0 ? `+${diff.added.join(', ')}` : `${incoming.length} perms`,
      details: `Updated ${targetRole} matrix: +${diff.added.length} added, -${diff.removed.length} removed (${incoming.length} total).`,
      severity: 'info',
    });

    const directory = await loadUnifiedDirectory();
    res.json({
      status: 'success',
      message: `Updated ${ROLE_LABELS[targetRole]} role permissions (${incoming.length} active).`,
      diff,
      roles: buildRoleDefinitions(directory),
    });
  });

  app.post('/api/rbac/roles/:role/reset', requireAuth, async (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'PERMISSIONS:UPDATE', 'Reset Role Permissions')) return;

    const targetRole = String(req.params.role || '').trim().toUpperCase() as RoleName;
    if (targetRole === 'SUPER_ADMIN' || !DEFAULT_ROLE_PERMISSION_MATRIX[targetRole]) {
      res.status(403).json({ status: 'error', message: 'Cannot reset immutable or unknown role.' });
      return;
    }
    if (actor.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only the Super Admin can reset role permission matrices.' });
      return;
    }

    const store = readRbacStore();
    const before = store.role_matrix[targetRole] || [];
    const defaults = [...DEFAULT_ROLE_PERMISSION_MATRIX[targetRole]];
    const diff = diffPermissionSets(before, defaults);
    store.role_matrix[targetRole] = defaults;
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_label: `${ROLE_LABELS[targetRole]} (${targetRole})`,
      action: 'ROLE_PERMISSIONS_RESET',
      category: 'PERMISSION',
      previous_value: `${before.length} perms`,
      new_value: `${defaults.length} default perms`,
      details: `Reset ${targetRole} permissions to factory defaults (+${diff.added.length}, -${diff.removed.length}).`,
      severity: 'info',
    });

    const directory = await loadUnifiedDirectory();
    res.json({
      status: 'success',
      message: `Reset ${ROLE_LABELS[targetRole]} permissions to default baseline.`,
      roles: buildRoleDefinitions(directory),
    });
  });

  app.get('/api/rbac/audit-logs', requireAuth, (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (
      !requireAnyPermission(
        user,
        res,
        ['SYSTEM_SETTINGS:VIEW', 'USERS:VIEW', 'ROLES:VIEW', 'PERMISSIONS:VIEW'],
        'RBAC Audit Logs',
      )
    ) {
      return;
    }
    const logs = readRbacAuditLogs(1000);
    res.json({ status: 'success', logs });
  });

  app.get('/api/rbac/security-settings', requireAuth, (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'SYSTEM_SETTINGS:VIEW', 'Security Settings')) return;
    const store = readRbacStore();
    res.json({ status: 'success', settings: store.security_settings });
  });

  app.put('/api/rbac/security-settings', requireAuth, (req, res) => {
    const actor = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(actor, res, 'SYSTEM_SETTINGS:UPDATE', 'Security Settings')) return;

    const store = readRbacStore();
    const prev = { ...store.security_settings };
    const next = {
      max_failed_login_attempts: Math.max(
        2,
        Math.min(20, Number(req.body?.max_failed_login_attempts ?? prev.max_failed_login_attempts)),
      ),
      lockout_minutes: Math.max(
        1,
        Math.min(120, Number(req.body?.lockout_minutes ?? prev.lockout_minutes)),
      ),
      min_password_length: Math.max(
        6,
        Math.min(32, Number(req.body?.min_password_length ?? prev.min_password_length)),
      ),
      session_ttl_hours: Math.max(
        1,
        Math.min(168, Number(req.body?.session_ttl_hours ?? prev.session_ttl_hours)),
      ),
      allow_patient_registration:
        typeof req.body?.allow_patient_registration === 'boolean'
          ? req.body.allow_patient_registration
          : prev.allow_patient_registration,
      enforce_strict_role_portal:
        typeof req.body?.enforce_strict_role_portal === 'boolean'
          ? req.body.enforce_strict_role_portal
          : prev.enforce_strict_role_portal,
    };

    store.security_settings = next;
    writeRbacStore(store);

    recordRbacAuditLog({
      actor_user_id: actor.user_id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      target_label: 'System Security Policy',
      action: 'SECURITY_SETTINGS_UPDATED',
      category: 'SECURITY',
      previous_value: `maxFail=${prev.max_failed_login_attempts}, minPw=${prev.min_password_length}, reg=${prev.allow_patient_registration}`,
      new_value: `maxFail=${next.max_failed_login_attempts}, minPw=${next.min_password_length}, reg=${next.allow_patient_registration}`,
      details: `Updated security settings (lockout ${next.lockout_minutes}m, session ${next.session_ttl_hours}h, strictPortal=${next.enforce_strict_role_portal}).`,
      severity: 'info',
    });

    res.json({
      status: 'success',
      message: 'Security policy settings saved.',
      settings: next,
    });
  });

  // ============================================================================
  // CLINICAL MODULES: MEDICAL RECORDS & PRESCRIPTIONS (MODULE:ACTION + SCOPING)
  // ============================================================================

  app.get('/api/clinical/records', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'MEDICAL_RECORDS:VIEW', 'Medical Records')) return;
    let records = await loadMedicalRecordsHydrated();
    if (user.role === 'PATIENT') {
      records = records.filter((r) => r.patient_id === user.patient_id);
    } else if (user.role === 'DOCTOR' && user.doctor_id) {
      const bookedIds = await getBookedPatientIdsForDoctor(user.doctor_id).catch(
        () => new Set<number>(),
      );
      records = records.filter(
        (r) => r.doctor_id === user.doctor_id || bookedIds.has(r.patient_id),
      );
    }
    res.json({ status: 'success', records });
  });

  app.post('/api/clinical/records', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'MEDICAL_RECORDS:CREATE', 'Create Medical Record')) return;

    const patientId = Number(req.body?.patient_id);
    const patientName = String(req.body?.patient_name || '').trim();
    const doctorId = Number(req.body?.doctor_id || user.doctor_id || 0);
    const doctorName = String(req.body?.doctor_name || user.full_name || '').trim();
    const chiefComplaint = String(req.body?.chief_complaint || '').trim();
    const diagnosis = String(req.body?.diagnosis || '').trim();
    const clinicalNotes = String(req.body?.clinical_notes || '').trim();

    if (!patientId || !chiefComplaint || !diagnosis) {
      res.status(400).json({
        status: 'error',
        message: 'Patient, chief complaint, and diagnosis are required.',
      });
      return;
    }

    const entry: MedicalRecordEntry = {
      record_id: `MR-${Date.now()}`,
      patient_id: patientId,
      patient_name: patientName || `Patient #${patientId}`,
      doctor_id: doctorId,
      doctor_name: doctorName || `Doctor #${doctorId}`,
      appointment_ref: String(req.body?.appointment_ref || '').trim() || null,
      visit_date: String(req.body?.visit_date || getServerTodayIso()).slice(0, 10),
      chief_complaint: chiefComplaint,
      diagnosis,
      vitals_summary: String(req.body?.vitals_summary || '').trim() || null,
      clinical_notes: clinicalNotes || 'Recorded during OPD consultation.',
      updated_at: new Date().toISOString(),
    };

    try {
      const ordsRes = await fetchOrdsJson<{ status?: string; message?: string }>('medical-records', {
        method: 'POST',
        body: JSON.stringify(serializeMedicalRecordForOracle(entry)),
      });
      if (ordsRes?.status === 'error') {
        res.status(400).json({ status: 'error', message: ordsRes.message || 'Unable to save medical record in Oracle' });
        return;
      }
    } catch (err) {
      if (!isMissingOracleEndpointError(err)) {
        res.status(502).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to save medical record in Oracle',
        });
        return;
      }
    }

    const store = readClinicalStore();
    store.medical_records.unshift(entry);
    writeClinicalStore(store);

    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_role: user.role,
      target_label: `${entry.patient_name} (${entry.record_id})`,
      action: 'MEDICAL_RECORD_CREATED',
      category: 'CLINICAL',
      new_value: entry.diagnosis,
      details: `Added clinical record for ${entry.patient_name}.`,
      severity: 'info',
    });

    res.status(201).json({ status: 'success', record: entry });
  });

  app.put('/api/clinical/records/:id', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'MEDICAL_RECORDS:UPDATE', 'Update Medical Record')) return;
    const allRecords = await loadMedicalRecordsHydrated();
    const current = allRecords.find((r) => r.record_id === req.params.id);
    if (!current) {
      res.status(404).json({ status: 'error', message: 'Medical record not found.' });
      return;
    }
    if (user.role === 'DOCTOR' && user.doctor_id && current.doctor_id !== user.doctor_id) {
      res.status(403).json({
        status: 'error',
        message: 'Doctors can only modify their own clinical records.',
      });
      return;
    }

    const updatedRecord: MedicalRecordEntry = {
      ...current,
      chief_complaint: String(req.body?.chief_complaint ?? current.chief_complaint).trim(),
      diagnosis: String(req.body?.diagnosis ?? current.diagnosis).trim(),
      vitals_summary:
        req.body?.vitals_summary !== undefined
          ? String(req.body.vitals_summary).trim() || null
          : current.vitals_summary,
      clinical_notes: String(req.body?.clinical_notes ?? current.clinical_notes).trim(),
      updated_at: new Date().toISOString(),
    };

    try {
      const ordsRes = await fetchOrdsJson<{ status?: string; message?: string }>(
        `medical-records/${encodeURIComponent(req.params.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            chief_complaint: updatedRecord.chief_complaint,
            diagnosis: updatedRecord.diagnosis,
            vitals_summary: updatedRecord.vitals_summary,
            clinical_notes: updatedRecord.clinical_notes,
          }),
        },
      );
      if (ordsRes?.status === 'error') {
        res.status(400).json({ status: 'error', message: ordsRes.message || 'Unable to update medical record in Oracle' });
        return;
      }
    } catch (err) {
      if (!isMissingOracleEndpointError(err)) {
        res.status(502).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to update medical record in Oracle',
        });
        return;
      }
    }

    const store = readClinicalStore();
    const idx = store.medical_records.findIndex((r) => r.record_id === req.params.id);
    if (idx >= 0) {
      store.medical_records[idx] = updatedRecord;
    } else {
      store.medical_records.unshift(updatedRecord);
    }
    writeClinicalStore(store);

    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_role: user.role,
      target_label: `${current.patient_name} (${current.record_id})`,
      action: 'MEDICAL_RECORD_UPDATED',
      category: 'CLINICAL',
      details: `Updated clinical record ${current.record_id}.`,
      severity: 'info',
    });

    res.json({ status: 'success', record: updatedRecord });
  });

  app.delete('/api/clinical/records/:id', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'MEDICAL_RECORDS:DELETE', 'Delete Medical Record')) return;
    const allRecords = await loadMedicalRecordsHydrated();
    const current = allRecords.find((r) => r.record_id === req.params.id);
    if (!current) {
      res.status(404).json({ status: 'error', message: 'Medical record not found.' });
      return;
    }

    try {
      const ordsRes = await fetchOrdsJson<{ status?: string; message?: string }>(
        `medical-records/${encodeURIComponent(req.params.id)}`,
        { method: 'DELETE' },
      );
      if (ordsRes?.status === 'error') {
        res.status(400).json({ status: 'error', message: ordsRes.message || 'Unable to delete medical record in Oracle' });
        return;
      }
    } catch (err) {
      if (!isMissingOracleEndpointError(err)) {
        res.status(502).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to delete medical record in Oracle',
        });
        return;
      }
    }

    const store = readClinicalStore();
    const idx = store.medical_records.findIndex((r) => r.record_id === req.params.id);
    if (idx >= 0) {
      store.medical_records.splice(idx, 1);
      writeClinicalStore(store);
    }

    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_role: user.role,
      target_label: `${current.patient_name} (${current.record_id})`,
      action: 'MEDICAL_RECORD_DELETED',
      category: 'CLINICAL',
      details: `Deleted medical record ${current.record_id}.`,
      severity: 'warning',
    });
    res.json({ status: 'success', message: 'Medical record deleted.' });
  });

  app.get('/api/clinical/prescriptions', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'PRESCRIPTIONS:VIEW', 'Prescriptions')) return;
    let prescriptions = await loadPrescriptionsHydrated();
    if (user.role === 'PATIENT') {
      prescriptions = prescriptions.filter((p) => p.patient_id === user.patient_id);
    } else if (user.role === 'DOCTOR' && user.doctor_id) {
      const bookedIds = await getBookedPatientIdsForDoctor(user.doctor_id).catch(
        () => new Set<number>(),
      );
      prescriptions = prescriptions.filter(
        (p) => p.doctor_id === user.doctor_id || bookedIds.has(p.patient_id),
      );
    }
    res.json({ status: 'success', prescriptions });
  });

  app.post('/api/clinical/prescriptions', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'PRESCRIPTIONS:CREATE', 'Create Prescription')) return;

    const idempotencyKey = String(
      req.headers['x-idempotency-key'] || req.body?.idempotency_key || '',
    ).trim();

    const initialStore = readClinicalStore();
    if (idempotencyKey && initialStore.prescription_idempotency[`POST:${idempotencyKey}`]) {
      const existingId = initialStore.prescription_idempotency[`POST:${idempotencyKey}`];
      const existingList = await loadPrescriptionsHydrated();
      const existingRx = existingList.find((p) => p.prescription_id === existingId);
      if (existingRx) {
        res.status(200).json({ status: 'success', prescription: existingRx, deduplicated: true });
        return;
      }
    }

    const patientId = Number(req.body?.patient_id);
    const patientName = String(req.body?.patient_name || '').trim();
    const appointmentId = Number(req.body?.appointment_id || 0);
    const appointmentRefInput = String(req.body?.appointment_ref || '').trim();
    const diagnosis = String(req.body?.diagnosis || '').trim();
    const medications = Array.isArray(req.body?.medications) ? req.body.medications : [];
    const instructions = String(req.body?.instructions || '').trim();

    if (!patientId || !diagnosis || medications.length === 0) {
      res.status(400).json({
        status: 'error',
        message: 'Patient, diagnosis, and at least one medication are required.',
      });
      return;
    }

    if (!appointmentRefInput && !appointmentId) {
      res.status(400).json({
        status: 'error',
        message: 'An appointment reference is required to issue a prescription.',
      });
      return;
    }

    try {
      const [rawAppts, rawSlots, templates, doctors, shiftStore] = await Promise.all([
        fetchOrdsItems<Appointment>('appointments'),
        fetchOrdsItems<Slot>('slots'),
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Doctor>('doctors'),
        loadShiftStoreHydrated(),
      ]);
      const joinedSlots = enrichSlots(
        attachDoctorIdsToSlots(rawSlots, templates, shiftStore),
        templates,
        doctors,
        [],
      );
      const enrichedAppts = enrichAppointments(
        attachConsultationMode(rawAppts),
        joinedSlots,
        doctors,
      );

      const matchedAppt = enrichedAppts.find(
        (a) =>
          (appointmentId > 0 && a.appointment_id === appointmentId) ||
          (appointmentRefInput && a.appointment_ref === appointmentRefInput),
      );

      if (!matchedAppt) {
        res.status(404).json({
          status: 'error',
          message: 'Associated appointment was not found.',
        });
        return;
      }

      if (matchedAppt.status === 'CANCELLED' || matchedAppt.status === 'NO_SHOW') {
        res.status(400).json({
          status: 'error',
          message: `Cannot issue prescription for an appointment with status ${matchedAppt.status}.`,
        });
        return;
      }

      if (user.role === 'DOCTOR') {
        if (!user.doctor_id || matchedAppt.doctor_id !== user.doctor_id) {
          res.status(403).json({
            status: 'error',
            message: 'Doctors can only issue prescriptions for appointments assigned to them.',
          });
          return;
        }
      }

      if (matchedAppt.patient_id !== patientId) {
        res.status(403).json({
          status: 'error',
          message: 'Selected patient does not match the patient assigned to this appointment.',
        });
        return;
      }

      if (
        !isAppointmentTimeReached(
          matchedAppt.slot_date,
          matchedAppt.start_time,
          new Date(),
          HOSPITAL_TIMEZONE,
        )
      ) {
        res.status(400).json({
          status: 'error',
          message: 'Prescription can only be issued after the scheduled appointment time.',
        });
        return;
      }

      const resolvedDoctorId = Number(matchedAppt.doctor_id || req.body?.doctor_id || user.doctor_id || 0);
      const resolvedDoctorName =
        String(matchedAppt.doctor_name || req.body?.doctor_name || user.full_name || '').trim() ||
        `Doctor #${resolvedDoctorId}`;
      const resolvedPatientName =
        String(matchedAppt.patient_name || patientName || '').trim() || `Patient #${patientId}`;
      const nowIso = new Date().toISOString();

      const store = readClinicalStore();
      if (idempotencyKey && store.prescription_idempotency[`POST:${idempotencyKey}`]) {
        const existingId = store.prescription_idempotency[`POST:${idempotencyKey}`];
        const existingList = await loadPrescriptionsHydrated();
        const existingRx = existingList.find((p) => p.prescription_id === existingId);
        if (existingRx) {
          res.status(200).json({ status: 'success', prescription: existingRx, deduplicated: true });
          return;
        }
      }

      const entry: PrescriptionEntry = {
        prescription_id: `RX-${Date.now()}`,
        patient_id: patientId,
        patient_name: resolvedPatientName,
        doctor_id: resolvedDoctorId,
        doctor_name: resolvedDoctorName,
        appointment_ref: matchedAppt.appointment_ref,
        prescribed_date: String(req.body?.prescribed_date || getServerTodayIso()).slice(0, 10),
        diagnosis,
        medications: medications.map((m: Record<string, unknown>) => ({
          name: String(m.name || '').trim(),
          dosage: String(m.dosage || '').trim(),
          frequency: String(m.frequency || '').trim(),
          duration: String(m.duration || '').trim(),
        })),
        instructions: instructions || 'Take medications as directed.',
        status: 'ACTIVE' as const,
        updated_at: nowIso,
      };

      // Step 1: Persist prescription to Oracle (with 404 fallback to local) BEFORE emitting notification
      try {
        const ordsRes = await fetchOrdsJson<{ status?: string; message?: string; prescription_id?: string; deduplicated?: boolean }>(
          'prescriptions',
          {
            method: 'POST',
            body: JSON.stringify(
              serializePrescriptionForOracle(entry, idempotencyKey ? `POST:${idempotencyKey}` : undefined),
            ),
          },
        );
        if (ordsRes?.status === 'error') {
          res.status(400).json({ status: 'error', message: ordsRes.message || 'Unable to save prescription in Oracle' });
          return;
        }
        if (ordsRes?.deduplicated && ordsRes.prescription_id) {
          const allRx = await loadPrescriptionsHydrated();
          const existingRx = allRx.find((p) => p.prescription_id === ordsRes.prescription_id) || entry;
          res.status(200).json({ status: 'success', prescription: existingRx, deduplicated: true });
          return;
        }
      } catch (err) {
        if (!isMissingOracleEndpointError(err)) {
          res.status(502).json({
            status: 'error',
            message: err instanceof Error ? err.message : 'Unable to persist prescription in Oracle',
          });
          return;
        }
      }

      store.prescriptions.unshift(entry);
      if (idempotencyKey) {
        store.prescription_idempotency[`POST:${idempotencyKey}`] = entry.prescription_id;
      }
      writeClinicalStore(store);

      // Step 2: Emit patient-only notification after prescription write succeeded
      const notifId = `rx-notif-create-${entry.prescription_id}`;
      if (!store.patient_notifications.some((n) => n.id === notifId)) {
        const notifRecord: PatientNotificationRecord = {
          id: notifId,
          patient_id: entry.patient_id,
          prescription_id: entry.prescription_id,
          event_type: 'CREATED',
          title: 'New Prescription Issued',
          message: `${entry.doctor_name} issued a new prescription for appointment ${entry.appointment_ref}. Please check your prescription in the Prescriptions section.`,
          doctor_name: entry.doctor_name,
          appointment_ref: entry.appointment_ref ?? null,
          created_at: nowIso,
          ...(idempotencyKey ? { idempotency_key: `POST:${idempotencyKey}` } : {}),
        };
        store.patient_notifications.unshift(notifRecord);
        writeClinicalStore(store);
      }

      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_role: user.role,
        target_label: `${entry.patient_name} (${entry.prescription_id})`,
        action: 'PRESCRIPTION_CREATED',
        category: 'CLINICAL',
        new_value: entry.diagnosis,
        details: `Issued prescription ${entry.prescription_id} for ${entry.appointment_ref} with ${entry.medications.length} medication(s).`,
        severity: 'info',
      });

      res.status(201).json({ status: 'success', prescription: entry });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to verify appointment for prescription',
      });
    }
  });

  app.put('/api/clinical/prescriptions/:id', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'PRESCRIPTIONS:UPDATE', 'Update Prescription')) return;

    const idempotencyKey = String(
      req.headers['x-idempotency-key'] || req.body?.idempotency_key || '',
    ).trim();

    const store = readClinicalStore();
    const allPrescriptions = await loadPrescriptionsHydrated();
    if (idempotencyKey && store.prescription_idempotency[`PUT:${idempotencyKey}`]) {
      const existingRx = allPrescriptions.find((p) => p.prescription_id === req.params.id);
      if (existingRx) {
        res.json({ status: 'success', prescription: existingRx, deduplicated: true });
        return;
      }
    }

    const current = allPrescriptions.find((p) => p.prescription_id === req.params.id);
    if (!current) {
      res.status(404).json({ status: 'error', message: 'Prescription not found.' });
      return;
    }
    if (user.role === 'DOCTOR' && user.doctor_id && current.doctor_id !== user.doctor_id) {
      res.status(403).json({
        status: 'error',
        message: 'Doctors can only update prescriptions they issued.',
      });
      return;
    }
    if (req.body?.patient_id && Number(req.body.patient_id) !== current.patient_id) {
      res.status(403).json({
        status: 'error',
        message: 'Prescription does not belong to the specified patient.',
      });
      return;
    }

    if (current.appointment_ref) {
      try {
        const [rawAppts, rawSlots, templates, doctors, shiftStore] = await Promise.all([
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Slot>('slots'),
          fetchSlotTemplatesSafe(),
          fetchOrdsItems<Doctor>('doctors'),
          loadShiftStoreHydrated(),
        ]);
        const joinedSlots = enrichSlots(
          attachDoctorIdsToSlots(rawSlots, templates, shiftStore),
          templates,
          doctors,
          [],
        );
        const enrichedAppts = enrichAppointments(rawAppts, joinedSlots, doctors);
        const linked = enrichedAppts.find((a) => a.appointment_ref === current.appointment_ref);
        if (linked && linked.patient_id !== current.patient_id) {
          res.status(403).json({
            status: 'error',
            message: 'Prescription patient mismatch with associated appointment.',
          });
          return;
        }
        if (
          linked &&
          linked.slot_date &&
          linked.start_time &&
          !isAppointmentTimeReached(linked.slot_date, linked.start_time, new Date(), HOSPITAL_TIMEZONE)
        ) {
          res.status(400).json({
            status: 'error',
            message: 'Prescription can only be issued after the scheduled appointment time.',
          });
          return;
        }
      } catch {
        // Proceed if ORDS appointment lookup transiently unavailable during update of existing prescription
      }
    }

    const nowIso = new Date().toISOString();
    const updatedRx: PrescriptionEntry = {
      ...current,
      diagnosis: String(req.body?.diagnosis ?? current.diagnosis).trim(),
      instructions: String(req.body?.instructions ?? current.instructions).trim(),
      status: req.body?.status === 'COMPLETED' ? ('COMPLETED' as const) : current.status,
      ...(Array.isArray(req.body?.medications) ? { medications: req.body.medications } : {}),
      updated_at: nowIso,
    };

    try {
      const ordsRes = await fetchOrdsJson<{ status?: string; message?: string }>(
        `prescriptions/${encodeURIComponent(req.params.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            diagnosis: updatedRx.diagnosis,
            instructions: updatedRx.instructions,
            status: updatedRx.status,
            medications: updatedRx.medications,
            medications_json: JSON.stringify(updatedRx.medications),
          }),
        },
      );
      if (ordsRes?.status === 'error') {
        res.status(400).json({ status: 'error', message: ordsRes.message || 'Unable to update prescription in Oracle' });
        return;
      }
    } catch (err) {
      if (!isMissingOracleEndpointError(err)) {
        res.status(502).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to update prescription in Oracle',
        });
        return;
      }
    }

    const idx = store.prescriptions.findIndex((p) => p.prescription_id === req.params.id);
    if (idx >= 0) {
      store.prescriptions[idx] = updatedRx;
    } else {
      store.prescriptions.unshift(updatedRx);
    }
    if (idempotencyKey) {
      store.prescription_idempotency[`PUT:${idempotencyKey}`] = updatedRx.prescription_id;
    }
    // Step 1: Persist updated prescription BEFORE creating notification
    writeClinicalStore(store);

    // Step 2: Emit patient-only notification after prescription update succeeds
    const updateNonce = idempotencyKey || `${nowIso}`;
    const notifId = `rx-notif-update-${updatedRx.prescription_id}-${updateNonce}`;
    const alreadyHasNotif =
      (idempotencyKey &&
        store.patient_notifications.some((n) => n.idempotency_key === `PUT:${idempotencyKey}`)) ||
      store.patient_notifications.some((n) => n.id === notifId);
    if (!alreadyHasNotif) {
      const notifRecord: PatientNotificationRecord = {
        id: notifId,
        patient_id: updatedRx.patient_id,
        prescription_id: updatedRx.prescription_id,
        event_type: 'UPDATED',
        title: 'Prescription Updated',
        message: `${updatedRx.doctor_name} updated your prescription${updatedRx.appointment_ref ? ` for appointment ${updatedRx.appointment_ref}` : ''}. Please check your prescription in the Prescriptions section.`,
        doctor_name: updatedRx.doctor_name,
        appointment_ref: updatedRx.appointment_ref ?? null,
        created_at: nowIso,
        ...(idempotencyKey ? { idempotency_key: `PUT:${idempotencyKey}` } : {}),
      };
      store.patient_notifications.unshift(notifRecord);
      writeClinicalStore(store);
    }

    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_role: user.role,
      target_label: `${updatedRx.patient_name} (${updatedRx.prescription_id})`,
      action: 'PRESCRIPTION_UPDATED',
      category: 'CLINICAL',
      new_value: updatedRx.diagnosis,
      details: `Updated prescription ${updatedRx.prescription_id}.`,
      severity: 'info',
    });

    res.json({ status: 'success', prescription: updatedRx });
  });

  app.delete('/api/clinical/prescriptions/:id', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'PRESCRIPTIONS:DELETE', 'Delete Prescription')) return;
    const allPrescriptions = await loadPrescriptionsHydrated();
    const current = allPrescriptions.find((p) => p.prescription_id === req.params.id);
    if (!current) {
      res.status(404).json({ status: 'error', message: 'Prescription not found.' });
      return;
    }

    try {
      const ordsRes = await fetchOrdsJson<{ status?: string; message?: string }>(
        `prescriptions/${encodeURIComponent(req.params.id)}`,
        { method: 'DELETE' },
      );
      if (ordsRes?.status === 'error') {
        res.status(400).json({ status: 'error', message: ordsRes.message || 'Unable to delete prescription in Oracle' });
        return;
      }
    } catch (err) {
      if (!isMissingOracleEndpointError(err)) {
        res.status(502).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to delete prescription in Oracle',
        });
        return;
      }
    }

    const store = readClinicalStore();
    const idx = store.prescriptions.findIndex((p) => p.prescription_id === req.params.id);
    if (idx >= 0) {
      store.prescriptions.splice(idx, 1);
      writeClinicalStore(store);
    }

    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_role: user.role,
      target_label: `${current.patient_name} (${current.prescription_id})`,
      action: 'PRESCRIPTION_DELETED',
      category: 'CLINICAL',
      details: `Deleted prescription ${current.prescription_id}.`,
      severity: 'warning',
    });
    res.json({ status: 'success', message: 'Prescription deleted.' });
  });

  // ============================================================================
  // GLOBAL CAREPULSE SIDECAR LAYER (/api/global/*) — ZERO MUTATION TO CORE APIs
  // ============================================================================
  const GLOBAL_ORDS_BASE_URL = ORDS_BASE_URL.includes('girish_opd_api')
    ? ORDS_BASE_URL.replace('girish_opd_api', 'girish_global_api')
    : `${ORDS_BASE_URL.replace(/\/+$/, '')}/global`;

  let cachedGlobalOrdsLive: { value: boolean; checkedAt: number } | null = null;

  function normalizeGlobalCurrencySymbol(currencyCode?: string | null, rawSymbol?: string | null): string {
    const code = String(currencyCode || '').trim().toUpperCase();
    if (code === 'INR') return '₹';
    if (code === 'GBP') return '£';
    if (code === 'SGD') return 'S$';
    if (code === 'USD') return '$';
    if (code === 'AED') return 'AED';
    return String(rawSymbol || code || '₹');
  }

  async function isGlobalOrdsModuleLive(forceCheck = false): Promise<boolean> {
    const now = Date.now();
    if (!forceCheck && cachedGlobalOrdsLive && now - cachedGlobalOrdsLive.checkedAt < 60_000) {
      return cachedGlobalOrdsLive.value;
    }
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${GLOBAL_ORDS_BASE_URL}/branches?limit=1`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(t);
      const live = res.ok;
      cachedGlobalOrdsLive = { value: live, checkedAt: now };
      return live;
    } catch {
      cachedGlobalOrdsLive = { value: false, checkedAt: now };
      return false;
    }
  }

  async function fetchGlobalOrdsCollection<T>(pathSuffix: string): Promise<T[]> {
    const clean = pathSuffix.replace(/^\/+/, '');
    const sep = clean.includes('?') ? '&' : '?';
    const res = await fetch(`${GLOBAL_ORDS_BASE_URL}/${clean}${sep}limit=500`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    let parsed: { items?: T[]; message?: string } = {};
    try {
      parsed = text ? (JSON.parse(text) as { items?: T[]; message?: string }) : {};
    } catch {
      // Non-JSON response
    }
    if (!res.ok) {
      throw new Error(parsed.message || `Global ORDS HTTP ${res.status}`);
    }
    return Array.isArray(parsed.items) ? parsed.items : [];
  }

  async function postGlobalOrdsJson<T extends { status?: string; message?: string }>(
    pathSuffix: string,
    payload: unknown,
  ): Promise<T> {
    const clean = pathSuffix.replace(/^\/+/, '');
    const res = await fetch(`${GLOBAL_ORDS_BASE_URL}/${clean}`, {
      method: 'POST',
      signal: AbortSignal.timeout(12_000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: T = {} as T;
    try {
      parsed = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      parsed = { status: 'error', message: text || `Global ORDS HTTP ${res.status}` } as T;
    }
    if (!res.ok || parsed.status === 'error') {
      throw new Error(normalizeOrdsError(parsed, parsed.message || `Global ORDS HTTP ${res.status}`));
    }
    return parsed;
  }

  async function syncGlobalDirectoryFromOracle(): Promise<{
    store: GlobalSidecarStoreData;
    live: boolean;
  }> {
    const store = readGlobalStore();
    const live = await isGlobalOrdsModuleLive();
    if (!live) {
      return { store, live: false };
    }
    try {
      const [rawCountries, rawBranches, rawBranchDepts, rawDocBranches] = await Promise.all([
        fetchGlobalOrdsCollection<GlobalCountry>('countries'),
        fetchGlobalOrdsCollection<GlobalBranch>('branches'),
        fetchGlobalOrdsCollection<GlobalBranchDepartment>('branch-departments'),
        fetchGlobalOrdsCollection<GlobalDoctorBranch>('doctor-branches'),
      ]);

      const countries: GlobalCountry[] = rawCountries.map((c) => ({
        country_id: Number(c.country_id),
        country_code: String(c.country_code || '').toUpperCase(),
        country_name: String(c.country_name || ''),
        currency_code: String(c.currency_code || '').toUpperCase(),
        currency_symbol: normalizeGlobalCurrencySymbol(c.currency_code, c.currency_symbol),
        phone_dial_code: String(c.phone_dial_code || '+1'),
        default_timezone: String(c.default_timezone || 'UTC'),
        fx_rate_to_inr: Number(c.fx_rate_to_inr || 1),
        is_active: c.is_active === 'N' ? 'N' : 'Y',
      }));

      const countryById = new Map(countries.map((c) => [c.country_id, c]));

      const branches: GlobalBranch[] = rawBranches.map((b) => {
        const c = countryById.get(Number(b.country_id));
        const currCode = String(b.currency_code || c?.currency_code || 'INR').toUpperCase();
        return {
          branch_id: Number(b.branch_id),
          country_id: Number(b.country_id),
          country_code: String(b.country_code || c?.country_code || ''),
          country_name: String(b.country_name || c?.country_name || ''),
          currency_symbol: normalizeGlobalCurrencySymbol(currCode, b.currency_symbol || c?.currency_symbol),
          fx_rate_to_inr: Number(b.fx_rate_to_inr ?? c?.fx_rate_to_inr ?? 1),
          branch_code: String(b.branch_code || ''),
          branch_name: String(b.branch_name || ''),
          city: String(b.city || ''),
          address_line: b.address_line ?? null,
          postal_code: b.postal_code ?? null,
          phone: b.phone ?? null,
          email: b.email ?? null,
          timezone_iana: String(b.timezone_iana || c?.default_timezone || 'UTC'),
          currency_code: currCode,
          is_headquarters: b.is_headquarters === 'Y' ? 'Y' : 'N',
          is_active: b.is_active === 'N' ? 'N' : 'Y',
        };
      });

      const branchDepts: GlobalBranchDepartment[] = rawBranchDepts.map((bd) => ({
        branch_dept_id: Number(bd.branch_dept_id),
        branch_id: Number(bd.branch_id),
        department_id: Number(bd.department_id),
        department_name: bd.department_name,
        is_specialized: bd.is_specialized === 'Y' ? 'Y' : 'N',
        local_consultation_fee:
          bd.local_consultation_fee !== null && bd.local_consultation_fee !== undefined
            ? Number(bd.local_consultation_fee)
            : null,
        is_active: bd.is_active === 'N' ? 'N' : 'Y',
      }));

      const docBranches: GlobalDoctorBranch[] = rawDocBranches.map((db) => ({
        doc_branch_id: Number(db.doc_branch_id),
        doctor_id: Number(db.doctor_id),
        doctor_name: db.doctor_name,
        branch_id: Number(db.branch_id),
        is_primary_branch: db.is_primary_branch === 'Y' ? 'Y' : 'N',
        local_consultation_fee:
          db.local_consultation_fee !== null && db.local_consultation_fee !== undefined
            ? Number(db.local_consultation_fee)
            : null,
        is_active: db.is_active === 'N' ? 'N' : 'Y',
      }));

      const syncedStore: GlobalSidecarStoreData = {
        ...store,
        countries: countries.length > 0 ? countries : store.countries,
        branches: branches.length > 0 ? branches : store.branches,
        branch_departments: branchDepts,
        doctor_branches: docBranches,
      };
      writeGlobalStore(syncedStore);
      return { store: syncedStore, live: true };
    } catch {
      return { store, live: false };
    }
  }

  app.get('/api/global/public-context', async (_req, res) => {
    const { store } = await syncGlobalDirectoryFromOracle();
    const hq = getHeadquartersBranch(store.branches);
    res.json({
      status: 'success',
      headquarters_branch_id: hq?.branch_id ?? 1,
      countries: store.countries.filter((c) => c.is_active === 'Y'),
      branches: store.branches.filter((b) => b.is_active === 'Y'),
    });
  });

  app.get('/api/global/context', requireAuth, async (_req, res) => {
    const { store, live } = await syncGlobalDirectoryFromOracle();
    const hq = getHeadquartersBranch(store.branches);
    res.json({
      status: 'success',
      global_ords_live: live,
      headquarters_branch_id: hq?.branch_id ?? 1,
      countries: store.countries,
      branches: store.branches,
      branch_departments: store.branch_departments,
      doctor_branches: store.doctor_branches,
    });
  });

  app.post('/api/global/countries', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only administrators can manage countries.' });
      return;
    }
    const code = String(req.body?.country_code || '').trim().toUpperCase();
    const name = String(req.body?.country_name || '').trim();
    const currencyCode = String(req.body?.currency_code || '').trim().toUpperCase();
    const currencySymbol = String(req.body?.currency_symbol || currencyCode).trim();
    const dialCode = String(req.body?.phone_dial_code || '+1').trim();
    const tz = String(req.body?.default_timezone || 'UTC').trim();
    const fx = Number(req.body?.fx_rate_to_inr || 1);
    if (!code || !name || !currencyCode || !(fx > 0)) {
      res.status(400).json({ status: 'error', message: 'Country code, name, currency code, and positive FX rate are required.' });
      return;
    }

    const { store, live } = await syncGlobalDirectoryFromOracle();
    const existing = store.countries.find((c) => c.country_code === code);
    const payload = {
      country_code: code,
      country_name: name,
      currency_code: currencyCode,
      currency_symbol: currencySymbol,
      phone_dial_code: dialCode,
      default_timezone: tz,
      fx_rate_to_inr: fx,
    };

    if (live) {
      try {
        await postGlobalOrdsJson('countries', payload);
        const refreshed = await syncGlobalDirectoryFromOracle();
        const savedOracle = refreshed.store.countries.find((c) => c.country_code === code);
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: `${name} (${code})`,
          action: existing ? 'GLOBAL_COUNTRY_UPDATED' : 'GLOBAL_COUNTRY_CREATED',
          category: 'OPERATIONS',
          details: `${user.full_name} saved country ${name} (${code} · ${currencyCode}) in Oracle GBR_COUNTRIES.`,
          severity: 'info',
        });
        res.json({ status: 'success', country: savedOracle || payload });
        return;
      } catch (err) {
        res.status(400).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to save country in Oracle.',
        });
        return;
      }
    }

    let saved: GlobalCountry;
    if (existing) {
      existing.country_name = name;
      existing.currency_code = currencyCode;
      existing.currency_symbol = currencySymbol;
      existing.phone_dial_code = dialCode;
      existing.default_timezone = tz;
      existing.fx_rate_to_inr = fx;
      existing.is_active = req.body?.is_active === 'N' ? 'N' : 'Y';
      saved = existing;
    } else {
      saved = {
        country_id: getNextNumericId(store.countries as unknown as Array<Record<string, unknown>>, 'country_id'),
        ...payload,
        is_active: 'Y',
      };
      store.countries.push(saved);
    }
    writeGlobalStore(store);
    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_email: user.email,
      actor_role: user.role,
      target_label: `${name} (${code})`,
      action: existing ? 'GLOBAL_COUNTRY_UPDATED' : 'GLOBAL_COUNTRY_CREATED',
      category: 'OPERATIONS',
      details: `${user.full_name} saved country ${name} (${code} · ${currencyCode}).`,
      severity: 'info',
    });
    res.json({ status: 'success', country: saved });
  });

  app.post('/api/global/branches', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only administrators can create branches.' });
      return;
    }
    const { store, live } = await syncGlobalDirectoryFromOracle();
    const countryId = Number(req.body?.country_id);
    const country = store.countries.find((c) => c.country_id === countryId);
    const branchCode = String(req.body?.branch_code || '').trim().toUpperCase();
    const branchName = String(req.body?.branch_name || '').trim();
    const city = String(req.body?.city || '').trim();
    if (!country || !branchCode || !branchName || !city) {
      res.status(400).json({ status: 'error', message: 'Valid country, branch code, branch name, and city are required.' });
      return;
    }
    if (store.branches.some((b) => b.branch_code === branchCode)) {
      res.status(409).json({ status: 'error', message: `Branch code ${branchCode} already exists.` });
      return;
    }

    const oraclePayload = {
      country_id: country.country_id,
      branch_code: branchCode,
      branch_name: branchName,
      city,
      address_line: req.body?.address_line ? String(req.body.address_line).trim() : null,
      postal_code: req.body?.postal_code ? String(req.body.postal_code).trim() : null,
      phone: req.body?.phone ? String(req.body.phone).trim() : null,
      email: req.body?.email ? String(req.body.email).trim() : null,
      timezone_iana: String(req.body?.timezone_iana || country.default_timezone).trim(),
      currency_code: String(req.body?.currency_code || country.currency_code).trim().toUpperCase(),
    };

    if (live) {
      try {
        await postGlobalOrdsJson<{ status: string; branch_id?: number }>('branches', oraclePayload);
        const refreshed = await syncGlobalDirectoryFromOracle();
        const createdOracle = refreshed.store.branches.find((b) => b.branch_code === branchCode);
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: `${branchName} (${branchCode})`,
          action: 'GLOBAL_BRANCH_CREATED',
          category: 'OPERATIONS',
          details: `${user.full_name} created branch ${branchName} in ${city}, ${country.country_name} (${oraclePayload.currency_code}) in Oracle GBR_BRANCHES.`,
          severity: 'info',
        });
        res.json({ status: 'success', branch: createdOracle || oraclePayload });
        return;
      } catch (err) {
        res.status(400).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to create branch in Oracle.',
        });
        return;
      }
    }

    const created: GlobalBranch = {
      branch_id: getNextNumericId(store.branches as unknown as Array<Record<string, unknown>>, 'branch_id'),
      country_id: country.country_id,
      country_code: country.country_code,
      country_name: country.country_name,
      currency_symbol: country.currency_symbol,
      fx_rate_to_inr: country.fx_rate_to_inr,
      branch_code: branchCode,
      branch_name: branchName,
      city,
      address_line: oraclePayload.address_line,
      postal_code: oraclePayload.postal_code,
      phone: oraclePayload.phone,
      email: oraclePayload.email,
      timezone_iana: oraclePayload.timezone_iana,
      currency_code: oraclePayload.currency_code,
      is_headquarters: 'N',
      is_active: 'Y',
    };
    store.branches.push(created);
    writeGlobalStore(store);
    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_email: user.email,
      actor_role: user.role,
      target_label: `${branchName} (${branchCode})`,
      action: 'GLOBAL_BRANCH_CREATED',
      category: 'OPERATIONS',
      details: `${user.full_name} created branch ${branchName} in ${city}, ${country.country_name} (${created.currency_code}).`,
      severity: 'info',
    });
    res.json({ status: 'success', branch: created });
  });

  app.put('/api/global/branches/:id', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only administrators can update branches.' });
      return;
    }
    const branchId = Number(req.params.id);
    const { store } = await syncGlobalDirectoryFromOracle();
    const target = store.branches.find((b) => b.branch_id === branchId);
    if (!target) {
      res.status(404).json({ status: 'error', message: 'Branch not found.' });
      return;
    }
    if (target.is_headquarters === 'Y' && req.body?.is_active === 'N') {
      res.status(400).json({ status: 'error', message: 'Headquarters branch cannot be deactivated.' });
      return;
    }
    if (req.body?.branch_name) target.branch_name = String(req.body.branch_name).trim();
    if (req.body?.city) target.city = String(req.body.city).trim();
    if (req.body?.address_line !== undefined) target.address_line = req.body.address_line ? String(req.body.address_line).trim() : null;
    if (req.body?.phone !== undefined) target.phone = req.body.phone ? String(req.body.phone).trim() : null;
    if (req.body?.email !== undefined) target.email = req.body.email ? String(req.body.email).trim() : null;
    if (req.body?.timezone_iana) target.timezone_iana = String(req.body.timezone_iana).trim();
    if (req.body?.is_active === 'Y' || req.body?.is_active === 'N') target.is_active = req.body.is_active;
    writeGlobalStore(store);
    res.json({ status: 'success', branch: target });
  });

  app.post('/api/global/branch-departments', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only administrators can assign branch departments.' });
      return;
    }
    const branchId = Number(req.body?.branch_id);
    const departmentId = Number(req.body?.department_id);
    if (!branchId || !departmentId) {
      res.status(400).json({ status: 'error', message: 'branch_id and department_id are required.' });
      return;
    }
    const { store, live } = await syncGlobalDirectoryFromOracle();
    if (!store.branches.some((b) => b.branch_id === branchId)) {
      res.status(404).json({ status: 'error', message: 'Branch not found.' });
      return;
    }
    const isSpecialized = req.body?.is_specialized === 'N' ? 'N' : 'Y';
    const isActive = req.body?.is_active === 'N' ? 'N' : 'Y';
    const localFee =
      req.body?.local_consultation_fee != null && req.body.local_consultation_fee !== ''
        ? Number(req.body.local_consultation_fee)
        : null;

    if (live) {
      try {
        await postGlobalOrdsJson('branch-departments', {
          branch_id: branchId,
          department_id: departmentId,
          is_specialized: isSpecialized,
          local_consultation_fee: localFee,
          is_active: isActive,
        });
        const refreshed = await syncGlobalDirectoryFromOracle();
        const savedMapping = refreshed.store.branch_departments.find(
          (bd) => bd.branch_id === branchId && bd.department_id === departmentId,
        );
        res.json({ status: 'success', mapping: savedMapping });
        return;
      } catch (err) {
        res.status(400).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to assign department to branch in Oracle.',
        });
        return;
      }
    }

    let mapping = store.branch_departments.find(
      (bd) => bd.branch_id === branchId && bd.department_id === departmentId,
    );
    if (mapping) {
      mapping.is_specialized = isSpecialized;
      mapping.local_consultation_fee = localFee;
      mapping.is_active = isActive;
    } else {
      mapping = {
        branch_dept_id: getNextNumericId(
          store.branch_departments as unknown as Array<Record<string, unknown>>,
          'branch_dept_id',
        ),
        branch_id: branchId,
        department_id: departmentId,
        is_specialized: isSpecialized,
        local_consultation_fee: localFee,
        is_active: isActive,
      };
      store.branch_departments.push(mapping);
    }
    writeGlobalStore(store);
    res.json({ status: 'success', mapping });
  });

  app.post('/api/global/doctor-branches', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only administrators can assign doctors to branches.' });
      return;
    }
    const doctorId = Number(req.body?.doctor_id);
    const branchId = Number(req.body?.branch_id);
    if (!doctorId || !branchId) {
      res.status(400).json({ status: 'error', message: 'doctor_id and branch_id are required.' });
      return;
    }
    const { store, live } = await syncGlobalDirectoryFromOracle();
    if (!store.branches.some((b) => b.branch_id === branchId)) {
      res.status(404).json({ status: 'error', message: 'Branch not found.' });
      return;
    }
    const isPrimary = req.body?.is_primary_branch === 'Y' ? 'Y' : 'N';
    const isActive = req.body?.is_active === 'N' ? 'N' : 'Y';
    const localFee =
      req.body?.local_consultation_fee != null && req.body.local_consultation_fee !== ''
        ? Number(req.body.local_consultation_fee)
        : null;

    if (live) {
      try {
        await postGlobalOrdsJson('doctor-branches', {
          doctor_id: doctorId,
          branch_id: branchId,
          is_primary_branch: isPrimary,
          local_consultation_fee: localFee,
          is_active: isActive,
        });
        const refreshed = await syncGlobalDirectoryFromOracle();
        const savedMapping = refreshed.store.doctor_branches.find(
          (db) => db.doctor_id === doctorId && db.branch_id === branchId,
        );
        res.json({ status: 'success', mapping: savedMapping });
        return;
      } catch (err) {
        res.status(400).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to assign doctor to branch in Oracle.',
        });
        return;
      }
    }

    if (isPrimary === 'Y') {
      for (const row of store.doctor_branches) {
        if (row.doctor_id === doctorId && row.branch_id !== branchId) {
          row.is_primary_branch = 'N';
        }
      }
    }

    let mapping = store.doctor_branches.find(
      (db) => db.doctor_id === doctorId && db.branch_id === branchId,
    );
    if (mapping) {
      mapping.is_primary_branch = isPrimary;
      mapping.local_consultation_fee = localFee;
      mapping.is_active = isActive;
    } else {
      mapping = {
        doc_branch_id: getNextNumericId(
          store.doctor_branches as unknown as Array<Record<string, unknown>>,
          'doc_branch_id',
        ),
        doctor_id: doctorId,
        branch_id: branchId,
        is_primary_branch: isPrimary,
        local_consultation_fee: localFee,
        is_active: isActive,
      };
      store.doctor_branches.push(mapping);
    }
    writeGlobalStore(store);
    res.json({ status: 'success', mapping });
  });

  app.get('/api/global/slots', requireAuth, async (req, res) => {
    try {
      const branchIdParam = req.query.branch_id ? Number(req.query.branch_id) : null;
      const [{ store, live }, rawSlots, templates] = await Promise.all([
        syncGlobalDirectoryFromOracle(),
        fetchOrdsItems<Slot>('slots'),
        fetchSlotTemplatesSafe(),
      ]);

      const mergedSlotBranchMap: Record<string, number> = { ...store.slot_branch_map };
      if (live) {
        const oracleGlobalSlots = await fetchGlobalOrdsCollection<{
          slot_id: number;
          branch_id: number;
          branch_resolution?: string;
        }>('slots').catch(() => []);
        for (const gs of oracleGlobalSlots) {
          if (gs.branch_resolution === 'LINKED' && gs.branch_id) {
            mergedSlotBranchMap[String(gs.slot_id)] = Number(gs.branch_id);
          }
        }
      }

      const shiftStore = readShiftStore();
      const slotsWithDoc = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      let enriched = enrichSlotsWithBranch(
        slotsWithDoc,
        mergedSlotBranchMap,
        store.branches,
        store.countries,
      );
      if (branchIdParam) {
        enriched = enriched.filter((s) => s.branch_meta?.branch_id === branchIdParam);
      }
      res.json({ status: 'success', items: enriched });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to load global slots.',
      });
    }
  });

  app.post('/api/global/slots', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'SLOTS:CREATE', 'Global Branch Slot')) return;
    const doctorId = Number(req.body?.doctor_id);
    const branchId = Number(req.body?.branch_id);
    const slotDate = String(req.body?.slot_date || '').slice(0, 10);
    const startTime = String(req.body?.start_time || '').slice(0, 5);
    const endTime = String(req.body?.end_time || startTime).slice(0, 5);
    const maxPatients = Math.max(1, Number(req.body?.max_patients_per_slot || 1));

    const { store, live } = await syncGlobalDirectoryFromOracle();
    const branch = store.branches.find((b) => b.branch_id === branchId && b.is_active === 'Y');
    if (!branch) {
      res.status(400).json({ status: 'error', message: 'Selected branch is inactive or does not exist.' });
      return;
    }

    try {
      let createdSlotId = 0;
      if (live) {
        const globalSlotRes = await postGlobalOrdsJson<{ status: string; slot_id?: number }>('slots', {
          doctor_id: doctorId,
          branch_id: branch.branch_id,
          slot_date: slotDate,
          start_time: startTime,
          end_time: endTime,
          max_patients_per_slot: maxPatients,
        });
        createdSlotId = Number(globalSlotRes.slot_id || 0);
      } else {
        const upstreamRes = await fetchOrdsJson<{ status?: string; message?: string; slot_id?: number }>('slots', {
          method: 'POST',
          body: JSON.stringify({
            doctor_id: doctorId,
            slot_date: slotDate,
            start_time: startTime,
            end_time: endTime,
            max_patients_per_slot: maxPatients,
          }),
        });
        if (upstreamRes?.status === 'error') {
          res.status(400).json({ status: 'error', message: upstreamRes.message || 'Slot creation failed.' });
          return;
        }
        createdSlotId = Number(upstreamRes?.slot_id || 0);
      }

      if (!createdSlotId) {
        const latestSlots = await fetchOrdsItems<Slot>('slots');
        const matched = latestSlots
          .filter(
            (s) =>
              Number(s.doctor_id) === doctorId &&
              getIsoDatePart(s.slot_date) === slotDate &&
              String(s.start_time || '').slice(0, 5) === startTime,
          )
          .sort((a, b) => b.slot_id - a.slot_id)[0];
        if (matched) createdSlotId = matched.slot_id;
      }

      if (createdSlotId > 0) {
        store.slot_branch_map[String(createdSlotId)] = branch.branch_id;
        writeGlobalStore(store);
      }

      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_email: user.email,
        actor_role: user.role,
        target_label: `Slot #${createdSlotId || 'NEW'} (${branch.branch_code})`,
        action: 'GLOBAL_BRANCH_SLOT_CREATED',
        category: 'SHIFTS_LEAVES',
        details: `${user.full_name} created slot for Doctor #${doctorId} on ${slotDate} ${startTime}-${endTime} at ${branch.branch_name}.`,
        severity: 'info',
      });

      res.json({
        status: 'success',
        slot_id: createdSlotId || null,
        branch_id: branch.branch_id,
        branch_code: branch.branch_code,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to create branch slot.',
      });
    }
  });

  app.get('/api/global/appointments', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const branchIdParam = req.query.branch_id ? Number(req.query.branch_id) : null;
    try {
      await ensureOverdueHoldsExpired();
      const [{ store, live }, rawAppts, rawPayments, rawSlots, templates, doctors, departments] =
        await Promise.all([
          syncGlobalDirectoryFromOracle(),
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Payment>('payments').catch(() => [] as Payment[]),
          fetchOrdsItems<Slot>('slots'),
          fetchSlotTemplatesSafe(),
          fetchOrdsItems<Doctor>('doctors'),
          fetchOrdsItems<Department>('departments/'),
        ]);

      const mergedSlotBranchMap: Record<string, number> = { ...store.slot_branch_map };
      const mergedApptBranchMap: Record<string, { branch_id: number; consultation_mode?: string }> = {
        ...store.appt_branch_map,
      };
      const mergedPayBranchMap: Record<string, GlobalPaymentBranchLink> = {
        ...store.payment_branch_map,
      };

      if (live) {
        const [oracleGlobalAppts, oracleGlobalSlots, oracleGlobalPays] = await Promise.all([
          fetchGlobalOrdsCollection<{
            appointment_id: number;
            appointment_ref?: string;
            branch_id: number;
            consultation_mode?: string;
            branch_resolution?: string;
          }>('appointments').catch(() => []),
          fetchGlobalOrdsCollection<{
            slot_id: number;
            branch_id: number;
            branch_resolution?: string;
          }>('slots').catch(() => []),
          fetchGlobalOrdsCollection<{
            appointment_id: number;
            branch_id: number;
            local_currency: string;
            local_amount: number;
            base_inr_amount: number;
            fx_rate_to_inr: number;
            created_on?: string;
          }>('payments').catch(() => []),
        ]);
        for (const gs of oracleGlobalSlots) {
          if (gs.branch_resolution === 'LINKED' && gs.branch_id) {
            mergedSlotBranchMap[String(gs.slot_id)] = Number(gs.branch_id);
          }
        }
        for (const ga of oracleGlobalAppts) {
          if (ga.branch_resolution === 'LINKED' && ga.branch_id) {
            mergedApptBranchMap[String(ga.appointment_id)] = {
              branch_id: Number(ga.branch_id),
              consultation_mode: ga.consultation_mode,
            };
          }
        }
        for (const gp of oracleGlobalPays) {
          if (gp.appointment_id && gp.local_currency && gp.local_amount != null) {
            mergedPayBranchMap[String(gp.appointment_id)] = {
              appointment_id: Number(gp.appointment_id),
              branch_id: Number(gp.branch_id),
              local_currency: gp.local_currency,
              local_amount: Number(gp.local_amount),
              base_inr_amount: Number(gp.base_inr_amount),
              fx_rate_to_inr: Number(gp.fx_rate_to_inr || 1),
              created_on: gp.created_on,
            };
          }
        }
      }

      const shiftStore = readShiftStore();
      const fullSlots = enrichSlots(
        attachDoctorIdsToSlots(rawSlots, templates, shiftStore),
        templates,
        doctors,
        departments,
      );
      let appts = enrichAppointments(attachConsultationMode(rawAppts, rawPayments), fullSlots, doctors);
      if (user.role === 'PATIENT') {
        appts = appts.filter((a) => a.patient_id === user.patient_id);
      } else if (user.role === 'DOCTOR') {
        appts = appts.filter((a) => a.doctor_id === user.doctor_id);
      }

      let enriched = enrichAppointmentsWithBranch(
        appts,
        mergedApptBranchMap,
        mergedSlotBranchMap,
        mergedPayBranchMap,
        store.branches,
        store.countries,
      );
      if (branchIdParam) {
        enriched = enriched.filter((a) => a.branch_meta?.branch_id === branchIdParam);
      }
      res.json({ status: 'success', items: enriched });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to load global appointments.',
      });
    }
  });

  app.post('/api/global/appointments', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'APPOINTMENTS:CREATE', 'Global Branch Booking')) return;
    const patientId =
      user.role === 'PATIENT' ? Number(user.patient_id || req.body?.patient_id) : Number(req.body?.patient_id);
    const slotId = Number(req.body?.slot_id);
    const branchId = Number(req.body?.branch_id);
    const bookingSource =
      String(req.body?.booking_source || (user.role === 'PATIENT' ? 'ONLINE' : 'WALK_IN')).toUpperCase() === 'WALK_IN'
        ? 'WALK_IN'
        : 'ONLINE';
    const consultationMode =
      String(req.body?.consultation_mode || 'FACE_TO_FACE').toUpperCase() === 'ONLINE'
        ? 'ONLINE'
        : 'FACE_TO_FACE';

    const { store, live } = await syncGlobalDirectoryFromOracle();
    const branch = store.branches.find((b) => b.branch_id === branchId && b.is_active === 'Y');
    if (!branch) {
      res.status(400).json({ status: 'error', message: 'Selected hospital branch is inactive or invalid.' });
      return;
    }

    try {
      let createdApptId = 0;
      let createdApptRef = '';

      if (live) {
        const globalBookRes = await postGlobalOrdsJson<{
          status: string;
          appointment_id?: number;
          appointment_ref?: string;
        }>('appointments', {
          patient_id: patientId,
          slot_id: slotId,
          branch_id: branch.branch_id,
          booking_source: bookingSource,
          consultation_mode: consultationMode,
        });
        createdApptId = Number(globalBookRes.appointment_id || 0);
        createdApptRef = String(globalBookRes.appointment_ref || '');
      } else {
        const slotLinkedBranchId = store.slot_branch_map[String(slotId)];
        const hqBranch = getHeadquartersBranch(store.branches);
        const effectiveSlotBranchId = slotLinkedBranchId ?? hqBranch?.branch_id ?? 1;
        if (effectiveSlotBranchId !== branch.branch_id) {
          res.status(400).json({ status: 'error', message: 'Selected slot does not belong to the chosen branch.' });
          return;
        }
        const bookRes = await fetchOrdsJson<{
          status?: string;
          message?: string;
          appointment_ref?: string;
          appointment_id?: number;
        }>('appointments/', {
          method: 'POST',
          body: JSON.stringify({
            patient_id: patientId,
            slot_id: slotId,
            booking_source: bookingSource,
            consultation_mode: consultationMode,
          }),
        });
        if (bookRes?.status === 'error') {
          res.status(400).json({ status: 'error', message: bookRes.message || 'Booking failed.' });
          return;
        }
        createdApptId = Number(bookRes?.appointment_id || 0);
        createdApptRef = String(bookRes?.appointment_ref || '');
      }

      const appts = await fetchOrdsItems<Appointment>('appointments');
      const created =
        (createdApptId ? appts.find((a) => a.appointment_id === createdApptId) : undefined) ||
        (createdApptRef ? appts.find((a) => a.appointment_ref === createdApptRef) : undefined) ||
        appts
          .filter((a) => a.patient_id === patientId && a.slot_id === slotId && a.status !== 'CANCELLED')
          .sort((a, b) => b.appointment_id - a.appointment_id)[0];

      if (created) {
        saveAppointmentMetadata({
          consultation_mode: consultationMode,
          rescheduled_from_id: null,
          appointment_ref: created.appointment_ref,
          appointment_id: created.appointment_id,
          patient_id: created.patient_id,
          slot_id: created.slot_id,
          updated_at: new Date().toISOString(),
        });
        store.appt_branch_map[String(created.appointment_id)] = {
          branch_id: branch.branch_id,
          consultation_mode: consultationMode,
        };
        store.appt_branch_map[created.appointment_ref] = {
          branch_id: branch.branch_id,
          consultation_mode: consultationMode,
        };
        writeGlobalStore(store);

        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: `${created.appointment_ref} (${branch.branch_code})`,
          action: 'GLOBAL_APPOINTMENT_BOOKED',
          category: 'APPOINTMENTS',
          details: `${user.full_name} booked ${created.appointment_ref} at ${branch.branch_name} (${branch.country_name}) [${consultationMode}].`,
          severity: 'info',
        });
      }

      res.json({
        status: 'success',
        appointment_id: created?.appointment_id ?? (createdApptId || null),
        appointment_ref: created?.appointment_ref ?? (createdApptRef || null),
        branch_id: branch.branch_id,
        branch_code: branch.branch_code,
        branch_name: branch.branch_name,
        currency_code: branch.currency_code,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to complete global branch booking.',
      });
    }
  });

  app.post('/api/global/appointments/:id/pay-and-confirm', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const apptId = Number(req.params.id);
    if (!apptId) {
      res.status(400).json({ status: 'error', message: 'Invalid appointment ID.' });
      return;
    }
    const allowedPerms =
      user.role === 'PATIENT' ? ['APPOINTMENTS:UPDATE', 'APPOINTMENTS:CREATE'] : ['APPOINTMENTS:UPDATE'];
    if (!requireAnyPermission(user, res, allowedPerms, `Global Pay & Confirm #${apptId}`)) return;

    const rawMethod = String(req.body?.payment_method || 'UPI').trim().toUpperCase();
    const paymentMethod = ['UPI', 'CARD', 'NET_BANKING', 'CASH'].includes(rawMethod) ? rawMethod : 'UPI';

    try {
      await ensureOverdueHoldsExpired();
      const [{ store, live }, rawAppts, rawSlots, templates, doctors, departments, existingPayments] =
        await Promise.all([
          syncGlobalDirectoryFromOracle(),
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Slot>('slots'),
          fetchSlotTemplatesSafe(),
          fetchOrdsItems<Doctor>('doctors'),
          fetchOrdsItems<Department>('departments/'),
          fetchOrdsItems<Payment>('payments').catch(() => [] as Payment[]),
        ]);
      const shiftStore = readShiftStore();
      const fullSlots = enrichSlots(
        attachDoctorIdsToSlots(rawSlots, templates, shiftStore),
        templates,
        doctors,
        departments,
      );
      const enrichedAppts = enrichAppointments(
        attachConsultationMode(rawAppts, existingPayments),
        fullSlots,
        doctors,
      );
      const targetAppt = enrichedAppts.find((a) => a.appointment_id === apptId);
      if (!targetAppt) {
        res.status(404).json({ status: 'error', message: 'Appointment not found.' });
        return;
      }
      if (user.role === 'PATIENT' && targetAppt.patient_id !== user.patient_id) {
        res.status(403).json({ status: 'error', message: 'Patients can only pay for their own appointments.' });
        return;
      }
      if (isAppointmentHoldExpired(targetAppt)) {
        await ensureOverdueHoldsExpired({ force: true });
        res.status(409).json({
          status: 'error',
          code: 'HOLD_EXPIRED',
          message: 'This 10-minute booking hold has expired and the slot has been released.',
        });
        return;
      }

      let oracleApptBranchId: number | undefined;
      if (live) {
        const oracleAppts = await fetchGlobalOrdsCollection<{
          appointment_id: number;
          branch_id: number;
          branch_resolution?: string;
        }>('appointments').catch(() => []);
        const match = oracleAppts.find((a) => Number(a.appointment_id) === apptId);
        if (match?.branch_id) oracleApptBranchId = Number(match.branch_id);
      }

      const requestedBranchId = req.body?.branch_id ? Number(req.body.branch_id) : undefined;
      const linkedBranchId =
        requestedBranchId ??
        oracleApptBranchId ??
        store.appt_branch_map[String(apptId)]?.branch_id ??
        store.slot_branch_map[String(targetAppt.slot_id)] ??
        getHeadquartersBranch(store.branches)?.branch_id ??
        1;
      const branch =
        store.branches.find((b) => b.branch_id === linkedBranchId) ||
        getHeadquartersBranch(store.branches);
      const doc = doctors.find((d) => d.doctor_id === targetAppt.doctor_id);
      const feeInfo = getDoctorEffectiveBranchFee({
        doctor: doc,
        branch,
        countries: store.countries,
        doctorBranches: store.doctor_branches,
        branchDepartments: store.branch_departments,
      });

      const alreadyPaid = existingPayments.find((p) => p.appointment_id === apptId && p.status === 'SUCCESS');
      let paymentRef = alreadyPaid?.payment_ref || '';
      if (!alreadyPaid) {
        if (live) {
          const globalPayRes = await postGlobalOrdsJson<{
            status: string;
            payment_id?: number;
            payment_ref?: string;
          }>('payments', {
            appointment_id: apptId,
            branch_id: branch?.branch_id ?? 1,
            payment_method: paymentMethod,
            local_currency: feeInfo.currency_code,
            local_amount: feeInfo.local_amount,
            base_inr_amount: feeInfo.base_inr_amount,
            fx_rate_to_inr: feeInfo.fx_rate_to_inr,
          });
          paymentRef = globalPayRes.payment_ref || `PAY${Date.now()}`;
        } else {
          const payRes = await fetchOrdsJson<{ status?: string; message?: string; payment_ref?: string }>(
            'payments',
            {
              method: 'POST',
              body: JSON.stringify({
                appointment_id: apptId,
                amount: feeInfo.base_inr_amount,
                payment_method: paymentMethod,
                status: 'SUCCESS',
              }),
            },
          );
          if (payRes?.status === 'error') {
            res.status(400).json({ status: 'error', message: payRes.message || 'Payment failed.' });
            return;
          }
          paymentRef = payRes.payment_ref || `PAY${Date.now()}`;

          const refreshedAppts = await fetchOrdsItems<Appointment>('appointments').catch(() => [] as Appointment[]);
          const latest = refreshedAppts.find((a) => a.appointment_id === apptId);
          if (latest && latest.status === 'HELD') {
            await fetchOrdsJson(`appointments/${apptId}/confirm`, {
              method: 'POST',
              body: JSON.stringify({}),
            });
          }
        }
      }

      const paidAt = new Date().toISOString();
      saveAppointmentMetadata({
        consultation_mode: targetAppt.consultation_mode || 'FACE_TO_FACE',
        rescheduled_from_id: targetAppt.rescheduled_from_id ?? null,
        appointment_ref: targetAppt.appointment_ref,
        appointment_id: apptId,
        patient_id: targetAppt.patient_id,
        slot_id: targetAppt.slot_id,
        payment_status: 'SUCCESS',
        paid_amount: feeInfo.base_inr_amount,
        payment_ref: paymentRef,
        payment_method: paymentMethod,
        paid_at: paidAt,
        updated_at: paidAt,
      });

      const payLink: GlobalPaymentBranchLink = {
        appointment_id: apptId,
        branch_id: branch?.branch_id ?? 1,
        local_currency: feeInfo.currency_code,
        local_amount: feeInfo.local_amount,
        base_inr_amount: feeInfo.base_inr_amount,
        fx_rate_to_inr: feeInfo.fx_rate_to_inr,
        created_on: paidAt,
      };
      store.payment_branch_map[String(apptId)] = payLink;
      if (branch) {
        store.appt_branch_map[String(apptId)] = {
          branch_id: branch.branch_id,
          consultation_mode: targetAppt.consultation_mode || 'FACE_TO_FACE',
        };
      }
      writeGlobalStore(store);

      res.json({
        status: 'success',
        appointment_id: apptId,
        appointment_ref: targetAppt.appointment_ref,
        appointment_status: 'CONFIRMED',
        payment_ref: paymentRef,
        amount: feeInfo.base_inr_amount,
        local_currency: feeInfo.currency_code,
        local_amount: feeInfo.local_amount,
        branch_id: branch?.branch_id ?? 1,
        branch_name: branch?.branch_name ?? 'Headquarters',
        payment_method: paymentMethod,
        message: `Paid ${feeInfo.currency_code} ${feeInfo.local_amount.toFixed(2)} and confirmed booking.`,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to process branch payment.',
      });
    }
  });

  app.get('/api/global/payments', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const branchIdParam = req.query.branch_id ? Number(req.query.branch_id) : null;
    try {
      const [{ store, live }, rawPayments] = await Promise.all([
        syncGlobalDirectoryFromOracle(),
        fetchOrdsItems<Payment>('payments'),
      ]);
      let payments = rawPayments;
      if (user.role === 'PATIENT') {
        const appts = await fetchOrdsItems<Appointment>('appointments');
        const myIds = new Set(appts.filter((a) => a.patient_id === user.patient_id).map((a) => a.appointment_id));
        payments = payments.filter((p) => myIds.has(p.appointment_id));
      }

      const mergedPayBranchMap: Record<string, GlobalPaymentBranchLink> = {
        ...store.payment_branch_map,
      };
      const mergedApptBranchMap: Record<string, { branch_id: number; consultation_mode?: string }> = {
        ...store.appt_branch_map,
      };
      if (live) {
        const [oracleGlobalPays, oracleGlobalAppts] = await Promise.all([
          fetchGlobalOrdsCollection<{
            appointment_id: number;
            branch_id: number;
            local_currency: string;
            local_amount: number;
            base_inr_amount: number;
            fx_rate_to_inr: number;
            created_on?: string;
          }>('payments').catch(() => []),
          fetchGlobalOrdsCollection<{
            appointment_id: number;
            branch_id: number;
            consultation_mode?: string;
            branch_resolution?: string;
          }>('appointments').catch(() => []),
        ]);
        for (const gp of oracleGlobalPays) {
          if (gp.appointment_id) {
            mergedPayBranchMap[String(gp.appointment_id)] = {
              appointment_id: Number(gp.appointment_id),
              branch_id: Number(gp.branch_id),
              local_currency: gp.local_currency,
              local_amount: Number(gp.local_amount),
              base_inr_amount: Number(gp.base_inr_amount),
              fx_rate_to_inr: Number(gp.fx_rate_to_inr || 1),
              created_on: gp.created_on,
            };
          }
        }
        for (const ga of oracleGlobalAppts) {
          if (ga.branch_resolution === 'LINKED' && ga.branch_id) {
            mergedApptBranchMap[String(ga.appointment_id)] = {
              branch_id: Number(ga.branch_id),
              consultation_mode: ga.consultation_mode,
            };
          }
        }
      }

      let enriched = enrichPaymentsWithBranch(
        payments,
        mergedPayBranchMap,
        mergedApptBranchMap,
        store.branches,
        store.countries,
      );
      if (branchIdParam) {
        enriched = enriched.filter((p) => p.branch_meta?.branch_id === branchIdParam);
      }
      res.json({ status: 'success', items: enriched });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to load global payments.',
      });
    }
  });

  app.get('/api/global/patient-profiles', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const { store, live } = await syncGlobalDirectoryFromOracle();
    let list = Object.values(store.patient_profiles);
    if (live) {
      try {
        const oracleProfiles = await fetchGlobalOrdsCollection<GlobalPatientProfile>('patient-profiles');
        for (const p of oracleProfiles) {
          store.patient_profiles[String(p.patient_id)] = {
            ...p,
            patient_id: Number(p.patient_id),
            country_id: p.country_id ? Number(p.country_id) : null,
            home_branch_id: p.home_branch_id ? Number(p.home_branch_id) : null,
          };
        }
        writeGlobalStore(store);
        list = Object.values(store.patient_profiles);
      } catch {
        // Fallback to local profiles
      }
    }
    if (user.role === 'PATIENT') {
      res.json({
        status: 'success',
        items: list.filter((p) => p.patient_id === user.patient_id),
      });
      return;
    }
    res.json({ status: 'success', items: list });
  });

  app.post('/api/global/patient-profiles', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const patientId =
      user.role === 'PATIENT' ? Number(user.patient_id || req.body?.patient_id) : Number(req.body?.patient_id);
    if (!patientId) {
      res.status(400).json({ status: 'error', message: 'patient_id is required.' });
      return;
    }
    if (
      user.role !== 'PATIENT' &&
      !requireAnyPermission(user, res, ['PATIENTS:CREATE', 'PATIENTS:UPDATE'], 'Global Patient Profile')
    ) {
      return;
    }
    const { store, live } = await syncGlobalDirectoryFromOracle();
    const countryId = req.body?.country_id ? Number(req.body.country_id) : null;
    const homeBranchId = req.body?.home_branch_id ? Number(req.body.home_branch_id) : null;
    const country = countryId ? store.countries.find((c) => c.country_id === countryId) : undefined;
    const branch = homeBranchId ? store.branches.find((b) => b.branch_id === homeBranchId) : undefined;
    const profile: GlobalPatientProfile = {
      patient_id: patientId,
      country_id: country?.country_id ?? countryId,
      country_code: country?.country_code ?? null,
      country_name: country?.country_name ?? null,
      home_branch_id: branch?.branch_id ?? homeBranchId,
      branch_name: branch?.branch_name ?? null,
      city: req.body?.city ? String(req.body.city).trim() : null,
      address_line: req.body?.address_line ? String(req.body.address_line).trim() : null,
      postal_code: req.body?.postal_code ? String(req.body.postal_code).trim() : null,
      preferred_currency: branch?.currency_code ?? country?.currency_code ?? null,
      updated_on: new Date().toISOString(),
    };

    if (live) {
      try {
        await postGlobalOrdsJson('patient-profiles', {
          patient_id: profile.patient_id,
          country_id: profile.country_id,
          home_branch_id: profile.home_branch_id,
          city: profile.city,
          address_line: profile.address_line,
          postal_code: profile.postal_code,
          preferred_currency: profile.preferred_currency,
        });
      } catch (err) {
        res.status(400).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to save patient profile in Oracle.',
        });
        return;
      }
    }

    store.patient_profiles[String(patientId)] = profile;
    writeGlobalStore(store);
    res.json({ status: 'success', profile });
  });

  app.get('/api/global/utilisation', requireAuth, async (_req, res) => {
    try {
      const { store, live } = await syncGlobalDirectoryFromOracle();
      if (live) {
        const oracleUtil = await fetchGlobalOrdsCollection<GlobalBranchUtilisationRow>(
          'reports/branch-utilisation',
        );
        const branchById = new Map(store.branches.map((b) => [b.branch_id, b]));
        const items: GlobalBranchUtilisationRow[] = oracleUtil.map((row) => {
          const bId = Number(row.branch_id);
          const branch = branchById.get(bId);
          return {
            branch_id: bId,
            branch_code: String(row.branch_code || branch?.branch_code || ''),
            branch_name: String(row.branch_name || branch?.branch_name || ''),
            city: String(row.city || branch?.city || ''),
            country_code: String(row.country_code || branch?.country_code || ''),
            country_name: String(row.country_name || branch?.country_name || ''),
            timezone_iana: String(row.timezone_iana || branch?.timezone_iana || 'UTC'),
            currency_code: String(row.currency_code || branch?.currency_code || 'INR'),
            currency_symbol: normalizeGlobalCurrencySymbol(
              row.currency_code || branch?.currency_code,
              row.currency_symbol || branch?.currency_symbol,
            ),
            total_slots: Number(row.total_slots || 0),
            booked_slots: Number(row.booked_slots || 0),
            total_appointments: Number(row.total_appointments || 0),
            confirmed_appointments: Number(row.confirmed_appointments || 0),
            completed_appointments: Number(row.completed_appointments || 0),
            total_local_revenue: Number(row.total_local_revenue || 0),
            total_inr_revenue: Number(row.total_inr_revenue || 0),
            active_doctors: store.doctor_branches.filter(
              (db) => db.branch_id === bId && db.is_active === 'Y',
            ).length,
            specialized_departments: store.branch_departments.filter(
              (bd) => bd.branch_id === bId && bd.is_active === 'Y' && bd.is_specialized === 'Y',
            ).length,
          };
        });
        res.json({ status: 'success', items });
        return;
      }

      const [rawSlots, rawAppts, rawPayments, templates] = await Promise.all([
        fetchOrdsItems<Slot>('slots').catch(() => [] as Slot[]),
        fetchOrdsItems<Appointment>('appointments').catch(() => [] as Appointment[]),
        fetchOrdsItems<Payment>('payments').catch(() => [] as Payment[]),
        fetchSlotTemplatesSafe(),
      ]);
      const shiftStore = readShiftStore();
      const slotsWithDoc = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const enrichedSlots = enrichSlotsWithBranch(
        slotsWithDoc,
        store.slot_branch_map,
        store.branches,
        store.countries,
      );
      const enrichedAppts = enrichAppointmentsWithBranch(
        rawAppts,
        store.appt_branch_map,
        store.slot_branch_map,
        store.payment_branch_map,
        store.branches,
        store.countries,
      );
      const enrichedPays = enrichPaymentsWithBranch(
        rawPayments,
        store.payment_branch_map,
        store.appt_branch_map,
        store.branches,
        store.countries,
      );
      const rows = computeBranchUtilisation({
        branches: store.branches,
        countries: store.countries,
        slots: enrichedSlots,
        appointments: enrichedAppts,
        payments: enrichedPays,
        doctorBranches: store.doctor_branches,
        branchDepartments: store.branch_departments,
      });
      res.json({ status: 'success', items: rows });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to compute global branch utilization.',
      });
    }
  });

  // ============================================================================
  // FULL-APPLICATION HYBRID (OIC + ORDS) / OIC / ORDS BACKEND TOGGLE & PROBE
  // ============================================================================
  app.get('/api/backend-mode', (req, res) => {
    const authUser = verifySession(getRequestToken(req));
    let oicHostPreview: string | null = null;
    if (authUser && OIC_BASE_URL) {
      try {
        const u = new URL(OIC_BASE_URL);
        oicHostPreview = `${u.host}${u.pathname.replace(/\/+$/, '')}`;
      } catch {
        oicHostPreview = 'configured';
      }
    }
    const effectiveMode: BackendMode = OIC_CONFIGURED ? backendState.mode : 'ORDS';
    res.json({
      mode: backendState.mode,
      effective_mode: effectiveMode,
      persisted_mode: backendState.mode,
      oic_configured: OIC_CONFIGURED,
      oic_oauth_configured: OIC_OAUTH_CONFIGURED,
      oic_basic_configured: OIC_BASIC_CONFIGURED,
      fallback_to_ords: !OIC_CONFIGURED && backendState.mode !== 'ORDS',
      oic_phases: backendState.oic_phases,
      ...(authUser
        ? {
            oic_host_preview: oicHostPreview,
            integrations: OIC_INTEGRATIONS_CATALOG,
          }
        : {}),
    });
  });

  app.post('/api/backend-mode', requireAuth, (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only administrators can switch the backend.' });
      return;
    }

    const body = (req.body || {}) as { mode?: unknown; oic_phases?: unknown };
    const hasMode = body.mode !== undefined;
    const requestedMode = hasMode ? parseBackendMode(body.mode) : backendState.mode;
    if (!requestedMode) {
      res.status(400).json({ status: 'error', message: 'mode must be "HYBRID", "OIC", or "ORDS".' });
      return;
    }

    const nextPhases =
      body.oic_phases !== undefined
        ? normalizeEnabledPhases(body.oic_phases)
        : backendState.oic_phases;
    if ((requestedMode === 'OIC' || requestedMode === 'HYBRID') && nextPhases.length === 0) {
      res.status(400).json({
        status: 'error',
        message: 'Select at least one OIC phase before enabling OIC routing.',
      });
      return;
    }

    const previousMode = backendState.mode;
    const previousPhases = backendState.oic_phases.join(',');
    backendState = {
      mode: requestedMode,
      oic_phases: nextPhases.length > 0 ? nextPhases : [...ALL_OIC_PHASES],
    };
    writeBackendState(backendState);

    if (previousMode !== backendState.mode || previousPhases !== backendState.oic_phases.join(',')) {
      recordRbacAuditLog({
        actor_user_id: user.user_id,
        actor_name: user.full_name,
        actor_role: user.role,
        target_label: 'application_backend',
        action: 'BACKEND_MODE_CHANGED',
        category: 'SECURITY',
        previous_value: `${previousMode} [${previousPhases}]`,
        new_value: `${backendState.mode} [${backendState.oic_phases.join(',')}]`,
        details: `${user.full_name} set application routing mode to ${backendState.mode} (OIC phases: ${backendState.oic_phases.join(', ')}${!OIC_CONFIGURED && backendState.mode !== 'ORDS' ? '; OIC credentials pending in .env, using ORDS fallback' : ''}).`,
        severity: 'info',
      });
    }

    res.json({
      status: 'success',
      mode: backendState.mode,
      effective_mode: OIC_CONFIGURED ? backendState.mode : 'ORDS',
      oic_configured: OIC_CONFIGURED,
      oic_oauth_configured: OIC_OAUTH_CONFIGURED,
      oic_basic_configured: OIC_BASIC_CONFIGURED,
      fallback_to_ords: !OIC_CONFIGURED && backendState.mode !== 'ORDS',
      oic_phases: backendState.oic_phases,
    });
  });

  app.post('/api/backend-mode/test', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ status: 'error', message: 'Only administrators can test OIC endpoints.' });
      return;
    }
    if (!OIC_CONFIGURED) {
      res.status(400).json({
        status: 'error',
        message:
          'OIC is not configured. Set OIC_BASE_URL, OIC_TOKEN_URL, OIC_CLIENT_ID, and OIC_CLIENT_SECRET in .env.',
      });
      return;
    }

    const requestedPhase = req.body?.phaseId ? (String(req.body.phaseId) as OicPhaseId) : null;
    const catalogToProbe = requestedPhase
      ? OIC_INTEGRATIONS_CATALOG.filter((item) => item.phase === requestedPhase)
      : OIC_INTEGRATIONS_CATALOG;

    let authHeader = '';
    try {
      if (OIC_OAUTH_CONFIGURED) {
        const token = await getOicAccessToken(true);
        authHeader = `Bearer ${token}`;
      } else {
        authHeader = `Basic ${Buffer.from(`${OIC_USERNAME}:${OIC_PASSWORD}`).toString('base64')}`;
      }
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'OIC OAuth 2.0 token acquisition failed',
      });
      return;
    }

    const results: Array<{
      phaseId: OicPhaseId;
      endpointId: string;
      oicPath: string;
      ok: boolean;
      status: number;
      latencyMs: number;
      itemCount: number | null;
      error?: string;
    }> = [];

    await Promise.all(
      catalogToProbe.map(async (desc) => {
        const swaggerUrl = `${OIC_BASE_URL}${desc.swaggerPath}`;
        const started = Date.now();
        try {
          const response = await fetch(swaggerUrl, {
            headers: { Accept: 'application/json', Authorization: authHeader },
            signal: AbortSignal.timeout(10_000),
          });
          const latencyMs = Date.now() - started;
          const bodyText = await response.text();
          let opCount: number | null = desc.operations.length;
          if (bodyText.trim()) {
            try {
              const parsed = JSON.parse(bodyText) as { paths?: Record<string, unknown> };
              if (parsed?.paths && typeof parsed.paths === 'object') {
                opCount = Object.keys(parsed.paths).length;
              }
            } catch {
              // Keep catalog count
            }
          }
          results.push({
            phaseId: desc.phase,
            endpointId: desc.integrationName,
            oicPath: `${desc.integrationName}/${desc.version}`,
            ok: response.ok,
            status: response.status,
            latencyMs,
            itemCount: opCount,
            ...(!response.ok ? { error: `HTTP ${response.status}` } : {}),
          });
        } catch (err) {
          results.push({
            phaseId: desc.phase,
            endpointId: desc.integrationName,
            oicPath: `${desc.integrationName}/${desc.version}`,
            ok: false,
            status: 0,
            latencyMs: Date.now() - started,
            itemCount: null,
            error: err instanceof Error ? err.message : 'Request failed',
          });
        }
      }),
    );

    res.json({ status: 'success', oauth_token_verified: true, results });
  });
  // ============================================================================
  // GENERIC AUTHENTICATED ORDS BFF PROXY WITH DENY-BY-DEFAULT MODULE:ACTION RBAC
  // ============================================================================
  app.all('/api/ords/*', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const subPath = (req.params[0] || '').replace(/^\/+/, '');
    const queryIdx = req.originalUrl.indexOf('?');
    const queryString = queryIdx >= 0 ? req.originalUrl.slice(queryIdx) : '';
    const method = req.method.toUpperCase();

    const actionForMethod = (m: string): PermissionAction =>
      m === 'POST' ? 'CREATE' : m === 'PUT' || m === 'PATCH' ? 'UPDATE' : m === 'DELETE' ? 'DELETE' : 'VIEW';

    const enforceModulePerm = (mod: ModuleKey, act: PermissionAction, label: string) =>
      requirePermission(user, res, `${mod}:${act}`, label);

    if (subPath.startsWith('users')) {
      const needed = method === 'GET' ? 'USERS:VIEW' : method === 'POST' ? 'USERS:CREATE' : 'USERS:UPDATE';
      if (!requirePermission(user, res, needed, `ORDS ${subPath}`)) return;

      if (subPath === 'users' && method === 'POST') {
        const requestedRole = String(req.body?.role_name || '').trim().toUpperCase();
        if (requestedRole === 'SUPER_ADMIN') {
          res.status(403).json({ status: 'error', message: 'Cannot create SUPER_ADMIN accounts.' });
          return;
        }
        if (requestedRole === 'ADMIN' && user.role !== 'SUPER_ADMIN') {
          res.status(403).json({ status: 'error', message: 'Only the Super Admin can create Administrator accounts.' });
          return;
        }
      }
    } else if (subPath.startsWith('roles')) {
      if (!enforceModulePerm('ROLES', method === 'GET' ? 'VIEW' : 'UPDATE', `ORDS ${subPath}`)) return;
    } else if (subPath.startsWith('permissions') || subPath.startsWith('role-permissions')) {
      if (!enforceModulePerm('PERMISSIONS', method === 'GET' ? 'VIEW' : 'UPDATE', `ORDS ${subPath}`)) return;
    } else if (
      subPath.startsWith('audit-logs') ||
      subPath.startsWith('audit-config') ||
      subPath.startsWith('error-logs')
    ) {
      if (
        !requireAnyPermission(
          user,
          res,
          method === 'GET'
            ? ['SYSTEM_SETTINGS:VIEW', 'USERS:VIEW', 'ROLES:VIEW', 'PERMISSIONS:VIEW']
            : ['SYSTEM_SETTINGS:UPDATE'],
          `ORDS ${subPath}`,
        )
      ) {
        return;
      }
    } else if (subPath.startsWith('approvals')) {
      if (!canViewAllShiftChangeRequests(user)) {
        res.status(403).json({
          status: 'error',
          message: 'Only hospital administrators can access approval queues.',
        });
        return;
      }
      if (
        !requireAnyPermission(
          user,
          res,
          method === 'GET' ? ['SLOTS:VIEW', 'SLOTS:UPDATE'] : ['SLOTS:UPDATE'],
          `ORDS ${subPath}`,
        )
      ) {
        return;
      }
    } else if (subPath.startsWith('departments') || subPath.startsWith('consultation-types')) {
      if (method === 'GET') {
        if (
          !requireAnyPermission(
            user,
            res,
            ['DEPARTMENTS:VIEW', 'APPOINTMENTS:CREATE', 'APPOINTMENTS:VIEW', 'SLOTS:VIEW', 'DOCTORS:VIEW'],
            `ORDS ${subPath}`,
          )
        ) {
          return;
        }
      } else {
        if (!enforceModulePerm('DEPARTMENTS', actionForMethod(method), `ORDS ${subPath}`)) return;
      }
    } else if (subPath.startsWith('doctors')) {
      if (method === 'GET') {
        if (
          !requireAnyPermission(
            user,
            res,
            ['DOCTORS:VIEW', 'APPOINTMENTS:CREATE', 'APPOINTMENTS:VIEW', 'SLOTS:VIEW'],
            `ORDS ${subPath}`,
          )
        ) {
          return;
        }
      } else {
        if (!enforceModulePerm('DOCTORS', actionForMethod(method), `ORDS ${subPath}`)) return;
      }
    } else if (subPath.startsWith('slot_templates') || subPath.startsWith('slots')) {
      if (method === 'GET') {
        if (
          !requireAnyPermission(
            user,
            res,
            ['SLOTS:VIEW', 'APPOINTMENTS:CREATE', 'APPOINTMENTS:VIEW'],
            `ORDS ${subPath}`,
          )
        ) {
          return;
        }
      } else {
        if (!enforceModulePerm('SLOTS', actionForMethod(method), `ORDS ${subPath}`)) return;
        if (subPath === 'slots/generate') {
          res.status(403).json({
            status: 'error',
            message: 'Bulk slot generation is disabled. Confirm daily slots from your availability calendar.',
          });
          return;
        }
        if (subPath === 'slot_templates' && method === 'POST') {
          res.status(403).json({
            status: 'error',
            message: 'Shift changes require administrator approval via Shift Change Request.',
          });
          return;
        }
        if (subPath.startsWith('slot_templates/') && method === 'DELETE') {
          res.status(403).json({
            status: 'error',
            message: 'Shift changes require administrator approval via Shift Change Request.',
          });
          return;
        }
        if (subPath === 'slots' && method === 'POST') {
          if (user.role === 'DOCTOR') {
            if (!user.doctor_id) {
              res.status(403).json({ status: 'error', message: 'Doctor profile is not linked' });
              return;
            }
            const requestedDoctorId =
              req.body?.doctor_id !== undefined && req.body?.doctor_id !== null
                ? Number(req.body.doctor_id)
                : null;
            if (requestedDoctorId !== null && requestedDoctorId !== user.doctor_id) {
              res.status(403).json({
                status: 'error',
                message: 'Doctors can only create slots under their own doctor_id',
              });
              return;
            }
            if (req.body?.template_id !== undefined && req.body?.template_id !== null) {
              const tid = Number(req.body.template_id);
              const allTmpls = await fetchSlotTemplatesSafe();
              const target = allTmpls.find((t) => t.template_id === tid);
              if (target && target.doctor_id !== user.doctor_id) {
                res.status(403).json({
                  status: 'error',
                  message: 'Doctors can only create slots under their own schedule',
                });
                return;
              }
            }
            req.body = { ...(req.body ?? {}), doctor_id: user.doctor_id };
          }
          const slotDate = String(req.body?.slot_date || '').slice(0, 10);
          const startTime = String(req.body?.start_time || '').trim();
          const endTime = String(req.body?.end_time || '').trim();
          if (startTime && endTime && !isValidSlotTimeRange(startTime, endTime)) {
            res.status(400).json({
              status: 'error',
              message: `Invalid slot time range ${startTime}–${endTime}`,
            });
            return;
          }
          if (isSlotEndExpired(slotDate, startTime, endTime, new Date(), HOSPITAL_TIMEZONE)) {
            const nowParts = getHospitalNowParts(new Date(), HOSPITAL_TIMEZONE);
            res.status(400).json({
              status: 'error',
              message: `Cannot generate expired slot ending at ${endTime || startTime} on ${slotDate} (current time: ${nowParts.timeHHMM} ${HOSPITAL_TIMEZONE}).`,
            });
            return;
          }
        }
      }
    } else if (subPath.startsWith('patients')) {
      if (method === 'GET') {
        const isOwnPatientLookup =
          user.role === 'PATIENT' &&
          Boolean(user.patient_id) &&
          (subPath === `patients/${user.patient_id}` || subPath === 'patients');
        if (!isOwnPatientLookup && !enforceModulePerm('PATIENTS', 'VIEW', `ORDS ${subPath}`)) return;
      } else {
        const isOwnPatientUpdate =
          user.role === 'PATIENT' &&
          Boolean(user.patient_id) &&
          subPath === `patients/${user.patient_id}` &&
          method === 'PUT';
        if (!isOwnPatientUpdate && !enforceModulePerm('PATIENTS', actionForMethod(method), `ORDS ${subPath}`)) {
          return;
        }
        if (user.role === 'PATIENT') {
          const targetId = Number(subPath.split('/')[1]);
          if (!targetId || targetId !== user.patient_id) {
            res.status(403).json({ status: 'error', message: 'Patients can only update their own profile' });
            return;
          }
        }
      }
    } else if (subPath.startsWith('payments')) {
      if (!enforceModulePerm('PAYMENTS', actionForMethod(method), `ORDS ${subPath}`)) return;
    } else if (subPath.startsWith('token_queue')) {
      const act = method === 'GET' ? 'VIEW' : method === 'POST' ? 'CREATE' : 'UPDATE';
      if (
        !requireAnyPermission(
          user,
          res,
          act === 'VIEW' ? ['TOKEN_QUEUE:VIEW'] : ['TOKEN_QUEUE:CREATE', 'TOKEN_QUEUE:UPDATE'],
          `ORDS ${subPath}`,
        )
      ) {
        return;
      }
    } else if (subPath.startsWith('appointments')) {
      if (method === 'GET') {
        if (!enforceModulePerm('APPOINTMENTS', 'VIEW', `ORDS ${subPath}`)) return;
      } else if (subPath === 'appointments/' || subPath === 'appointments') {
        if (!enforceModulePerm('APPOINTMENTS', 'CREATE', `ORDS ${subPath}`)) return;
      } else if (/^appointments\/\d+\/cancel$/.test(subPath)) {
        if (
          !requireAnyPermission(
            user,
            res,
            ['APPOINTMENTS:DELETE', 'APPOINTMENTS:UPDATE'],
            `ORDS ${subPath}`,
          )
        ) {
          return;
        }
      } else if (/^appointments\/\d+\/confirm$/.test(subPath)) {
        const allowedPerms =
          user.role === 'PATIENT'
            ? ['APPOINTMENTS:UPDATE', 'APPOINTMENTS:CREATE']
            : ['APPOINTMENTS:UPDATE'];
        if (!requireAnyPermission(user, res, allowedPerms, `ORDS ${subPath}`)) return;
      } else if (/^appointments\/\d+\/outcome$/.test(subPath)) {
        if (user.role === 'PATIENT') {
          res.status(403).json({
            status: 'error',
            message: 'Patients cannot mark appointment outcomes.',
          });
          return;
        }
        if (!enforceModulePerm('APPOINTMENTS', 'UPDATE', `ORDS ${subPath}`)) return;
      } else if (subPath === 'appointments/expire-holds') {
        if (
          !requireAnyPermission(
            user,
            res,
            ['APPOINTMENTS:UPDATE', 'APPOINTMENTS:DELETE', 'APPOINTMENTS:CREATE'],
            `ORDS ${subPath}`,
          )
        ) {
          return;
        }
      } else {
        if (!enforceModulePerm('APPOINTMENTS', actionForMethod(method), `ORDS ${subPath}`)) return;
      }
    } else if (subPath.startsWith('leaves')) {
      if (method === 'GET') {
        if (!enforceModulePerm('SLOTS', 'VIEW', `ORDS ${subPath}`)) return;
      } else if (subPath === 'leaves') {
        if (!requireAnyPermission(user, res, ['SLOTS:CREATE', 'SLOTS:UPDATE'], `ORDS ${subPath}`)) return;
      } else if (/^leaves\/\d+\/decide$/.test(subPath)) {
        if (!canDecideLeaveOrShiftRequest(user)) {
          res.status(403).json({
            status: 'error',
            message: 'Only hospital administrators can approve or reject leave requests',
          });
          return;
        }
        if (!enforceModulePerm('SLOTS', 'UPDATE', `ORDS ${subPath}`)) return;
      } else {
        if (!enforceModulePerm('SLOTS', actionForMethod(method), `ORDS ${subPath}`)) return;
      }
    } else if (subPath.startsWith('reports/')) {
      if (
        !requireAnyPermission(
          user,
          res,
          ['DOCTOR_ANALYTICS:VIEW', 'DEPARTMENT_ANALYTICS:VIEW', 'REVENUE_ANALYTICS:VIEW', 'SLOTS:VIEW'],
          `ORDS ${subPath}`,
        )
      ) {
        return;
      }
    } else if (subPath.startsWith('cancellation-rules')) {
      if (method === 'GET') {
        if (
          !requireAnyPermission(
            user,
            res,
            ['APPOINTMENTS:VIEW', 'APPOINTMENTS:CREATE', 'PAYMENTS:VIEW', 'SYSTEM_SETTINGS:VIEW'],
            `ORDS ${subPath}`,
          )
        ) {
          return;
        }
      } else {
        if (!enforceModulePerm('SYSTEM_SETTINGS', actionForMethod(method), `ORDS ${subPath}`)) return;
      }
    } else if (subPath.startsWith('doctor-shifts') || subPath.startsWith('shift-change-requests')) {
      if (method === 'GET') {
        if (!enforceModulePerm('SLOTS', 'VIEW', `ORDS ${subPath}`)) return;
      } else {
        if (subPath.startsWith('shift-change-requests') && subPath.includes('/decide') && !canDecideLeaveOrShiftRequest(user)) {
          res.status(403).json({
            status: 'error',
            message: 'Only hospital administrators can approve or reject shift change requests',
          });
          return;
        }
        if (!enforceModulePerm('SLOTS', 'UPDATE', `ORDS ${subPath}`)) return;
      }
    } else if (subPath.startsWith('medical-records')) {
      if (!enforceModulePerm('MEDICAL_RECORDS', actionForMethod(method), `ORDS ${subPath}`)) return;
    } else if (subPath.startsWith('prescriptions')) {
      if (!enforceModulePerm('PRESCRIPTIONS', actionForMethod(method), `ORDS ${subPath}`)) return;
    } else {
      // Strict deny-by-default for any unmapped ORDS endpoint unless SUPER_ADMIN
      if (user.role !== 'SUPER_ADMIN') {
        requirePermission(user, res, 'SYSTEM_SETTINGS:UPDATE', `ORDS ${subPath}`);
        return;
      }
    }

    let pendingPatientRegion: { city: string; locality: string } | null = null;
    if ((subPath === 'patients' && method === 'POST') || (/^patients\/\d+$/.test(subPath) && method === 'PUT')) {
      const city = normalizeRegionText(req.body?.city);
      const locality = normalizeRegionText(req.body?.locality);
      if (!city || !locality) {
        res.status(400).json({
          status: 'error',
          message: 'City and locality are required.',
        });
        return;
      }
      pendingPatientRegion = { city, locality };
    }

    // Doctor patient isolation on single-patient lookup (/api/ords/patients/:id)
    if (method === 'GET' && /^patients\/\d+$/.test(subPath) && user.role === 'DOCTOR') {
      if (!user.doctor_id) {
        res.status(403).json({ status: 'error', message: 'Doctor profile is not linked' });
        return;
      }
      const targetPatientId = Number(subPath.split('/')[1]);
      const bookedIds = await getBookedPatientIdsForDoctor(user.doctor_id);
      if (!bookedIds.has(targetPatientId)) {
        res.status(403).json({
          status: 'error',
          message: 'Doctors can only view details of patients who have booked an appointment with them.',
        });
        return;
      }
    }

    let outgoingBody = req.body ?? {};
    const doctorLoginEmail =
      subPath === 'doctors' && method === 'POST'
        ? String(outgoingBody.login_email || '').trim().toLowerCase()
        : '';
    const doctorInitialPassword =
      subPath === 'doctors' && method === 'POST'
        ? String(outgoingBody.initial_password || process.env.DEMO_DOCTOR_PASSWORD || 'Doctor@123')
        : '';
    if (subPath === 'doctors' && method === 'POST') {
      const { login_email: _le, initial_password: _ip, ...cleanDoctorBody } = outgoingBody;
      outgoingBody = cleanDoctorBody;
    }

    let pendingBookingInfo: {
      patient_id: number;
      slot_id: number;
      doctor_id?: number | null;
      slot_date?: string | null;
      start_time?: string | null;
      end_time?: string | null;
      booking_source: string;
      consultation_mode: ConsultationMode;
      rescheduled_from_id: number | null;
    } | null = null;

    if ((subPath === 'appointments/' || subPath === 'appointments') && method === 'POST') {
      const targetPatientId =
        user.role === 'PATIENT' ? Number(user.patient_id) : Number(outgoingBody?.patient_id);
      const targetSlotId = Number(outgoingBody?.slot_id);
      const consultationMode = normalizeConsultationModeInput(outgoingBody?.consultation_mode);
      const rescheduledFromId = outgoingBody?.rescheduled_from_id
        ? Number(outgoingBody.rescheduled_from_id)
        : null;

      if (!consultationMode) {
        res.status(400).json({
          status: 'error',
          message: 'Consultation mode is required (ONLINE or FACE_TO_FACE).',
        });
        return;
      }

      if (!targetPatientId || !targetSlotId) {
        res.status(400).json({
          status: 'error',
          message: 'Patient and slot selection are required.',
        });
        return;
      }

      await ensureOverdueHoldsExpired({ triggerActor: user });
      const [slotsList, templatesList, existingAppts] = await Promise.all([
        fetchOrdsItems<Slot>('slots'),
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Appointment>('appointments'),
      ]);
      trackNextHoldExpiry(existingAppts);
      const shiftStore = readShiftStore();
      const slotsWithDoc = attachDoctorIdsToSlots(slotsList, templatesList, shiftStore);
      const targetSlot = slotsWithDoc.find((s) => s.slot_id === targetSlotId);

      if (!targetSlot) {
        res.status(404).json({
          status: 'error',
          code: 'SLOT_UNAVAILABLE',
          message: 'Selected slot is no longer available. Available slots have been refreshed.',
        });
        return;
      }

      if (
        targetSlot.status !== 'AVAILABLE' ||
        Number(targetSlot.booked_patients || 0) >= Number(targetSlot.max_patients_per_slot || 1)
      ) {
        res.status(409).json({
          status: 'error',
          code: 'SLOT_UNAVAILABLE',
          message: 'Selected slot has already been booked or closed. Available slots have been refreshed.',
        });
        return;
      }

      if (isSlotEndExpired(targetSlot.slot_date, targetSlot.start_time, targetSlot.end_time, new Date(), HOSPITAL_TIMEZONE)) {
        res.status(400).json({
          status: 'error',
          code: 'SLOT_EXPIRED',
          message: 'Selected slot end time has already passed. Available slots have been refreshed.',
        });
        return;
      }

      const duplicateSameSlot = existingAppts.some(
        (a) =>
          a.patient_id === targetPatientId &&
          a.slot_id === targetSlotId &&
          a.status !== 'CANCELLED',
      );
      if (duplicateSameSlot) {
        res.status(409).json({
          status: 'error',
          code: 'DUPLICATE_BOOKING',
          message: 'You already have an appointment booked for this slot.',
        });
        return;
      }

      const slotById = new Map<number, Slot>(slotsWithDoc.map((s) => [s.slot_id, s]));
      const targetSlotDate = getIsoDatePart(targetSlot.slot_date);
      const duplicateSameTime = existingAppts.some((a) => {
        if (a.patient_id !== targetPatientId) return false;
        if (!['HELD', 'CONFIRMED'].includes(a.status)) return false;
        const bookedSlot = slotById.get(a.slot_id);
        return (
          bookedSlot &&
          getIsoDatePart(bookedSlot.slot_date) === targetSlotDate &&
          bookedSlot.start_time === targetSlot.start_time
        );
      });
      if (duplicateSameTime) {
        res.status(409).json({
          status: 'error',
          code: 'DUPLICATE_BOOKING',
          message: 'You already have another active appointment scheduled at this date and time.',
        });
        return;
      }

      const resolvedBookingSource =
        user.role === 'PATIENT' ? 'ONLINE' : String(outgoingBody.booking_source || 'WALK_IN');
      pendingBookingInfo = {
        patient_id: targetPatientId,
        slot_id: targetSlotId,
        doctor_id: targetSlot.doctor_id ?? null,
        slot_date: targetSlotDate || null,
        start_time: targetSlot.start_time ?? null,
        end_time: targetSlot.end_time ?? null,
        booking_source: resolvedBookingSource,
        consultation_mode: consultationMode,
        rescheduled_from_id: rescheduledFromId,
      };

      outgoingBody = {
        ...outgoingBody,
        patient_id: targetPatientId,
        slot_id: targetSlotId,
        booking_source: resolvedBookingSource,
        consultation_mode: consultationMode,
      };
    }

    let pendingConfirmContext: {
      appointment: Appointment;
      doctor_name: string | null;
      slot_date: string | null;
      start_time: string | null;
    } | null = null;

    let pendingCancelContext: {
      appointment: Appointment;
      slot: Slot | null;
      doctor_name: string | null;
      paid_amount: number;
      payment_ref: string | null;
      payment_method: string | null;
      cancellation_rules: CancellationRule[];
    } | null = null;

    if (/^appointments\/\d+\/(confirm|cancel)$/.test(subPath) && method === 'POST') {
      const isConfirmAction = subPath.endsWith('/confirm');
      const isCancelAction = subPath.endsWith('/cancel');
      const apptId = Number(subPath.split('/')[1]);
      if (user.role === 'PATIENT' || isConfirmAction || isCancelAction) {
        const [appts, rawSlots, templates, doctors, payments, rules] = await Promise.all([
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Slot>('slots').catch(() => [] as Slot[]),
          fetchSlotTemplatesSafe(),
          fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
          fetchOrdsItems<Payment>('payments').catch(() => [] as Payment[]),
          isCancelAction ? fetchOrdsItems<CancellationRule>('cancellation-rules').catch(() => [] as CancellationRule[]) : Promise.resolve([] as CancellationRule[]),
        ]);
        const target = attachConsultationMode(appts, payments).find((a) => a.appointment_id === apptId);
        if (user.role === 'PATIENT' && (!target || target.patient_id !== user.patient_id)) {
          res.status(403).json({ status: 'error', message: 'Patients can only manage their own appointments' });
          return;
        }
        if (isConfirmAction && target && isAppointmentHoldExpired(target)) {
          await ensureOverdueHoldsExpired({ force: true, triggerActor: user });
          res.status(409).json({
            status: 'error',
            code: 'HOLD_EXPIRED',
            message: 'This 10-minute booking hold has expired and the slot has been released. Please book a new slot.',
          });
          return;
        }
        const shiftStore = readShiftStore();
        const slotsWithDoc = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
        const matchedSlot = target
          ? slotsWithDoc.find((s) => s.slot_id === target.slot_id) || null
          : null;
        const matchedDoctor =
          matchedSlot?.doctor_id
            ? doctors.find((d) => d.doctor_id === matchedSlot.doctor_id)
            : target?.doctor_id
              ? doctors.find((d) => d.doctor_id === target.doctor_id)
              : undefined;
        const resolvedDoctorName = matchedDoctor
          ? `Dr. ${matchedDoctor.first_name} ${matchedDoctor.last_name}`
          : target?.doctor_name || null;

        if (isConfirmAction && target) {
          pendingConfirmContext = {
            appointment: target,
            doctor_name: resolvedDoctorName,
            slot_date: getIsoDatePart(matchedSlot?.slot_date || target.slot_date) || null,
            start_time: matchedSlot?.start_time || target.start_time || null,
          };
        }

        if (isCancelAction && target) {
          const successPay = payments.find(
            (p) => p.appointment_id === apptId && p.status === 'SUCCESS',
          );
          const paidAmount = Number(
            target.paid_amount ?? (successPay ? Number(successPay.amount || 0) : 0),
          );
          pendingCancelContext = {
            appointment: target,
            slot: matchedSlot,
            doctor_name: resolvedDoctorName,
            paid_amount: paidAmount,
            payment_ref: target.payment_ref ?? successPay?.payment_ref ?? null,
            payment_method: target.payment_method ?? successPay?.payment_method ?? null,
            cancellation_rules: rules,
          };
        }
      }
    }

    let pendingExpireHoldsBefore: Appointment[] = [];
    if (subPath === 'appointments/expire-holds' && method === 'POST') {
      const currentAppts = await fetchOrdsItems<Appointment>('appointments').catch(
        () => [] as Appointment[],
      );
      pendingExpireHoldsBefore = currentAppts.filter((a) => isAppointmentHoldExpired(a));
    }

    let pendingOutcomeVerification: {
      appointment: Appointment;
      outcome: 'COMPLETED' | 'NO_SHOW';
    } | null = null;
    if (/^appointments\/\d+\/outcome$/.test(subPath) && method === 'POST') {
      const apptId = Number(subPath.split('/')[1]);
      const requestedOutcome = String(outgoingBody?.outcome || '').trim().toUpperCase();
      if (requestedOutcome !== 'COMPLETED' && requestedOutcome !== 'NO_SHOW') {
        res.status(400).json({
          status: 'error',
          message: 'Outcome must be COMPLETED or NO_SHOW.',
        });
        return;
      }

      const [rawAppts, rawSlots, templates, doctors, departments] = await Promise.all([
        fetchOrdsItems<Appointment>('appointments'),
        fetchOrdsItems<Slot>('slots'),
        fetchSlotTemplatesSafe(),
        fetchOrdsItems<Doctor>('doctors'),
        fetchOrdsItems<Department>('departments/'),
      ]);
      const shiftStore = readShiftStore();
      const slotsWithDoc = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const fullSlots = enrichSlots(slotsWithDoc, templates, doctors, departments);
      const enrichedAppts = enrichAppointments(
        attachConsultationMode(rawAppts),
        fullSlots,
        doctors,
      );
      const target = enrichedAppts.find((a) => a.appointment_id === apptId);
      if (!target) {
        res.status(404).json({ status: 'error', message: 'Appointment not found.' });
        return;
      }
      if (user.role === 'DOCTOR' && target.doctor_id !== user.doctor_id) {
        res.status(403).json({
          status: 'error',
          message: 'Doctors can only record outcomes for their own appointments.',
        });
        return;
      }
      if (target.status !== 'CONFIRMED') {
        res.status(400).json({
          status: 'error',
          message: `Only confirmed appointments can be marked Completed or No-Show (current status: ${target.status}).`,
        });
        return;
      }
      if (!isSlotEndExpired(target.slot_date, target.start_time, target.end_time, new Date(), HOSPITAL_TIMEZONE)) {
        res.status(400).json({
          status: 'error',
          message: `Appointment outcome can only be entered after the slot end time (${target.end_time || 'scheduled'}) has passed.`,
        });
        return;
      }
      outgoingBody = { outcome: requestedOutcome };
      pendingOutcomeVerification = {
        appointment: target,
        outcome: requestedOutcome,
      };
    }

    if (
      method === 'GET' &&
      (subPath === 'slots' ||
        subPath === 'slots/' ||
        subPath === 'appointments' ||
        subPath === 'appointments/')
    ) {
      await ensureOverdueHoldsExpired();
    }

    if (subPath === 'leaves' && method === 'POST') {
      const requestedBy =
        Number(outgoingBody?.requested_by) ||
        (user.auth_mode === 'ords' || user.auth_mode === 'bridge' ? user.user_id : 1);
      outgoingBody = {
        ...outgoingBody,
        ...(user.role === 'DOCTOR' && user.doctor_id ? { doctor_id: user.doctor_id } : {}),
        requested_by: requestedBy,
      };
    }

    let pendingLeaveDecisionContext: {
      leave_id: number;
      leave: DoctorLeave | null;
      decision: string;
      comments: string | null;
    } | null = null;
    if (/^leaves\/\d+\/decide$/.test(subPath) && method === 'POST') {
      const leaveId = Number(subPath.split('/')[1]);
      const leavesList = await fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]);
      const matchedLeave = leavesList.find((l) => l.leave_id === leaveId) || null;
      pendingLeaveDecisionContext = {
        leave_id: leaveId,
        leave: matchedLeave,
        decision: String(outgoingBody?.decision || '').trim().toUpperCase(),
        comments: String(outgoingBody?.comments || '').trim() || null,
      };
      outgoingBody = {
        ...outgoingBody,
        admin_user_id: user.user_id || 1,
      };
    }

    try {
      const normalizedOutgoing =
        method !== 'GET' && method !== 'HEAD'
          ? normalizeOicMutationPayload(method, `${subPath}${queryString}`, outgoingBody, user.full_name)
          : outgoingBody;
      const shouldSendBody =
        method !== 'GET' &&
        method !== 'HEAD' &&
        !(method === 'DELETE' && Object.keys(normalizedOutgoing).length === 0);
      const { response: upstream, target } = await fetchUpstreamWithRetry(`${subPath}${queryString}`, {
        method,
        body: shouldSendBody ? JSON.stringify(normalizedOutgoing) : undefined,
      });
      res.setHeader('X-Backend', target.servedBy);
      res.setHeader('X-Served-By', target.servedBy);
      if (target.integrationName) {
        res.setHeader('X-OIC-Integration', target.integrationName);
      }
      res.setHeader('X-Backend-Phase', target.phase);
      const text = await upstream.text();
      const contentType = upstream.headers.get('content-type') || 'application/json';

      if (pendingOutcomeVerification) {
        let parsedBody: Record<string, unknown> | null = null;
        try {
          parsedBody = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          parsedBody = null;
        }
        const upstreamMsg = String(parsedBody?.message || text || '');
        const upstreamSucceeded =
          upstream.ok && parsedBody && parsedBody.status !== 'error';
        const isTimezoneOrInvalidProcError =
          /20032|end time has not passed|ORA-06575|ORA-06550|ORA-04063|invalid/i.test(upstreamMsg);

        if (upstreamSucceeded) {
          recordAppointmentOutcomeOverlay(
            pendingOutcomeVerification.appointment,
            null,
            user.full_name,
          );
          recordRbacAuditLog({
            actor_user_id: user.user_id,
            actor_name: user.full_name,
            actor_email: user.email,
            actor_role: user.role,
            target_label: pendingOutcomeVerification.appointment.appointment_ref,
            action: `APPOINTMENT_${pendingOutcomeVerification.outcome}`,
            category: 'CLINICAL',
            previous_value: 'CONFIRMED',
            new_value: pendingOutcomeVerification.outcome,
            details: `${user.full_name} marked appointment ${pendingOutcomeVerification.appointment.appointment_ref} (${pendingOutcomeVerification.appointment.patient_name}) as ${pendingOutcomeVerification.outcome}.`,
            severity: 'info',
          });
        } else if (isTimezoneOrInvalidProcError) {
          recordAppointmentOutcomeOverlay(
            pendingOutcomeVerification.appointment,
            pendingOutcomeVerification.outcome,
            user.full_name,
          );
          recordRbacAuditLog({
            actor_user_id: user.user_id,
            actor_name: user.full_name,
            actor_email: user.email,
            actor_role: user.role,
            target_label: pendingOutcomeVerification.appointment.appointment_ref,
            action: `APPOINTMENT_${pendingOutcomeVerification.outcome}`,
            category: 'CLINICAL',
            previous_value: 'CONFIRMED',
            new_value: pendingOutcomeVerification.outcome,
            details: `${user.full_name} marked appointment ${pendingOutcomeVerification.appointment.appointment_ref} (${pendingOutcomeVerification.appointment.patient_name}) as ${pendingOutcomeVerification.outcome} (IST slot-end verified).`,
            severity: 'info',
          });
          res.status(200).json({
            status: 'success',
            message: `Appointment outcome updated to ${pendingOutcomeVerification.outcome}`,
            persistence: 'ist_verified_overlay',
          });
          return;
        }
      }

      let parsedMutationBody: Record<string, unknown> | null = null;
      if (upstream.ok && method !== 'GET' && method !== 'HEAD') {
        try {
          parsedMutationBody = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          parsedMutationBody = null;
        }
      }
      const mutationSucceeded =
        upstream.ok &&
        (!parsedMutationBody ||
          String(parsedMutationBody.status || '').trim().toLowerCase() !== 'error');

      if (upstream.ok && pendingBookingInfo) {
        try {
          const parsedBody = parsedMutationBody || {};
          if (parsedBody?.status !== 'error') {
            const [latestAppts, doctorsList, patientsList] = await Promise.all([
              fetchOrdsItems<Appointment>('appointments').catch(() => [] as Appointment[]),
              fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
              fetchOrdsItems<Patient>('patients').catch(() => [] as Patient[]),
            ]);
            const refFromRes =
              typeof parsedBody?.appointment_ref === 'string' ? parsedBody.appointment_ref : null;
            const matchedCreated =
              (refFromRes
                ? latestAppts.find((a) => a.appointment_ref === refFromRes)
                : undefined) ||
              latestAppts
                .filter(
                  (a) =>
                    a.patient_id === pendingBookingInfo!.patient_id &&
                    a.slot_id === pendingBookingInfo!.slot_id &&
                    a.status !== 'CANCELLED',
                )
                .sort((a, b) => b.appointment_id - a.appointment_id)[0];

            const resolvedRef =
              refFromRes || matchedCreated?.appointment_ref || `SLOT-${pendingBookingInfo.slot_id}`;
            const matchedPat = patientsList.find(
              (p) => p.patient_id === pendingBookingInfo!.patient_id,
            );
            const resolvedPatName =
              matchedCreated?.patient_name ||
              (matchedPat ? `${matchedPat.first_name} ${matchedPat.last_name}` : null) ||
              `Patient #${pendingBookingInfo.patient_id}`;
            const matchedDoc = pendingBookingInfo.doctor_id
              ? doctorsList.find((d) => d.doctor_id === pendingBookingInfo!.doctor_id)
              : undefined;
            const resolvedDocName = matchedDoc
              ? `Dr. ${matchedDoc.first_name} ${matchedDoc.last_name}`
              : null;
            const initialStatus = matchedCreated?.status || 'HELD';

            saveAppointmentMetadata({
              consultation_mode: pendingBookingInfo.consultation_mode,
              rescheduled_from_id: pendingBookingInfo.rescheduled_from_id,
              appointment_ref: refFromRes || matchedCreated?.appointment_ref || null,
              appointment_id: matchedCreated?.appointment_id ?? null,
              patient_id: pendingBookingInfo.patient_id,
              slot_id: pendingBookingInfo.slot_id,
              updated_at: new Date().toISOString(),
            });
            trackNextHoldExpiry(latestAppts);

            recordRbacAuditLog({
              actor_user_id: user.user_id,
              actor_name: user.full_name,
              actor_email: user.email,
              actor_role: user.role,
              target_label: resolvedRef,
              action: pendingBookingInfo.rescheduled_from_id
                ? 'APPOINTMENT_RESCHEDULED'
                : 'APPOINTMENT_BOOKED',
              category: 'APPOINTMENTS',
              previous_value: pendingBookingInfo.rescheduled_from_id
                ? `Appt #${pendingBookingInfo.rescheduled_from_id}`
                : null,
              new_value: `${initialStatus} (${pendingBookingInfo.consultation_mode})`,
              details: describeBookingAuditDetails({
                actorName: user.full_name,
                actorRole: user.role,
                appointmentRef: resolvedRef,
                patientName: resolvedPatName,
                doctorName: resolvedDocName,
                slotDate: pendingBookingInfo.slot_date,
                startTime: pendingBookingInfo.start_time,
                endTime: pendingBookingInfo.end_time,
                bookingSource: pendingBookingInfo.booking_source,
                consultationMode: pendingBookingInfo.consultation_mode,
                initialStatus,
                rescheduledFromId: pendingBookingInfo.rescheduled_from_id,
              }),
              severity: 'info',
            });

            res.status(upstream.status).json({
              ...parsedBody,
              appointment_id: matchedCreated?.appointment_id ?? null,
              appointment_status: matchedCreated?.status ?? null,
              hold_expires_at: matchedCreated?.hold_expires_at ?? null,
              consultation_mode: pendingBookingInfo.consultation_mode,
            });
            return;
          }
        } catch {
          // Fall through to raw ORDS response if parsing fails
        }
      }

      if (mutationSucceeded && pendingConfirmContext) {
        const appt = pendingConfirmContext.appointment;
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: appt.appointment_ref,
          action: 'APPOINTMENT_CONFIRMED',
          category: 'APPOINTMENTS',
          previous_value: appt.status,
          new_value: 'CONFIRMED',
          details: `${user.full_name} (${user.role}) confirmed appointment ${appt.appointment_ref} for ${appt.patient_name}${pendingConfirmContext.doctor_name ? ` with ${pendingConfirmContext.doctor_name}` : ''}${pendingConfirmContext.slot_date ? ` (${pendingConfirmContext.slot_date} ${pendingConfirmContext.start_time || ''})` : ''}.`,
          severity: 'info',
        });
      }

      if (mutationSucceeded && subPath === 'appointments/expire-holds' && method === 'POST') {
        const expiredCount = Number(parsedMutationBody?.expired_count || 0);
        if (expiredCount > 0 || pendingExpireHoldsBefore.length > 0) {
          if (pendingExpireHoldsBefore.length > 0) {
            for (const expAppt of pendingExpireHoldsBefore) {
              recordRbacAuditLog({
                actor_user_id: user.user_id,
                actor_name: user.full_name,
                actor_email: user.email,
                actor_role: user.role,
                target_label: expAppt.appointment_ref,
                action: 'APPOINTMENT_HOLD_EXPIRED',
                category: 'APPOINTMENTS',
                previous_value: 'HELD',
                new_value: 'CANCELLED (HOLD_EXPIRED)',
                details: `Expired overdue 10-minute hold for ${expAppt.appointment_ref} (${expAppt.patient_name}); slot #${expAppt.slot_id} released.`,
                severity: 'info',
              });
            }
          } else {
            recordRbacAuditLog({
              actor_user_id: user.user_id,
              actor_name: user.full_name,
              actor_email: user.email,
              actor_role: user.role,
              target_label: 'Overdue Slot Holds',
              action: 'APPOINTMENT_HOLD_EXPIRED',
              category: 'APPOINTMENTS',
              previous_value: 'HELD',
              new_value: `${expiredCount} expired`,
              details: `${user.full_name} (${user.role}) ran hold expiry cleanup: ${expiredCount} overdue hold(s) expired and released.`,
              severity: 'info',
            });
          }
        }
      }

      if (upstream.ok && pendingCancelContext) {
        try {
          const parsedBody = parsedMutationBody || {};
          if (parsedBody?.status !== 'error') {
            // 1. Ensure cancelled slot remains in opened_slot_keys so other patients can re-book it until end_time
            const cancelledSlot = pendingCancelContext.slot;
            if (
              cancelledSlot &&
              cancelledSlot.doctor_id &&
              !isSlotEndExpired(
                cancelledSlot.slot_date,
                cancelledSlot.start_time,
                cancelledSlot.end_time,
                new Date(),
                HOSPITAL_TIMEZONE,
              )
            ) {
              const store = readShiftStore();
              const reopenedKey = makeSlotKey(
                cancelledSlot.doctor_id,
                cancelledSlot.slot_date,
                cancelledSlot.start_time,
              );
              if (!store.opened_slot_keys.includes(reopenedKey)) {
                store.opened_slot_keys.push(reopenedKey);
                writeShiftStore(store);
              }
            }

            // 2. Evaluate cancellation rule refund & 2-hour refund window if payment existed
            let refundPayload: Record<string, unknown> | null = null;
            let refundEval: ReturnType<typeof evaluateCancellationRefund> | null = null;
            if (pendingCancelContext.paid_amount > 0) {
              refundEval = evaluateCancellationRefund({
                rules: pendingCancelContext.cancellation_rules,
                slotDate: cancelledSlot?.slot_date ?? pendingCancelContext.appointment.slot_date,
                startTime: cancelledSlot?.start_time ?? pendingCancelContext.appointment.start_time,
                paidAmount: pendingCancelContext.paid_amount,
                timeZone: HOSPITAL_TIMEZONE,
              });
              saveAppointmentMetadata({
                consultation_mode:
                  normalizeConsultationModeInput(pendingCancelContext.appointment.consultation_mode) ||
                  'FACE_TO_FACE',
                rescheduled_from_id: pendingCancelContext.appointment.rescheduled_from_id ?? null,
                appointment_ref: pendingCancelContext.appointment.appointment_ref,
                appointment_id: pendingCancelContext.appointment.appointment_id,
                patient_id: pendingCancelContext.appointment.patient_id,
                slot_id: pendingCancelContext.appointment.slot_id,
                paid_amount: pendingCancelContext.paid_amount,
                payment_ref: pendingCancelContext.payment_ref,
                payment_method: pendingCancelContext.payment_method,
                payment_status: refundEval.refund_status || 'UNPAID',
                cancelled_at: refundEval.cancelled_at,
                refund_status: refundEval.refund_status,
                refund_due_at: refundEval.refund_due_at,
                refund_completed_at: null,
                refund_amount: refundEval.refund_amount,
                refund_percentage: refundEval.refund_percentage,
                refund_rule_name: refundEval.rule_name,
                cancellation_fee: refundEval.cancellation_fee,
                updated_at: refundEval.cancelled_at,
              });
              recordRbacAuditLog({
                actor_user_id: user.user_id,
                actor_name: user.full_name,
                actor_email: user.email,
                actor_role: user.role,
                target_label: pendingCancelContext.appointment.appointment_ref,
                action: 'APPOINTMENT_CANCELLED_REFUND',
                category: 'BILLING',
                previous_value: pendingCancelContext.appointment.status,
                new_value: refundEval.refund_status || 'CANCELLED',
                details:
                  refundEval.refund_status === 'REFUND_PENDING'
                    ? `Cancelled by ${user.full_name} (${user.role}): ${pendingCancelContext.appointment.appointment_ref}; ₹${refundEval.refund_amount.toFixed(2)} (${refundEval.refund_percentage}% via ${refundEval.rule_name}) scheduled to refund within 2 hours.`
                    : `Cancelled by ${user.full_name} (${user.role}): ${pendingCancelContext.appointment.appointment_ref}; 0% refund per ${refundEval.rule_name}.`,
                severity: 'info',
              });
              refundPayload = {
                applicable: refundEval.applicable,
                refund_status: refundEval.refund_status,
                refund_amount: refundEval.refund_amount,
                refund_percentage: refundEval.refund_percentage,
                refund_rule_name: refundEval.rule_name,
                refund_due_at: refundEval.refund_due_at,
              };
            }

            // Always record exact cancellation actor for BOTH paid and unpaid cancellations
            recordRbacAuditLog({
              actor_user_id: user.user_id,
              actor_name: user.full_name,
              actor_email: user.email,
              actor_role: user.role,
              target_label: pendingCancelContext.appointment.appointment_ref,
              action: 'APPOINTMENT_CANCELLED',
              category: 'APPOINTMENTS',
              previous_value: pendingCancelContext.appointment.status,
              new_value: refundEval ? `CANCELLED (${refundEval.refund_status})` : 'CANCELLED',
              details: describeCancellationAuditDetails({
                actorName: user.full_name,
                actorRole: user.role,
                appointmentRef: pendingCancelContext.appointment.appointment_ref,
                patientName: pendingCancelContext.appointment.patient_name,
                doctorName: pendingCancelContext.doctor_name,
                slotDate:
                  getIsoDatePart(cancelledSlot?.slot_date ?? pendingCancelContext.appointment.slot_date) ||
                  null,
                startTime: cancelledSlot?.start_time ?? pendingCancelContext.appointment.start_time,
                previousStatus: pendingCancelContext.appointment.status,
                paidAmount: pendingCancelContext.paid_amount,
                refundStatus: refundEval?.refund_status ?? null,
                refundAmount: refundEval?.refund_amount ?? 0,
                refundPercentage: refundEval?.refund_percentage ?? 0,
                ruleName: refundEval?.rule_name ?? null,
              }),
              severity: 'warning',
            });

            res.status(upstream.status).json({
              ...parsedBody,
              ...(refundPayload ? { refund: refundPayload } : {}),
            });
            return;
          }
        } catch {
          // Fall through to raw ORDS response if parsing fails
        }
      }

      if (mutationSucceeded && subPath === 'payments' && method === 'POST') {
        try {
          const parsedBody = parsedMutationBody || {};
          const reqPayStatus = String(outgoingBody?.status || 'SUCCESS').trim().toUpperCase();
          const payApptId = Number(outgoingBody?.appointment_id);
          const payAmt = Number(outgoingBody?.amount || 0);
          const payMethod = String(outgoingBody?.payment_method || 'UPI').trim().toUpperCase();
          const paymentRef =
            typeof parsedBody?.payment_ref === 'string' ? parsedBody.payment_ref : null;
          const appts = await fetchOrdsItems<Appointment>('appointments').catch(
            () => [] as Appointment[],
          );
          const matched = appts.find((a) => a.appointment_id === payApptId);
          if (payApptId > 0 && reqPayStatus === 'SUCCESS') {
            saveAppointmentMetadata({
              consultation_mode:
                normalizeConsultationModeInput(matched?.consultation_mode) || 'FACE_TO_FACE',
              rescheduled_from_id: matched?.rescheduled_from_id ?? null,
              appointment_ref: matched?.appointment_ref ?? null,
              appointment_id: payApptId,
              patient_id: matched?.patient_id,
              slot_id: matched?.slot_id,
              payment_status: 'SUCCESS',
              paid_amount: payAmt,
              payment_ref: paymentRef,
              payment_method: payMethod,
              paid_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
          recordRbacAuditLog({
            actor_user_id: user.user_id,
            actor_name: user.full_name,
            actor_email: user.email,
            actor_role: user.role,
            target_label: matched?.appointment_ref || `Appointment #${payApptId}`,
            action: reqPayStatus === 'FAILED' ? 'PAYMENT_FAILED' : 'PAYMENT_RECORDED',
            category: 'BILLING',
            new_value: `${reqPayStatus} · ₹${payAmt.toFixed(2)}`,
            details: `${user.full_name} (${user.role}) recorded ${reqPayStatus} payment of ₹${payAmt.toFixed(2)} via ${payMethod}${paymentRef ? ` (${paymentRef})` : ''} for ${matched?.appointment_ref || `Appointment #${payApptId}`}${matched?.patient_name ? ` (${matched.patient_name})` : ''}.`,
            severity: reqPayStatus === 'FAILED' ? 'warning' : 'info',
          });
        } catch {
          // Non-fatal metadata/audit sync
        }
      }

      if (mutationSucceeded && subPath === 'leaves' && method === 'POST') {
        const leaveId = parsedMutationBody?.leave_id;
        const startDate = String(outgoingBody?.start_date || '').slice(0, 10);
        const endDate = String(outgoingBody?.end_date || '').slice(0, 10);
        const leaveReason = String(outgoingBody?.leave_reason || '').trim();
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: `${user.full_name} · ${startDate} to ${endDate}${leaveId ? ` (#${leaveId})` : ''}`,
          action: 'LEAVE_REQUEST_SUBMITTED',
          category: 'SHIFTS_LEAVES',
          new_value: 'PENDING',
          details: `${user.full_name} (${user.role}) submitted doctor leave request for ${startDate} to ${endDate}${leaveReason ? `. Reason: ${leaveReason}` : ''}.`,
          severity: 'info',
        });
      }

      if (mutationSucceeded && pendingLeaveDecisionContext) {
        const lv = pendingLeaveDecisionContext.leave;
        const docLabel = lv?.doctor_name || (lv?.doctor_id ? `Doctor #${lv.doctor_id}` : `Leave #${pendingLeaveDecisionContext.leave_id}`);
        const rangeLabel = lv ? `${getIsoDatePart(lv.start_date)} to ${getIsoDatePart(lv.end_date)}` : `Leave #${pendingLeaveDecisionContext.leave_id}`;
        const decision = pendingLeaveDecisionContext.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: `${docLabel} · ${rangeLabel} (#${pendingLeaveDecisionContext.leave_id})`,
          action: decision === 'APPROVED' ? 'LEAVE_REQUEST_APPROVED' : 'LEAVE_REQUEST_REJECTED',
          category: 'SHIFTS_LEAVES',
          previous_value: lv?.leave_status || 'PENDING',
          new_value: decision,
          details: `${user.full_name} (${user.role}) ${decision.toLowerCase()} leave request #${pendingLeaveDecisionContext.leave_id} for ${docLabel} (${rangeLabel})${pendingLeaveDecisionContext.comments ? ` · Notes: ${pendingLeaveDecisionContext.comments}` : ''}.`,
          severity: decision === 'REJECTED' ? 'warning' : 'info',
        });
      }

      if (mutationSucceeded && subPath.startsWith('slots') && method !== 'GET') {
        const slotAction =
          method === 'POST' ? 'SLOT_CREATED' : method === 'DELETE' ? 'SLOT_CANCELLED' : 'SLOT_UPDATED';
        const slotDesc = subPath === 'slots'
          ? `${String(outgoingBody?.slot_date || '').slice(0, 10)} ${outgoingBody?.start_time || ''}-${outgoingBody?.end_time || ''}`.trim()
          : subPath;
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: slotDesc || subPath,
          action: slotAction,
          category: 'SHIFTS_LEAVES',
          new_value: method === 'DELETE' ? 'CANCELLED' : String(outgoingBody?.status || 'AVAILABLE'),
          details: `${user.full_name} (${user.role}) performed ${slotAction} (${slotDesc || subPath}).`,
          severity: method === 'DELETE' ? 'warning' : 'info',
        });
      }

      if (mutationSucceeded && subPath.startsWith('token_queue') && method !== 'GET') {
        const isIssue = method === 'POST';
        const nextTokenStatus = String(outgoingBody?.status || (isIssue ? 'WAITING' : 'UPDATED')).toUpperCase();
        const targetId = isIssue
          ? `Appt #${outgoingBody?.appointment_id || ''}`
          : subPath;
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: targetId,
          action: isIssue ? 'TOKEN_ISSUED' : 'TOKEN_STATUS_UPDATED',
          category: 'OPERATIONS',
          new_value: nextTokenStatus,
          details: `${user.full_name} (${user.role}) ${isIssue ? `checked in and issued token (${parsedMutationBody?.token_number ? `#${parsedMutationBody.token_number} ` : ''}for ${targetId})` : `updated queue entry ${subPath} to ${nextTokenStatus}`}.`,
          severity: 'info',
        });
      }

      if (mutationSucceeded && /^patients\/\d+$/.test(subPath) && method === 'PUT') {
        const patId = Number(subPath.split('/')[1]);
        const patLabel = [outgoingBody?.first_name, outgoingBody?.last_name].filter(Boolean).join(' ') || `Patient #${patId}`;
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: `${patLabel} (#${patId})`,
          action: 'PATIENT_UPDATED',
          category: 'OPERATIONS',
          details: `${user.full_name} (${user.role}) updated patient profile #${patId}${pendingPatientRegion ? ` (${pendingPatientRegion.city}, ${pendingPatientRegion.locality})` : ''}.`,
          severity: 'info',
        });
      }

      if (mutationSucceeded && subPath.startsWith('doctors/') && (method === 'PUT' || method === 'DELETE')) {
        const docName = [outgoingBody?.first_name, outgoingBody?.last_name].filter(Boolean).join(' ');
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: docName ? `Dr. ${docName} (${subPath})` : subPath,
          action: method === 'DELETE' ? 'DOCTOR_DEACTIVATED' : 'DOCTOR_UPDATED',
          category: 'OPERATIONS',
          details: `${user.full_name} (${user.role}) ${method === 'DELETE' ? 'deactivated' : 'updated'} doctor record (${subPath}).`,
          severity: method === 'DELETE' ? 'warning' : 'info',
        });
      }

      if (mutationSucceeded && subPath.startsWith('departments') && method !== 'GET') {
        const deptName = String(outgoingBody?.department_name || subPath).trim();
        const deptAction =
          method === 'POST' ? 'DEPARTMENT_CREATED' : method === 'DELETE' ? 'DEPARTMENT_DEACTIVATED' : 'DEPARTMENT_UPDATED';
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: deptName,
          action: deptAction,
          category: 'OPERATIONS',
          details: `${user.full_name} (${user.role}) ${deptAction.toLowerCase().replace('department_', '')} department (${deptName}).`,
          severity: method === 'DELETE' ? 'warning' : 'info',
        });
      }

      if (mutationSucceeded && subPath.startsWith('consultation-types') && method !== 'GET') {
        const ctName = String(outgoingBody?.consultation_type_name || subPath).trim();
        const ctAction =
          method === 'POST'
            ? 'CONSULTATION_TYPE_CREATED'
            : method === 'DELETE'
              ? 'CONSULTATION_TYPE_DEACTIVATED'
              : 'CONSULTATION_TYPE_UPDATED';
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: ctName,
          action: ctAction,
          category: 'OPERATIONS',
          details: `${user.full_name} (${user.role}) ${ctAction.toLowerCase().replace('consultation_type_', '')} consultation type (${ctName}).`,
          severity: method === 'DELETE' ? 'warning' : 'info',
        });
      }

      if (mutationSucceeded && subPath.startsWith('users') && method !== 'GET') {
        const userLabel =
          String(outgoingBody?.email || outgoingBody?.username || outgoingBody?.full_name || subPath).trim();
        const userAction =
          method === 'POST' ? 'USER_ORDS_CREATED' : method === 'DELETE' ? 'USER_ORDS_DEACTIVATED' : 'USER_ORDS_UPDATED';
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: userLabel,
          action: userAction,
          category: 'USER',
          details: `${user.full_name} (${user.role}) executed ${method} on ORDS ${subPath} for ${userLabel}.`,
          severity: method === 'DELETE' ? 'warning' : 'info',
        });
      }

      if (mutationSucceeded && subPath.startsWith('cancellation-rules') && method !== 'GET') {
        const ruleLabel = String(outgoingBody?.rule_name || subPath).trim();
        const ruleAction =
          method === 'POST'
            ? 'CANCELLATION_RULE_CREATED'
            : method === 'DELETE'
              ? 'CANCELLATION_RULE_DELETED'
              : 'CANCELLATION_RULE_UPDATED';
        recordRbacAuditLog({
          actor_user_id: user.user_id,
          actor_name: user.full_name,
          actor_email: user.email,
          actor_role: user.role,
          target_label: ruleLabel,
          action: ruleAction,
          category: 'BILLING',
          details: `${user.full_name} (${user.role}) ${ruleAction.toLowerCase().replace('cancellation_rule_', '')} cancellation refund rule (${ruleLabel}).`,
          severity: method === 'DELETE' ? 'warning' : 'info',
        });
      }

      // Persist patient city & locality and auto-provision GIRISH_USERS portal login
      if (upstream.ok && /^patients\/\d+$/.test(subPath) && method === 'PUT' && pendingPatientRegion) {
        const updatedId = Number(subPath.split('/')[1]);
        if (updatedId > 0) {
          savePatientRegion(updatedId, pendingPatientRegion.city, pendingPatientRegion.locality);
        }
      }

      if (upstream.ok && subPath === 'patients' && method === 'POST') {
        try {
          const parsedBody = text ? JSON.parse(text) : {};
          const patEmail = String(outgoingBody.email || '').trim().toLowerCase();
          const patPhone = String(outgoingBody.phone_number || '').trim();
          const fn = String(outgoingBody.first_name || '').trim();
          const ln = String(outgoingBody.last_name || '').trim();
          if (parsedBody?.status !== 'error') {
            const [patientsList, existingUsers] = await Promise.all([
              fetchOrdsItems<Patient>('patients').catch(() => [] as Patient[]),
              fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]),
            ]);
            const createdPat =
              (patEmail
                ? patientsList
                    .filter((p) => (p.email || '').trim().toLowerCase() === patEmail)
                    .sort((a, b) => b.patient_id - a.patient_id)[0]
                : undefined) ||
              (patPhone
                ? patientsList
                    .filter(
                      (p) => normalizePhoneDigits(p.phone_number) === normalizePhoneDigits(patPhone),
                    )
                    .sort((a, b) => b.patient_id - a.patient_id)[0]
                : undefined);

            if (createdPat && pendingPatientRegion) {
              savePatientRegion(
                createdPat.patient_id,
                pendingPatientRegion.city,
                pendingPatientRegion.locality,
              );
            }

            if (
              createdPat &&
              patEmail &&
              fn &&
              ln &&
              !existingUsers.some((u) => (u.email || '').toLowerCase() === patEmail)
            ) {
              const slug = `${fn}.${ln}`.toLowerCase().replace(/[^a-z0-9]+/g, '.');
              await fetchOrdsJson('users', {
                method: 'POST',
                body: JSON.stringify({
                  username: `${slug}.${createdPat.patient_id}`,
                  email: patEmail,
                  full_name: `${fn} ${ln}`,
                  password: process.env.DEMO_PATIENT_PASSWORD || 'Patient@123',
                  role_name: 'PATIENT',
                  phone_number: patPhone || undefined,
                }),
              }).catch(() => null);
            }

            recordRbacAuditLog({
              actor_user_id: user.user_id,
              actor_name: user.full_name,
              actor_email: user.email,
              actor_role: user.role,
              target_user_id: createdPat?.patient_id ?? null,
              target_label: `${fn} ${ln}${patEmail ? ` (${patEmail})` : ''}${createdPat ? ` #${createdPat.patient_id}` : ''}`,
              action: 'PATIENT_REGISTERED',
              category: 'OPERATIONS',
              new_value: pendingPatientRegion
                ? `${pendingPatientRegion.city}, ${pendingPatientRegion.locality}`
                : 'PATIENT:ACTIVE',
              details: `${user.full_name} (${user.role}) registered patient ${fn} ${ln}${createdPat ? ` (ID #${createdPat.patient_id})` : ''}${pendingPatientRegion ? ` in ${pendingPatientRegion.city}, ${pendingPatientRegion.locality}` : ''}.`,
              severity: 'info',
            });
          }
        } catch {
          // Non-fatal: fallback login still matches GIRISH_PATIENTS
        }
      }

      // Auto-provision GIRISH_USERS portal login when Admin registers a new Doctor
      if (upstream.ok && subPath === 'doctors' && method === 'POST') {
        try {
          const parsedBody = text ? JSON.parse(text) : {};
          if (parsedBody?.status !== 'error') {
            const docs = await fetchOrdsItems<Doctor>('doctors');
            const fn = String(outgoingBody.first_name || '').trim();
            const ln = String(outgoingBody.last_name || '').trim();
            const matchingDocs = docs
              .filter(
                (d) =>
                  d.first_name.trim().toLowerCase() === fn.toLowerCase() &&
                  d.last_name.trim().toLowerCase() === ln.toLowerCase(),
              )
              .sort((a, b) => b.doctor_id - a.doctor_id);
            const createdDoc = matchingDocs[0];
            if (createdDoc) {
              const existingUsers = await fetchOrdsItems<UserAccount>('users').catch(
                () => [] as UserAccount[],
              );
              const slug = `${createdDoc.first_name}.${createdDoc.last_name}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '.');
              let candidateEmail = doctorLoginEmail || `${slug}@hospital.com`;
              if (existingUsers.some((u) => (u.email || '').toLowerCase() === candidateEmail)) {
                candidateEmail = `${slug}.${createdDoc.doctor_id}@hospital.com`;
              }
              const candidateUsername = `${slug}.${createdDoc.doctor_id}`;
              await fetchOrdsJson('users', {
                method: 'POST',
                body: JSON.stringify({
                  username: candidateUsername,
                  email: candidateEmail,
                  full_name: `Dr. ${createdDoc.first_name} ${createdDoc.last_name}`,
                  password: doctorInitialPassword,
                  role_name: 'DOCTOR',
                  doctor_id: createdDoc.doctor_id,
                }),
              }).catch(() => null);

              recordRbacAuditLog({
                actor_user_id: user.user_id,
                actor_name: user.full_name,
                actor_email: user.email,
                actor_role: user.role,
                target_label: `Dr. ${createdDoc.first_name} ${createdDoc.last_name} (${candidateEmail})`,
                action: 'DOCTOR_CREATED',
                category: 'OPERATIONS',
                new_value: `Doctor #${createdDoc.doctor_id}`,
                details: `${user.full_name} (${user.role}) registered Dr. ${createdDoc.first_name} ${createdDoc.last_name} (#${createdDoc.doctor_id}) with portal email ${candidateEmail}.`,
                severity: 'info',
              });

              res.status(upstream.status).json({
                ...parsedBody,
                doctor_id: createdDoc.doctor_id,
                login_email: candidateEmail,
              });
              return;
            }
          }
        } catch {
          // Return original ORDS response if user auto-provisioning fails
        }
      }

      // Enforce row-level privacy isolation & normalize OIC/ORDS collection payloads on GET
      if (upstream.ok && method === 'GET' && text.trim()) {
        try {
          const parsed = normalizeBackendPayload(JSON.parse(text)) as { items?: unknown[] };
          if (Array.isArray(parsed.items)) {
            if (subPath === 'patients' && user.role === 'PATIENT') {
              parsed.items = attachRegionsToPatients(
                (parsed.items as Patient[]).filter((p) => p.patient_id === user.patient_id),
              );
            } else if (subPath === 'patients' && user.role === 'DOCTOR') {
              if (!user.doctor_id) {
                parsed.items = [];
              } else {
                const bookedIds = await getBookedPatientIdsForDoctor(user.doctor_id);
                parsed.items = attachRegionsToPatients(
                  (parsed.items as Patient[]).filter((p) => bookedIds.has(p.patient_id)),
                );
              }
            } else if (subPath.startsWith('patients')) {
              parsed.items = attachRegionsToPatients(parsed.items as Patient[]);
            } else if (subPath === 'appointments' || subPath === 'appointments/') {
              let rawAppts = parsed.items as Appointment[];
              if (await ensureOverdueHoldsExpired({ appointmentsHint: rawAppts })) {
                rawAppts = await fetchOrdsItems<Appointment>('appointments');
                trackNextHoldExpiry(rawAppts);
              }
              const rawPayments = await fetchOrdsItems<Payment>('payments').catch(() => [] as Payment[]);
              let appts = attachConsultationMode(rawAppts, attachRefundsToPayments(rawPayments));
              if (user.role === 'PATIENT') {
                appts = appts.filter((a) => a.patient_id === user.patient_id);
              } else if (user.role === 'DOCTOR') {
                const [slots, templates] = await Promise.all([
                  fetchOrdsItems<Slot>('slots'),
                  fetchSlotTemplatesSafe(),
                ]);
                const tmplDoctorMap = buildTemplateDoctorMap(templates);
                const docSlotIds = new Set(
                  slots
                    .filter((s) => resolveSlotDoctorId(s, tmplDoctorMap) === user.doctor_id)
                    .map((s) => s.slot_id),
                );
                appts = appts.filter((a) => docSlotIds.has(a.slot_id));
              }
              parsed.items = appts;
            } else if (subPath === 'payments') {
              let paymentRows = attachRefundsToPayments(parsed.items as Payment[]);
              if (user.role === 'PATIENT') {
                const appts = await fetchOrdsItems<Appointment>('appointments');
                const myApptIds = new Set(
                  appts.filter((a) => a.patient_id === user.patient_id).map((a) => a.appointment_id),
                );
                paymentRows = paymentRows.filter((p) => myApptIds.has(p.appointment_id));
              }
              parsed.items = paymentRows;
            } else if (subPath === 'token_queue' && user.role === 'PATIENT') {
              const appts = await fetchOrdsItems<Appointment>('appointments');
              const myApptIds = new Set(
                appts.filter((a) => a.patient_id === user.patient_id).map((a) => a.appointment_id),
              );
              parsed.items = parsed.items.filter((t) =>
                myApptIds.has((t as TokenQueueItem).appointment_id),
              );
            } else if (subPath === 'slots') {
              const templates = await fetchSlotTemplatesSafe();
              parsed.items = filterConfirmedSlots(parsed.items as Slot[], templates);
            } else if (subPath === 'leaves') {
              parsed.items = scopeLeavesForUser(parsed.items as DoctorLeave[], user);
            } else if (subPath === 'shift-change-requests' && !canViewAllShiftChangeRequests(user)) {
              parsed.items =
                user.role === 'DOCTOR' && user.doctor_id
                  ? parsed.items.filter(
                      (r) => Number((r as { doctor_id?: number }).doctor_id) === user.doctor_id,
                    )
                  : [];
            }
            res.status(upstream.status).json(parsed);
            return;
          }
          res.status(upstream.status).json(parsed);
          return;
        } catch {
          // Fall through to raw upstream response
        }
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      res.send(text);
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'ORDS proxy request failed',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  setInterval(() => {
    syncDueRefunds();
    if (knownNextHoldExpiryMs !== null && Date.now() < knownNextHoldExpiryMs) return;
    void ensureOverdueHoldsExpired().catch(() => {});
  }, 15_000).unref();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CarePulse OPD server listening on http://localhost:${PORT}`);
    if (OIC_CONFIGURED) {
      console.log(
        `Backend routing: ${backendState.mode} | OIC configured: YES (${OIC_OAUTH_CONFIGURED ? 'OAuth 2.0' : 'Basic'})`,
      );
    } else {
      const missingOicVars = [
        !OIC_BASE_URL && 'OIC_BASE_URL',
        !OIC_TOKEN_URL && 'OIC_TOKEN_URL',
        !OIC_CLIENT_ID && 'OIC_CLIENT_ID',
        !OIC_CLIENT_SECRET && 'OIC_CLIENT_SECRET',
      ].filter(Boolean);
      console.log(
        `Backend routing: ${backendState.mode} | OIC configured: NO (missing in .env: ${missingOicVars.join(', ')})`,
      );
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
