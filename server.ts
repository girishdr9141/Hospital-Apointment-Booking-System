import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
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
  ConsultationMode,
  DashboardSummaryResponse,
  Department,
  Doctor,
  DoctorLeave,
  DoctorShiftConfig,
  ModuleKey,
  Patient,
  Payment,
  PendingOutcomeItem,
  PermissionAction,
  PortalNotification,
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
  isSlotStartExpired,
  isValidSlotTimeRange,
  validateShiftSessions,
} from './src/utils/calendar.ts';
import {
  DEFAULT_SEEDED_PATIENT_REGIONS,
  normalizeRegionText,
  type PatientRegion,
} from './src/utils/regions.ts';
import {
  deriveDeterministicConsultationMode,
  generateHistoricalAnalyticsSeed,
} from './src/utils/analyticsSeed.ts';
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
  verifyPasswordScrypt,
  writeRbacStore,
} from './server/rbacStore.ts';
import {
  readClinicalStore,
  writeClinicalStore,
  type PatientNotificationRecord,
} from './server/clinicalStore.ts';

const HOSPITAL_TIMEZONE = process.env.HOSPITAL_TIMEZONE || DEFAULT_HOSPITAL_TIMEZONE;
function getServerTodayIso(): string {
  return getTodayIsoLocal(new Date(), HOSPITAL_TIMEZONE);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ORDS_BASE_URL = (
  process.env.ORDS_BASE_URL ||
  'https://ga97be9115f23e9-moviestreamworkshop.adb.ap-mumbai-1.oraclecloudapps.com/ords/nov_2026_batch/girish_opd_api/v1'
).replace(/\/+$/, '');
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

async function fetchOrdsJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const url = `${ORDS_BASE_URL}/${endpoint.replace(/^\/+/, '')}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }
  if (!response.ok) {
    const err = new Error(normalizeOrdsError(parsed, `ORDS returned HTTP ${response.status}`));
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

async function runOrdsExpireHolds(): Promise<number> {
  if (inFlightExpireHolds) return inFlightExpireHolds;
  inFlightExpireHolds = (async () => {
    try {
      const res = await fetchOrdsJson<{ status?: string; expired_count?: number }>(
        'appointments/expire-holds',
        { method: 'POST', body: '{}' },
      );
      lastExpireHoldsCheckMs = Date.now();
      knownNextHoldExpiryMs = null;
      return Number(res?.expired_count || 0);
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
}): Promise<boolean> {
  if (options?.appointmentsHint) {
    trackNextHoldExpiry(options.appointmentsHint);
    if (!options.force && !options.appointmentsHint.some((a) => isAppointmentHoldExpired(a))) {
      return false;
    }
    const expired = await runOrdsExpireHolds();
    return expired > 0;
  }

  const now = Date.now();
  const dueByKnownHold = knownNextHoldExpiryMs !== null && now >= knownNextHoldExpiryMs;
  const dueByInterval = now - lastExpireHoldsCheckMs >= 30_000;
  if (!options?.force && !dueByKnownHold && !dueByInterval) {
    return false;
  }
  const expired = await runOrdsExpireHolds();
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
  if (entry.appointment_id && entry.appointment_id > 0) {
    store[`id:${entry.appointment_id}`] = entry;
  }
  if (entry.appointment_ref) {
    store[`ref:${entry.appointment_ref}`] = entry;
  }
  fs.mkdirSync(SHIFT_STORE_DIR, { recursive: true });
  fs.writeFileSync(APPT_METADATA_PATH, JSON.stringify(store, null, 2), 'utf8');
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

function attachConsultationMode(appointments: Appointment[]): Appointment[] {
  const meta = readAppointmentMetadata();
  return appointments.map((a) => {
    const directMode = normalizeConsultationModeInput(a.consultation_mode);
    const metaEntry = meta[`id:${a.appointment_id}`] || (a.appointment_ref ? meta[`ref:${a.appointment_ref}`] : undefined);
    const mode: ConsultationMode = directMode || metaEntry?.consultation_mode || 'FACE_TO_FACE';
    const rescheduledFrom = a.rescheduled_from_id ?? metaEntry?.rescheduled_from_id ?? null;
    const effectiveStatus =
      a.status === 'CONFIRMED' &&
      (metaEntry?.recorded_outcome === 'COMPLETED' || metaEntry?.recorded_outcome === 'NO_SHOW')
        ? metaEntry.recorded_outcome
        : a.status;
    return {
      ...a,
      status: effectiveStatus,
      consultation_mode: mode,
      rescheduled_from_id: rescheduledFrom,
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

function attachDoctorIdsToSlots(
  rawSlots: Slot[],
  templates: SlotTemplate[],
  store = readShiftStore(),
): Slot[] {
  const tmplDoctorMap = buildTemplateDoctorMap(templates, store);
  return rawSlots.map((s) => {
    const resolvedDocId = s.doctor_id ?? tmplDoctorMap.get(s.template_id);
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
      const doctorId = s.doctor_id ?? tmplDoctorMap.get(s.template_id);
      if (!doctorId) return false;
      return openedSet.has(makeSlotKey(doctorId, s.slot_date, s.start_time));
    })
    .map((s) => {
      const doctorId = s.doctor_id ?? tmplDoctorMap.get(s.template_id);
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
  const existingTemplates = await fetchOrdsItems<SlotTemplate>('slot_templates');
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
}

async function getBookedPatientIdsForDoctor(doctorId: number): Promise<Set<number>> {
  const [appointments, slots, templates] = await Promise.all([
    fetchOrdsItems<Appointment>('appointments'),
    fetchOrdsItems<Slot>('slots'),
    fetchOrdsItems<SlotTemplate>('slot_templates'),
  ]);
  const tmplDoctorMap = buildTemplateDoctorMap(templates);
  const docSlotIds = new Set(
    slots
      .filter((s) => (s.doctor_id ?? tmplDoctorMap.get(s.template_id)) === doctorId)
      .map((s) => s.slot_id),
  );
  return new Set(
    appointments.filter((a) => docSlotIds.has(a.slot_id)).map((a) => a.patient_id),
  );
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

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
      const ordsAuth = await fetchOrdsJson<{ status?: string; message?: string; user?: AuthUser }>(
        'auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            identifier: emailInput,
            email: emailInput,
            full_name: fullNameInput,
            password,
          }),
        },
      );
      if (ordsAuth.status === 'success' && ordsAuth.user) {
        const candidate: AuthUser = {
          ...ordsAuth.user,
          auth_mode: 'ords',
        };

        const resolvedViaOverride = Boolean(
          store.user_role_overrides[normalizeUserKey(candidate.email, candidate.user_id)],
        );
        if (candidate.role === 'ADMIN' && !isSingleAdminUser(candidate) && !resolvedViaOverride) {
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
      if (ordsAuth.status === 'error') {
        const msg = (ordsAuth.message || '').toLowerCase();
        if (
          msg.includes('invalid email') ||
          msg.includes('no account found') ||
          msg.includes('not found')
        ) {
          ordsUnavailableOrNotFound = true;
        } else {
          failLogin(401, ordsAuth.message || 'Invalid credentials');
          return;
        }
      }
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      if (!statusCode || statusCode === 404 || statusCode === 405) {
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
        actor_role: 'PATIENT',
        target_user_id: hydrated.user_id,
        target_label: hydrated.email,
        action: 'USER_REGISTERED',
        category: 'AUTH',
        new_value: 'PATIENT:ACTIVE',
        details: `Self-registered patient account (${city}, ${locality}).`,
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
      const ordsReg = await fetchOrdsJson<{ status?: string; message?: string; user?: AuthUser }>(
        'auth/register',
        {
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
        },
      );
      if (ordsReg.status === 'success' && ordsReg.user) {
        const user: AuthUser = { ...ordsReg.user, auth_mode: 'ords' };
        let resolvedPatientId = user.patient_id ?? null;
        if (!resolvedPatientId) {
          const matches = await fetchOrdsItems<Patient>(
            `patients?phone=${encodeURIComponent(phone_number)}`,
          ).catch(() => [] as Patient[]);
          resolvedPatientId = matches[0]?.patient_id ?? null;
          if (resolvedPatientId) user.patient_id = resolvedPatientId;
        }
        if (resolvedPatientId) {
          savePatientRegion(resolvedPatientId, city, locality);
        }
        finishRegister(user, 201);
        return;
      }
      if (ordsReg.status === 'error') {
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
        actor_role: rawUser.role,
        target_label: rawUser.email,
        action: 'LOGOUT',
        category: 'AUTH',
        details: 'User signed out cleanly.',
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
        fetchOrdsItems<SlotTemplate>('slot_templates'),
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

      const shiftStore = readShiftStore();
      const confirmedRawSlots = filterConfirmedSlots(rawSlots, templates, shiftStore);
      const rawSlotsWithDoctors = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const fullSlotsForApptJoin = enrichSlots(rawSlotsWithDoctors, templates, doctors, departmentsForJoin);
      const enrichedSlots = enrichSlots(confirmedRawSlots, templates, doctors, departmentsForJoin);
      const enrichedAppointments = enrichAppointments(
        attachConsultationMode(rawAppointments),
        fullSlotsForApptJoin,
        doctors,
      );
      const todayIso = getServerTodayIso();

      let scopedAppointments = enrichedAppointments;
      let scopedSlots = enrichedSlots;
      let scopedPayments = hasEffectivePermission(user.permissions, user.role, 'PAYMENTS:VIEW')
        ? payments
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
            !isSlotStartExpired(s.slot_date, s.start_time, new Date(), HOSPITAL_TIMEZONE),
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
      if (isHospitalAdminOrSuper(user) || hasEffectivePermission(user.permissions, user.role, 'SLOTS:UPDATE')) {
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
              !isSlotStartExpired(s.slot_date, s.start_time, new Date(), HOSPITAL_TIMEZONE),
          ).length,
          total_slots_today: referenceSlots.length,
          total_payments_amount: scopedPayments
            .filter((p) => p.status === 'SUCCESS')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0),
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
          fetchOrdsItems<SlotTemplate>('slot_templates'),
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
      const paymentByApptId = new Map<number, Payment>();
      for (const p of payments) {
        if (p.status === 'SUCCESS') {
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
    const shiftStore = readShiftStore();
    const ackKey = `${user.role}:${user.user_id}`;
    const dismissed = new Set(readNotificationAcks()[ackKey] || []);
    const list: PortalNotification[] = [];

    if (
      isHospitalAdminOrSuper(user) ||
      hasEffectivePermission(user.permissions, user.role, 'SLOTS:UPDATE')
    ) {
      for (const reqItem of shiftStore.change_requests) {
        if (reqItem.status === 'PENDING') {
          const id = `shift-req-${reqItem.request_id}`;
          list.push({
            id,
            category: 'SHIFT_REQUEST',
            title: `Shift change request from ${reqItem.doctor_name}`,
            message: `Requested ${formatShiftSummary(reqItem.requested_sessions, reqItem.requested_slot_duration_mins)} · ${reqItem.reason}`,
            route: 'approvals',
            created_at: reqItem.requested_on,
            read: dismissed.has(id),
            severity: 'warning',
          });
        }
      }

      const leaves = await fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]);

      for (const lv of leaves) {
        if (lv.leave_status === 'PENDING') {
          const id = `leave-req-${lv.leave_id}`;
          list.push({
            id,
            category: 'LEAVE_REQUEST',
            title: `Leave request from ${lv.doctor_name || `Doctor #${lv.doctor_id}`}`,
            message: `${formatDisplayDate(lv.start_date)} – ${formatDisplayDate(lv.end_date)}${lv.leave_reason ? ` · ${lv.leave_reason}` : ''}`,
            route: 'doctor-leaves',
            created_at: lv.requested_on || '',
            read: dismissed.has(id),
            severity: 'warning',
          });
        }
      }
    } else if (user.role === 'DOCTOR' && user.doctor_id) {
      const [rawAppts, rawSlots, templates, doctors, leaves] = await Promise.all([
        fetchOrdsItems<Appointment>('appointments').catch(() => [] as Appointment[]),
        fetchOrdsItems<Slot>('slots').catch(() => [] as Slot[]),
        fetchOrdsItems<SlotTemplate>('slot_templates').catch(() => [] as SlotTemplate[]),
        fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
        fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]),
      ]);

      const rawSlotsWithDoctors = attachDoctorIdsToSlots(rawSlots, templates, shiftStore);
      const joinedSlots = enrichSlots(rawSlotsWithDoctors, templates, doctors, []);
      const docAppts = enrichAppointments(rawAppts, joinedSlots, doctors).filter(
        (a) => a.doctor_id === user.doctor_id && ['HELD', 'CONFIRMED'].includes(a.status),
      );

      for (const a of docAppts) {
        const id = `doc-appt-${a.appointment_id}-${a.status}`;
        list.push({
          id,
          category: 'NEW_APPOINTMENT',
          title: `Appointment ${a.status.toLowerCase()}: ${a.patient_name}`,
          message: `${a.appointment_ref} · ${a.slot_date ? formatDisplayDate(a.slot_date) : ''} ${a.start_time || ''}`.trim(),
          route: 'appointments',
          created_at: a.created_on || '',
          read: dismissed.has(id),
          severity: 'info',
        });
      }

      for (const reqItem of shiftStore.change_requests) {
        if (reqItem.doctor_id === user.doctor_id && reqItem.status !== 'PENDING') {
          const id = `shift-resp-${reqItem.request_id}-${reqItem.status}`;
          list.push({
            id,
            category: 'ADMIN_RESPONSE',
            title: `Shift change request ${reqItem.status.toLowerCase()}`,
            message: `${formatShiftSummary(reqItem.requested_sessions, reqItem.requested_slot_duration_mins)}${reqItem.decision_comments ? ` · Note: ${reqItem.decision_comments}` : ''}`,
            route: 'slots',
            created_at: reqItem.decided_on || reqItem.requested_on,
            read: dismissed.has(id),
            severity: reqItem.status === 'APPROVED' ? 'success' : 'warning',
          });
        }
      }

      for (const lv of leaves) {
        if (lv.doctor_id === user.doctor_id && ['APPROVED', 'REJECTED'].includes(lv.leave_status)) {
          const id = `leave-resp-${lv.leave_id}-${lv.leave_status}`;
          list.push({
            id,
            category: 'ADMIN_RESPONSE',
            title: `Leave request ${lv.leave_status.toLowerCase()} by admin`,
            message: `${formatDisplayDate(lv.start_date)} – ${formatDisplayDate(lv.end_date)}${lv.leave_reason ? ` · ${lv.leave_reason}` : ''}`,
            route: 'doctor-leaves',
            created_at: lv.approved_on || lv.requested_on || '',
            read: dismissed.has(id),
            severity: lv.leave_status === 'APPROVED' ? 'success' : 'warning',
          });
        }
      }
    } else if (user.role === 'PATIENT' && user.patient_id) {
      const store = readClinicalStore();
      const myNotifs = store.patient_notifications.filter(
        (n) => n.patient_id === user.patient_id,
      );
      for (const n of myNotifs) {
        list.push({
          id: n.id,
          category:
            n.event_type === 'CREATED' ? 'PRESCRIPTION_CREATED' : 'PRESCRIPTION_UPDATED',
          title: n.title,
          message: n.message,
          route: 'prescriptions',
          created_at: n.created_at,
          read: dismissed.has(n.id),
          severity: 'success',
          doctor_name: n.doctor_name,
          appointment_ref: n.appointment_ref,
          prescription_id: n.prescription_id,
          patient_id: n.patient_id,
        });
      }
    }

    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return list;
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

  // Helper to resolve or create a weekday slot template for a doctor
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

    const refreshed = await fetchOrdsItems<SlotTemplate>('slot_templates');
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

  // Doctor Shift Window & Shift Change Approval Endpoints
  app.get('/api/doctor/shifts', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    try {
      const [doctors, templates] = await Promise.all([
        fetchOrdsItems<Doctor>('doctors'),
        fetchOrdsItems<SlotTemplate>('slot_templates'),
      ]);
      const store = readShiftStore();

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
        change_requests:
          isHospitalAdminOrSuper(user) ||
          hasEffectivePermission(user.permissions, user.role, 'SLOTS:UPDATE')
            ? store.change_requests
            : [],
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

      const [doctors, templates] = await Promise.all([
        fetchOrdsItems<Doctor>('doctors'),
        fetchOrdsItems<SlotTemplate>('slot_templates'),
      ]);
      const store = readShiftStore();
      const existing = resolveDoctorShift(user.doctor_id, templates, user.full_name, store);
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
      store.shifts[String(user.doctor_id)] = savedShift;
      writeShiftStore(store);

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

      const [doctors, templates] = await Promise.all([
        fetchOrdsItems<Doctor>('doctors'),
        fetchOrdsItems<SlotTemplate>('slot_templates'),
      ]);
      const store = readShiftStore();
      const alreadyPending = store.change_requests.find(
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
      const currentShift = resolveDoctorShift(user.doctor_id, templates, doctorName, store);

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

      store.change_requests.unshift(changeReq);
      writeShiftStore(store);

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

  app.get('/api/admin/shift-change-requests', requireAuth, (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'SLOTS:UPDATE', 'Shift Change Requests')) return;
    const store = readShiftStore();
    res.json({ status: 'success', requests: store.change_requests });
  });

  app.post('/api/admin/shift-change-requests/:id/decide', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (user.role === 'DOCTOR') {
      res.status(403).json({
        status: 'error',
        message: 'Doctors cannot approve or reject their own shift change requests.',
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

    const store = readShiftStore();
    const target = store.change_requests.find((r) => r.request_id === requestId);
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
      if (decision === 'APPROVED') {
        await syncShiftToOracleTemplates(
          target.doctor_id,
          target.requested_sessions,
          target.requested_slot_duration_mins,
          target.requested_working_days,
        );
        const existingShift = store.shifts[String(target.doctor_id)];
        store.shifts[String(target.doctor_id)] = {
          doctor_id: target.doctor_id,
          doctor_name: target.doctor_name,
          sessions: target.requested_sessions,
          slot_duration_mins: target.requested_slot_duration_mins,
          working_days: target.requested_working_days,
          is_registered: true,
          registered_at: existingShift?.registered_at || nowIso,
          updated_at: nowIso,
        };
      }

      target.status = decision as 'APPROVED' | 'REJECTED';
      target.decided_on = nowIso;
      target.decided_by = user.full_name;
      target.decision_comments = comments;
      writeShiftStore(store);

      res.json({
        status: 'success',
        message:
          decision === 'APPROVED'
            ? `Shift change approved for ${target.doctor_name} (${formatShiftSummary(target.requested_sessions, target.requested_slot_duration_mins)})`
            : `Shift change request rejected for ${target.doctor_name}`,
        request: target,
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
      if (isSlotStartExpired(s.slot_date, s.start_time, now, HOSPITAL_TIMEZONE)) {
        res.status(400).json({
          status: 'error',
          message: `Cannot generate slot starting at ${s.start_time} on ${s.slot_date}: start time must be after current hospital time (${nowParts.timeHHMM} ${HOSPITAL_TIMEZONE}).`,
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
        fetchOrdsItems<SlotTemplate>('slot_templates'),
        fetchOrdsItems<Slot>('slots'),
        fetchOrdsItems<DoctorLeave>('leaves').catch(() => [] as DoctorLeave[]),
      ]);

      const store = readShiftStore();
      const openedSet = new Set(store.opened_slot_keys);

      const shift = resolveDoctorShift(targetDoctorId, templates, user.full_name, store);
      const fallbackStart = shift.sessions[0]?.start_time || '09:00';
      const fallbackEnd = shift.sessions[0]?.end_time || '17:00';
      const fallbackDur = shift.slot_duration_mins || 30;

      const docTemplateIds = new Set(
        templates.filter((t) => t.doctor_id === targetDoctorId).map((t) => t.template_id),
      );
      const docExistingSlots = existingSlots.filter((s) => docTemplateIds.has(s.template_id));

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

        let tmplId =
          reqSlot.template_id && docTemplateIds.has(reqSlot.template_id)
            ? reqSlot.template_id
            : undefined;
        if (!tmplId) {
          const weekday = getWeekdayName(reqSlot.slot_date);
          tmplId = await ensureDoctorWeekdayTemplate(
            targetDoctorId,
            weekday,
            fallbackStart,
            fallbackEnd,
            fallbackDur,
            templates,
          );
          docTemplateIds.add(tmplId);
        }

        const createdRes = await fetchOrdsJson<{ status?: string; message?: string }>('slots', {
          method: 'POST',
          body: JSON.stringify({
            template_id: tmplId,
            slot_date: reqSlot.slot_date,
            start_time: reqSlot.start_time,
            end_time: reqSlot.end_time,
            max_patients_per_slot: reqSlot.max_patients_per_slot || 1,
          }),
        });
        if (createdRes.status === 'error') {
          throw new Error(createdRes.message || 'Oracle rejected slot creation');
        }

        docExistingSlots.push({
          slot_id: -Date.now(),
          template_id: tmplId,
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
        fetchOrdsItems<SlotTemplate>('slot_templates'),
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

      const store = readShiftStore();
      const openedSet = new Set(store.opened_slot_keys);
      const shift = resolveDoctorShift(targetDoctorId, templates, user.full_name, store);
      const docTemplates = templates.filter((t) => t.doctor_id === targetDoctorId);
      const docTemplateIds = new Set(docTemplates.map((t) => t.template_id));
      const docExistingSlots = existingSlots.filter((s) => docTemplateIds.has(s.template_id));

      const allWindows = buildWorkingHourWindows(targetDate, docTemplates, {
        shiftConfig: shift,
        durationMins: Number(req.body?.duration_mins || shift.slot_duration_mins || 30),
      });
      const windows = allWindows.filter((w) => {
        const wDate = w.slot_date || targetDate;
        return (
          !isSlotStartExpired(wDate, w.start_time, now, HOSPITAL_TIMEZONE) &&
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

        let tmplId = w.template_id;
        if (!tmplId) {
          const weekday = getWeekdayName(wDate);
          tmplId = await ensureDoctorWeekdayTemplate(
            targetDoctorId,
            weekday,
            shift.sessions[0]?.start_time || '09:00',
            shift.sessions[0]?.end_time || '17:00',
            shift.slot_duration_mins || 30,
            docTemplates,
          );
          docTemplateIds.add(tmplId);
        }

        const createdRes = await fetchOrdsJson<{ status?: string; message?: string }>('slots', {
          method: 'POST',
          body: JSON.stringify({
            template_id: tmplId,
            slot_date: wDate,
            start_time: w.start_time,
            end_time: w.end_time,
            max_patients_per_slot: 1,
          }),
        });
        if (createdRes.status === 'error') {
          throw new Error(createdRes.message || 'Oracle rejected slot creation');
        }
        docExistingSlots.push({
          slot_id: -Date.now(),
          template_id: tmplId,
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
        fetchOrdsItems<SlotTemplate>('slot_templates').catch(() => [] as SlotTemplate[]),
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
    const logs = readRbacAuditLogs(500);
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
    const store = readClinicalStore();
    let records = store.medical_records;
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

    const store = readClinicalStore();
    const entry = {
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

  app.put('/api/clinical/records/:id', requireAuth, (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'MEDICAL_RECORDS:UPDATE', 'Update Medical Record')) return;
    const store = readClinicalStore();
    const idx = store.medical_records.findIndex((r) => r.record_id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ status: 'error', message: 'Medical record not found.' });
      return;
    }
    const current = store.medical_records[idx];
    if (user.role === 'DOCTOR' && user.doctor_id && current.doctor_id !== user.doctor_id) {
      res.status(403).json({
        status: 'error',
        message: 'Doctors can only modify their own clinical records.',
      });
      return;
    }
    store.medical_records[idx] = {
      ...current,
      chief_complaint: String(req.body?.chief_complaint ?? current.chief_complaint).trim(),
      diagnosis: String(req.body?.diagnosis ?? current.diagnosis).trim(),
      vitals_summary: req.body?.vitals_summary !== undefined ? String(req.body.vitals_summary).trim() || null : current.vitals_summary,
      clinical_notes: String(req.body?.clinical_notes ?? current.clinical_notes).trim(),
      updated_at: new Date().toISOString(),
    };
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

    res.json({ status: 'success', record: store.medical_records[idx] });
  });

  app.delete('/api/clinical/records/:id', requireAuth, (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'MEDICAL_RECORDS:DELETE', 'Delete Medical Record')) return;
    const store = readClinicalStore();
    const idx = store.medical_records.findIndex((r) => r.record_id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ status: 'error', message: 'Medical record not found.' });
      return;
    }
    const [removed] = store.medical_records.splice(idx, 1);
    writeClinicalStore(store);
    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_role: user.role,
      target_label: `${removed.patient_name} (${removed.record_id})`,
      action: 'MEDICAL_RECORD_DELETED',
      category: 'CLINICAL',
      details: `Deleted medical record ${removed.record_id}.`,
      severity: 'warning',
    });
    res.json({ status: 'success', message: 'Medical record deleted.' });
  });

  app.get('/api/clinical/prescriptions', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'PRESCRIPTIONS:VIEW', 'Prescriptions')) return;
    const store = readClinicalStore();
    let prescriptions = store.prescriptions;
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
      const existingRx = initialStore.prescriptions.find((p) => p.prescription_id === existingId);
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
      const [rawAppts, rawSlots, templates, doctors] = await Promise.all([
        fetchOrdsItems<Appointment>('appointments'),
        fetchOrdsItems<Slot>('slots'),
        fetchOrdsItems<SlotTemplate>('slot_templates'),
        fetchOrdsItems<Doctor>('doctors'),
      ]);
      const shiftStore = readShiftStore();
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
        const existingRx = store.prescriptions.find((p) => p.prescription_id === existingId);
        if (existingRx) {
          res.status(200).json({ status: 'success', prescription: existingRx, deduplicated: true });
          return;
        }
      }

      const entry = {
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

      store.prescriptions.unshift(entry);
      if (idempotencyKey) {
        store.prescription_idempotency[`POST:${idempotencyKey}`] = entry.prescription_id;
      }
      // Step 1: Persist prescription BEFORE emitting notification
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
          appointment_ref: entry.appointment_ref,
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
    if (idempotencyKey && store.prescription_idempotency[`PUT:${idempotencyKey}`]) {
      const existingRx = store.prescriptions.find((p) => p.prescription_id === req.params.id);
      if (existingRx) {
        res.json({ status: 'success', prescription: existingRx, deduplicated: true });
        return;
      }
    }

    const idx = store.prescriptions.findIndex((p) => p.prescription_id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ status: 'error', message: 'Prescription not found.' });
      return;
    }
    const current = store.prescriptions[idx];
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
        const [rawAppts, rawSlots, templates, doctors] = await Promise.all([
          fetchOrdsItems<Appointment>('appointments'),
          fetchOrdsItems<Slot>('slots'),
          fetchOrdsItems<SlotTemplate>('slot_templates'),
          fetchOrdsItems<Doctor>('doctors'),
        ]);
        const shiftStore = readShiftStore();
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
    const updatedRx = {
      ...current,
      diagnosis: String(req.body?.diagnosis ?? current.diagnosis).trim(),
      instructions: String(req.body?.instructions ?? current.instructions).trim(),
      status: req.body?.status === 'COMPLETED' ? ('COMPLETED' as const) : current.status,
      ...(Array.isArray(req.body?.medications) ? { medications: req.body.medications } : {}),
      updated_at: nowIso,
    };
    store.prescriptions[idx] = updatedRx;
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

  app.delete('/api/clinical/prescriptions/:id', requireAuth, (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!requirePermission(user, res, 'PRESCRIPTIONS:DELETE', 'Delete Prescription')) return;
    const store = readClinicalStore();
    const idx = store.prescriptions.findIndex((p) => p.prescription_id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ status: 'error', message: 'Prescription not found.' });
      return;
    }
    const [removed] = store.prescriptions.splice(idx, 1);
    writeClinicalStore(store);
    recordRbacAuditLog({
      actor_user_id: user.user_id,
      actor_name: user.full_name,
      actor_role: user.role,
      target_label: `${removed.patient_name} (${removed.prescription_id})`,
      action: 'PRESCRIPTION_DELETED',
      category: 'CLINICAL',
      details: `Deleted prescription ${removed.prescription_id}.`,
      severity: 'warning',
    });
    res.json({ status: 'success', message: 'Prescription deleted.' });
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
            const tid = Number(req.body?.template_id);
            const allTmpls = await fetchOrdsItems<SlotTemplate>('slot_templates');
            const target = allTmpls.find((t) => t.template_id === tid);
            if (!target || target.doctor_id !== user.doctor_id) {
              res.status(403).json({
                status: 'error',
                message: 'Doctors can only create slots under their own schedule',
              });
              return;
            }
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
          if (isSlotStartExpired(slotDate, startTime, new Date(), HOSPITAL_TIMEZONE)) {
            const nowParts = getHospitalNowParts(new Date(), HOSPITAL_TIMEZONE);
            res.status(400).json({
              status: 'error',
              message: `Cannot generate expired slot starting at ${startTime} on ${slotDate} (current time: ${nowParts.timeHHMM} ${HOSPITAL_TIMEZONE}).`,
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
        if (user.role === 'DOCTOR') {
          res.status(403).json({ status: 'error', message: 'Doctors cannot approve their own leave requests' });
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

      await ensureOverdueHoldsExpired();
      const [slotsList, templatesList, existingAppts] = await Promise.all([
        fetchOrdsItems<Slot>('slots'),
        fetchOrdsItems<SlotTemplate>('slot_templates'),
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

      if (isSlotStartExpired(targetSlot.slot_date, targetSlot.start_time, new Date(), HOSPITAL_TIMEZONE)) {
        res.status(400).json({
          status: 'error',
          code: 'SLOT_EXPIRED',
          message: 'Selected slot time has already passed. Available slots have been refreshed.',
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

      pendingBookingInfo = {
        patient_id: targetPatientId,
        slot_id: targetSlotId,
        consultation_mode: consultationMode,
        rescheduled_from_id: rescheduledFromId,
      };

      outgoingBody = {
        ...outgoingBody,
        patient_id: targetPatientId,
        slot_id: targetSlotId,
        booking_source: user.role === 'PATIENT' ? 'ONLINE' : outgoingBody.booking_source || 'WALK_IN',
        consultation_mode: consultationMode,
      };
    }

    if (/^appointments\/\d+\/(confirm|cancel)$/.test(subPath) && method === 'POST') {
      const isConfirmAction = subPath.endsWith('/confirm');
      const apptId = Number(subPath.split('/')[1]);
      if (user.role === 'PATIENT' || isConfirmAction) {
        const appts = await fetchOrdsItems<Appointment>('appointments');
        const target = appts.find((a) => a.appointment_id === apptId);
        if (user.role === 'PATIENT' && (!target || target.patient_id !== user.patient_id)) {
          res.status(403).json({ status: 'error', message: 'Patients can only manage their own appointments' });
          return;
        }
        if (isConfirmAction && target && isAppointmentHoldExpired(target)) {
          await ensureOverdueHoldsExpired({ force: true });
          res.status(409).json({
            status: 'error',
            code: 'HOLD_EXPIRED',
            message: 'This 10-minute booking hold has expired and the slot has been released. Please book a new slot.',
          });
          return;
        }
      }
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
        fetchOrdsItems<SlotTemplate>('slot_templates'),
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
      outgoingBody = {
        ...outgoingBody,
        ...(user.role === 'DOCTOR' && user.doctor_id ? { doctor_id: user.doctor_id } : {}),
        ...(user.auth_mode === 'ords' ? { requested_by: user.user_id } : {}),
      };
    }

    if (/^leaves\/\d+\/decide$/.test(subPath) && method === 'POST') {
      outgoingBody = {
        ...outgoingBody,
        admin_user_id: user.user_id || 1,
      };
    }

    try {
      const targetUrl = `${ORDS_BASE_URL}/${subPath}${queryString}`;
      const upstream = await fetch(targetUrl, {
        method,
        headers: {
          Accept: 'application/json',
          ...(method !== 'GET' && method !== 'HEAD' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(outgoingBody) : undefined,
      });
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

      if (upstream.ok && pendingBookingInfo) {
        try {
          const parsedBody = text ? (JSON.parse(text) as Record<string, unknown>) : {};
          if (parsedBody?.status !== 'error') {
            const latestAppts = await fetchOrdsItems<Appointment>('appointments').catch(
              () => [] as Appointment[],
            );
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

            res.status(upstream.status).json({
              ...parsedBody,
              consultation_mode: pendingBookingInfo.consultation_mode,
            });
            return;
          }
        } catch {
          // Fall through to raw ORDS response if parsing fails
        }
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

      // Enforce row-level privacy isolation on GET collections for PATIENT and DOCTOR
      if (upstream.ok && method === 'GET' && contentType.includes('json') && text) {
        try {
          const parsed = JSON.parse(text) as { items?: unknown[] };
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
              let appts = attachConsultationMode(rawAppts);
              if (user.role === 'PATIENT') {
                appts = appts.filter((a) => a.patient_id === user.patient_id);
              } else if (user.role === 'DOCTOR') {
                const [slots, templates] = await Promise.all([
                  fetchOrdsItems<Slot>('slots'),
                  fetchOrdsItems<SlotTemplate>('slot_templates'),
                ]);
                const tmplDoctorMap = buildTemplateDoctorMap(templates);
                const docSlotIds = new Set(
                  slots
                    .filter(
                      (s) => (s.doctor_id ?? tmplDoctorMap.get(s.template_id)) === user.doctor_id,
                    )
                    .map((s) => s.slot_id),
                );
                appts = appts.filter((a) => docSlotIds.has(a.slot_id));
              }
              parsed.items = appts;
            } else if (subPath === 'payments' && user.role === 'PATIENT') {
              const appts = await fetchOrdsItems<Appointment>('appointments');
              const myApptIds = new Set(
                appts.filter((a) => a.patient_id === user.patient_id).map((a) => a.appointment_id),
              );
              parsed.items = parsed.items.filter((p) => myApptIds.has((p as Payment).appointment_id));
            } else if (subPath === 'token_queue' && user.role === 'PATIENT') {
              const appts = await fetchOrdsItems<Appointment>('appointments');
              const myApptIds = new Set(
                appts.filter((a) => a.patient_id === user.patient_id).map((a) => a.appointment_id),
              );
              parsed.items = parsed.items.filter((t) =>
                myApptIds.has((t as TokenQueueItem).appointment_id),
              );
            } else if (subPath === 'slots') {
              const templates = await fetchOrdsItems<SlotTemplate>('slot_templates').catch(
                () => [] as SlotTemplate[],
              );
              parsed.items = filterConfirmedSlots(parsed.items as Slot[], templates);
            } else if (subPath === 'leaves' && user.role === 'DOCTOR') {
              parsed.items = parsed.items.filter(
                (l) => (l as { doctor_id?: number }).doctor_id === user.doctor_id,
              );
            }
            res.status(upstream.status).json(parsed);
            return;
          }
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
    if (knownNextHoldExpiryMs !== null && Date.now() < knownNextHoldExpiryMs) return;
    void ensureOverdueHoldsExpired().catch(() => {});
  }, 15_000).unref();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CarePulse OPD server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
