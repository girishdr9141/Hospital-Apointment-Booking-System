import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import type {
  Appointment,
  AuthUser,
  DashboardSummaryResponse,
  Department,
  Doctor,
  DoctorLeave,
  DoctorShiftConfig,
  Patient,
  Payment,
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
  isSingleAdminUser,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_LABELS,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_NAME,
} from './src/utils/permissions.ts';
import {
  doesLoginNameMatch,
  enrichAppointments,
  enrichSlots,
  formatDisplayDate,
  getIsoDatePart,
  normalizeOrdsError,
} from './src/utils/rules.ts';
import {
  buildWorkingHourWindows,
  DEFAULT_WORKING_DAYS,
  deriveShiftDefaultsFromTemplates,
  formatShiftSummary,
  getTodayIsoLocal,
  getWeekdayName,
  isDateCoveredByApprovedLeave,
} from './src/utils/calendar.ts';

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

function signSession(user: AuthUser): string {
  const payload: SessionPayload = {
    user,
    exp: Date.now() + 1000 * 60 * 60 * 12,
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
    if (parsed.user.role === 'ADMIN') {
      parsed.user = {
        ...parsed.user,
        permissions: ROLE_DEFAULT_PERMISSIONS.ADMIN,
      };
    }
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
    maxAge: 1000 * 60 * 60 * 12,
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

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = verifySession(getRequestToken(req));
  if (!user) {
    res.status(401).json({ status: 'error', message: 'Authentication required' });
    return;
  }
  (req as Request & { authUser?: AuthUser }).authUser = user;
  next();
}

const SHIFT_STORE_DIR = path.resolve(__dirname, 'data');
const SHIFT_STORE_PATH = path.join(SHIFT_STORE_DIR, 'doctor_shifts.json');
const NOTIF_ACK_PATH = path.join(SHIFT_STORE_DIR, 'notifications_ack.json');
const PATIENT_PW_PATH = path.join(SHIFT_STORE_DIR, 'patient_passwords.json');

function normalizePhoneDigits(phone?: string | null): string {
  const digits = String(phone || '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
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
  const valid: ShiftSession[] = [];
  for (const item of raw) {
    const start = String((item as ShiftSession)?.start_time || '').trim();
    const end = String((item as ShiftSession)?.end_time || '').trim();
    if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end) {
      valid.push({ start_time: start, end_time: end });
    }
  }
  valid.sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].start_time < valid[i - 1].end_time) {
      throw new Error('Shift sessions cannot overlap');
    }
  }
  return valid;
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

  // Public non-sensitive directory of registered portal accounts (no passwords/hashes)
  app.get('/api/auth/directory', async (_req, res) => {
    try {
      const [users, doctors, patients, departments] = await Promise.all([
        fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]),
        fetchOrdsItems<Doctor>('doctors').catch(() => [] as Doctor[]),
        fetchOrdsItems<Patient>('patients').catch(() => [] as Patient[]),
        fetchOrdsItems<Department>('departments/').catch(() => [] as Department[]),
      ]);
      const deptMap = new Map(departments.map((d) => [d.department_id, d.department_name]));

      const entries: Array<{
        role: RoleName;
        full_name: string;
        email: string;
        detail?: string;
      }> = [
        {
          role: 'ADMIN',
          full_name: SINGLE_ADMIN_NAME,
          email: SINGLE_ADMIN_EMAIL,
          detail: 'Sole System Administrator',
        },
      ];
      const seenEmails = new Set<string>([SINGLE_ADMIN_EMAIL.toLowerCase()]);

      // Receptionists from ORDS users (Meera Kulkarni / primary)
      for (const u of users) {
        if (u.is_active === 'Y' && u.role_name === 'RECEPTIONIST' && u.email) {
          const em = u.email.toLowerCase();
          if (em === 'reception@hospital.com') continue;
          if (!seenEmails.has(em)) {
            seenEmails.add(em);
            entries.push({
              role: 'RECEPTIONIST',
              full_name: u.full_name,
              email: em,
              detail: 'Front Desk',
            });
          }
        }
      }

      // Active Doctors (prefer GIRISH_USERS email, fallback to generated hospital slug)
      for (const d of doctors) {
        const linkedUser = users.find(
          (u) => u.is_active === 'Y' && u.role_name === 'DOCTOR' && u.doctor_id === d.doctor_id,
        );
        const slug = `${d.first_name}.${d.last_name}`.toLowerCase().replace(/[^a-z0-9]+/g, '.');
        const email = (
          linkedUser?.email ||
          (d.doctor_id === 2 ? 'priya@hospital.com' : `${slug}.${d.doctor_id}@hospital.com`)
        ).toLowerCase();
        if (!seenEmails.has(email)) {
          seenEmails.add(email);
          entries.push({
            role: 'DOCTOR',
            full_name: linkedUser?.full_name || `Dr. ${d.first_name} ${d.last_name}`,
            email,
            detail: `${deptMap.get(d.department_id) || 'OPD'}${d.specialization ? ` · ${d.specialization}` : ''}`,
          });
        }
      }

      // Patients (prefer GIRISH_USERS linked email, fallback to GIRISH_PATIENTS email)
      for (const p of patients) {
        const linkedUser = users.find(
          (u) => u.is_active === 'Y' && u.role_name === 'PATIENT' && u.patient_id === p.patient_id,
        );
        const email = (linkedUser?.email || p.email || '').trim().toLowerCase();
        if (email && !seenEmails.has(email)) {
          seenEmails.add(email);
          entries.push({
            role: 'PATIENT',
            full_name: linkedUser?.full_name || `${p.first_name} ${p.last_name}`,
            email,
            detail: `Patient #${p.patient_id}`,
          });
        }
      }

      const roleParam = String(_req.query?.role || '').trim().toUpperCase();
      const filteredEntries = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'].includes(roleParam)
        ? entries.filter((e) => e.role === roleParam)
        : entries;

      res.json({ status: 'success', accounts: filteredEntries });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to fetch directory',
      });
    }
  });

  app.post('/api/auth/patient/forgot-password', async (req, res) => {
    const emailInput = String(req.body?.email || '').trim().toLowerCase();
    const phoneInput = normalizePhoneDigits(req.body?.phone_number);
    const newPassword = String(req.body?.new_password || '');
    const confirmPassword = String(req.body?.confirm_password || '');

    if (!emailInput || !phoneInput || !newPassword || !confirmPassword) {
      res.status(400).json({
        status: 'error',
        message: 'Email ID, registered phone number, and new password are required.',
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        status: 'error',
        message: 'New password must be at least 6 characters.',
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

    if (emailInput === SINGLE_ADMIN_EMAIL.toLowerCase()) {
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
      if (nonPatientUser || BRIDGE_ACCOUNTS.some((b) => b.email.toLowerCase() === emailInput && b.role !== 'PATIENT')) {
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
    const expectedRole = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'].includes(expectedRoleRaw)
      ? (expectedRoleRaw as RoleName)
      : undefined;

    if (!emailInput || !fullNameInput || !password) {
      res.status(400).json({
        status: 'error',
        message: 'Full name, email ID, and password are required to sign in.',
      });
      return;
    }

    // Never permit legacy non-Girish admin emails
    if (
      ['admin', 'admin@hospital.com', 'admin@carepulse.local'].includes(emailInput) ||
      fullNameInput.toLowerCase().includes('kavita rao')
    ) {
      res.status(403).json({
        status: 'error',
        message: `Only the sole system administrator (${SINGLE_ADMIN_NAME} · ${SINGLE_ADMIN_EMAIL}) can sign in as Admin.`,
      });
      return;
    }

    // 0. Check if patient used Forgot Password override
    const pwOverrides = readPatientPasswordOverrides();
    if (pwOverrides[emailInput]) {
      if (expectedRole && expectedRole !== 'PATIENT') {
        res.status(403).json({
          status: 'error',
          message: `This account is registered as Patient. Please select the Patient Portal to sign in.`,
        });
        return;
      }
      if (!verifyPasswordScrypt(password, pwOverrides[emailInput])) {
        res.status(401).json({
          status: 'error',
          message: 'Invalid full name, email ID, or password.',
        });
        return;
      }
      try {
        const [patients, users] = await Promise.all([
          fetchOrdsItems<Patient>('patients').catch(() => [] as Patient[]),
          fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]),
        ]);
        const pat = patients.find((p) => (p.email || '').trim().toLowerCase() === emailInput);
        const linkedUser = users.find(
          (u) => (u.email || '').trim().toLowerCase() === emailInput && u.role_name === 'PATIENT',
        );
        const resolvedName = linkedUser?.full_name || (pat ? `${pat.first_name} ${pat.last_name}` : '');
        if (!resolvedName || !doesLoginNameMatch(fullNameInput, resolvedName, 'PATIENT')) {
          res.status(401).json({
            status: 'error',
            message: 'Entered name does not match the patient registered for this email ID.',
          });
          return;
        }
        const user: AuthUser = {
          user_id: linkedUser?.user_id ?? (pat ? 2000 + pat.patient_id : Date.now()),
          username: linkedUser?.username || emailInput,
          email: emailInput,
          full_name: resolvedName,
          role: 'PATIENT',
          roles: ['PATIENT'],
          permissions: ROLE_DEFAULT_PERMISSIONS.PATIENT,
          patient_id: pat?.patient_id ?? linkedUser?.patient_id ?? null,
          doctor_id: null,
          auth_mode: 'ords',
        };
        const token = signSession(user);
        setSessionCookie(req, res, token);
        res.json({ status: 'success', user, token });
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
          permissions:
            ordsAuth.user.role === 'ADMIN'
              ? ROLE_DEFAULT_PERMISSIONS.ADMIN
              : ordsAuth.user.permissions,
          auth_mode: 'ords',
        };

        if (candidate.role === 'ADMIN' && !isSingleAdminUser(candidate)) {
          res.status(403).json({
            status: 'error',
            message: `Only ${SINGLE_ADMIN_NAME} (${SINGLE_ADMIN_EMAIL}) is authorized as System Administrator.`,
          });
          return;
        }

        if (!doesLoginNameMatch(fullNameInput, candidate.full_name, candidate.role)) {
          res.status(401).json({
            status: 'error',
            message: 'Entered name does not match the account registered for this email ID.',
          });
          return;
        }

        // Enrich or resolve doctor_id / patient_id carefully without overwriting a valid linked ID
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

        if (expectedRole && candidate.role !== expectedRole) {
          res.status(403).json({
            status: 'error',
            message: `This account is registered as ${ROLE_LABELS[candidate.role]}. Please go back and select ${ROLE_LABELS[candidate.role]} to sign in.`,
          });
          return;
        }

        const token = signSession(candidate);
        setSessionCookie(req, res, token);
        res.json({ status: 'success', user: candidate, token });
        return;
      }
      if (ordsAuth.status === 'error') {
        const msg = (ordsAuth.message || '').toLowerCase();
        // Allow bridge check if ORDS does not yet have script 07 users (e.g. girishramachandra12dr@gmail.com)
        if (
          msg.includes('invalid email') ||
          msg.includes('no account found') ||
          msg.includes('not found')
        ) {
          ordsUnavailableOrNotFound = true;
        } else {
          res.status(401).json({
            status: 'error',
            message: ordsAuth.message || 'Invalid credentials',
          });
          return;
        }
      }
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      if (!statusCode || statusCode === 404 || statusCode === 405) {
        ordsUnavailableOrNotFound = true;
      } else {
        res.status(401).json({ status: 'error', message: (err as Error).message });
        return;
      }
    }

    // 2. Fallback / pre-Script-07 identity resolution tied to real Oracle records
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

        // Match real Oracle doctor by full name + <first>.<last>@hospital.com (or Doctor@123)
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

        // Match real Oracle patient by their registered email + full name
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
      res.status(401).json({
        status: 'error',
        message: 'Invalid full name, email ID, or password.',
      });
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
      permissions: ROLE_DEFAULT_PERMISSIONS[matched.role],
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
        message: `Only ${SINGLE_ADMIN_NAME} (${SINGLE_ADMIN_EMAIL}) is authorized as Admin.`,
      });
      return;
    }

    if (expectedRole && user.role !== expectedRole) {
      res.status(403).json({
        status: 'error',
        message: `This account is registered as ${ROLE_LABELS[user.role]}. Please go back and select ${ROLE_LABELS[user.role]} to sign in.`,
      });
      return;
    }

    const token = signSession(user);
    setSessionCookie(req, res, token);
    res.json({ status: 'success', user, token });
  });

  app.post('/api/auth/register', async (req, res) => {
    const first_name = String(req.body?.first_name || '').trim();
    const last_name = String(req.body?.last_name || '').trim();
    const phone_number = String(req.body?.phone_number || '').trim();
    const email = String(req.body?.email || '').trim();
    const date_of_birth = String(req.body?.date_of_birth || '').trim();
    const gender = String(req.body?.gender || '').trim().toUpperCase();
    const blood_group = String(req.body?.blood_group || '').trim();
    const password = String(req.body?.password || '');

    if (!first_name || !last_name || !phone_number || !email || !password) {
      res.status(400).json({
        status: 'error',
        message: 'First name, last name, phone number, email, and password are required',
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
      return;
    }

    if (gender && !['MALE', 'FEMALE', 'OTHER'].includes(gender)) {
      res.status(400).json({ status: 'error', message: 'Gender must be MALE, FEMALE, or OTHER' });
      return;
    }

    // 1. Prefer ORDS /auth/register once deployed in Phase 5
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
            date_of_birth: date_of_birth || null,
            gender: gender || null,
            blood_group: blood_group || null,
            password,
          }),
        },
      );
      if (ordsReg.status === 'success' && ordsReg.user) {
        const user: AuthUser = { ...ordsReg.user, auth_mode: 'ords' };
        const token = signSession(user);
        setSessionCookie(req, res, token);
        res.status(201).json({ status: 'success', user, token });
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

    // 2. Fallback: write directly to Oracle GIRISH_PATIENTS via existing live ORDS POST /patients
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

      const user: AuthUser = {
        user_id: created?.patient_id ? 2000 + created.patient_id : Date.now(),
        username: email.toLowerCase(),
        email: email.toLowerCase(),
        full_name: `${first_name} ${last_name}`,
        phone_number,
        role: 'PATIENT',
        roles: ['PATIENT'],
        permissions: ROLE_DEFAULT_PERMISSIONS.PATIENT,
        patient_id: created?.patient_id ?? null,
        doctor_id: null,
        auth_mode: 'bridge',
      };

      const token = signSession(user);
      setSessionCookie(req, res, token);
      res.status(201).json({
        status: 'success',
        message: 'Patient registered in Oracle database',
        user,
        token,
      });
    } catch (err) {
      res.status(502).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Patient registration failed',
      });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    const user = verifySession(getRequestToken(req));
    if (!user) {
      res.json({ status: 'unauthenticated', user: null });
      return;
    }
    res.json({ status: 'success', user });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ status: 'success', message: 'Signed out' });
  });

  app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;

    try {
      const [
        departments,
        doctors,
        patients,
        rawAppointments,
        rawSlots,
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
        rawAppointments,
        fullSlotsForApptJoin,
        doctors,
      );
      const todayIso = new Date().toISOString().slice(0, 10);

      let scopedAppointments = enrichedAppointments;
      let scopedSlots = enrichedSlots;
      let scopedPayments = payments;
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
        scopedPayments = payments.filter((p) => apptIds.has(p.appointment_id));
        scopedTokens = tokenQueue.filter((t) => apptIds.has(t.appointment_id));
        scopedSlots = enrichedSlots.filter((s) => s.status === 'AVAILABLE').slice(0, 12);

        if (user.patient_id) {
          const allPatients = await fetchOrdsItems<Patient>('patients');
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
        const localTodayIso = getTodayIsoLocal();
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
        // ADMIN & RECEPTIONIST
        allDoctorShifts = doctors.map((d) =>
          resolveDoctorShift(
            d.doctor_id,
            templates,
            `Dr. ${d.first_name} ${d.last_name}`,
            shiftStore,
          ),
        );
        const todaysOrUpcoming = enrichedSlots.filter(
          (s) => getIsoDatePart(s.slot_date) >= todayIso && s.status === 'AVAILABLE' && s.doctor_name,
        );
        const fallbackUpcoming = enrichedSlots.filter(
          (s) => getIsoDatePart(s.slot_date) >= todayIso,
        );
        scopedSlots = (
          todaysOrUpcoming.length > 0
            ? todaysOrUpcoming
            : fallbackUpcoming.length > 0
              ? fallbackUpcoming
              : enrichedSlots
        ).slice(0, 15);
      }

      const localTodayIso = getTodayIsoLocal();
      const todaysAppointments = scopedAppointments.filter(
        (a) => getIsoDatePart(a.slot_date || a.created_on) === localTodayIso,
      );
      const slotsToday = (user.role === 'DOCTOR' ? scopedSlots : enrichedSlots).filter(
        (s) => getIsoDatePart(s.slot_date) === localTodayIso,
      );
      const referenceSlots = slotsToday.length > 0 ? slotsToday : scopedSlots;

      let pendingApprovalsCount: number | null = null;
      if (isSingleAdminUser(user)) {
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
          available_slots_today: referenceSlots.filter((s) => s.status === 'AVAILABLE').length,
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

  async function buildNotificationsForUser(user: AuthUser): Promise<PortalNotification[]> {
    const shiftStore = readShiftStore();
    const ackKey = `${user.role}:${user.user_id}`;
    const dismissed = new Set(readNotificationAcks()[ackKey] || []);
    const list: PortalNotification[] = [];

    if (isSingleAdminUser(user)) {
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

  app.post('/api/notifications/dismiss', requireAuth, async (req, res) => {
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
  });

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
        change_requests: isSingleAdminUser(user) ? store.change_requests : [],
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
    if (!isSingleAdminUser(user)) {
      res.status(403).json({
        status: 'error',
        message: `Restricted to sole system administrator (${SINGLE_ADMIN_NAME})`,
      });
      return;
    }
    const store = readShiftStore();
    res.json({ status: 'success', requests: store.change_requests });
  });

  app.post('/api/admin/shift-change-requests/:id/decide', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    if (!isSingleAdminUser(user)) {
      res.status(403).json({
        status: 'error',
        message: `Restricted to sole system administrator (${SINGLE_ADMIN_NAME})`,
      });
      return;
    }

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
      target.decided_by = SINGLE_ADMIN_NAME;
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

    const todayIso = getTodayIsoLocal();
    for (const s of requestedSlots) {
      if (!s.slot_date || !s.start_time || !s.end_time) {
        res.status(400).json({ status: 'error', message: 'Each slot requires slot_date, start_time, and end_time' });
        return;
      }
      if (s.slot_date < todayIso) {
        res.status(400).json({ status: 'error', message: `Cannot generate slots for past date ${s.slot_date}` });
        return;
      }
      if (s.start_time >= s.end_time) {
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
    const todayIso = getTodayIsoLocal();
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

      const windows = buildWorkingHourWindows(targetDate, docTemplates, {
        shiftConfig: shift,
        durationMins: Number(req.body?.duration_mins || shift.slot_duration_mins || 30),
      });

      let createdCount = 0;
      for (const w of windows) {
        const slotKey = makeSlotKey(targetDoctorId, targetDate, w.start_time);
        const exists = docExistingSlots.some(
          (s) =>
            getIsoDatePart(s.slot_date) === targetDate &&
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
          const weekday = getWeekdayName(targetDate);
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
            slot_date: targetDate,
            start_time: w.start_time,
            end_time: w.end_time,
            max_patients_per_slot: 1,
          }),
        });
        if (createdRes.status === 'error') {
          throw new Error(createdRes.message || 'Oracle rejected slot creation');
        }
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

  // Generic authenticated ORDS BFF proxy with server-side RBAC & data isolation
  app.all('/api/ords/*', requireAuth, async (req, res) => {
    const user = (req as Request & { authUser: AuthUser }).authUser;
    const subPath = (req.params[0] || '').replace(/^\/+/, '');
    const queryIdx = req.originalUrl.indexOf('?');
    const queryString = queryIdx >= 0 ? req.originalUrl.slice(queryIdx) : '';
    const method = req.method.toUpperCase();

    const adminOnlyPrefixes = [
      'users',
      'roles',
      'permissions',
      'role-permissions',
      'audit-logs',
      'audit-config',
      'error-logs',
      'approvals',
    ];
    if (adminOnlyPrefixes.some((p) => subPath.startsWith(p)) && !isSingleAdminUser(user)) {
      res.status(403).json({
        status: 'error',
        message: `Restricted to sole system administrator (${SINGLE_ADMIN_NAME})`,
      });
      return;
    }

    // Enforce single-admin block & max 2 active receptionists
    if (subPath === 'users' && method === 'POST') {
      const requestedRole = String(req.body?.role_name || '').trim().toUpperCase();
      if (requestedRole === 'ADMIN') {
        res.status(403).json({
          status: 'error',
          message: `Only one system administrator (${SINGLE_ADMIN_NAME} · ${SINGLE_ADMIN_EMAIL}) is permitted.`,
        });
        return;
      }
      if (requestedRole === 'RECEPTIONIST') {
        const existingUsers = await fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]);
        const activeReceptionists = existingUsers.filter(
          (u) =>
            u.is_active === 'Y' &&
            u.role_name === 'RECEPTIONIST' &&
            (u.email || '').trim().toLowerCase() !== 'reception@hospital.com',
        );
        if (activeReceptionists.length >= 2) {
          res.status(400).json({
            status: 'error',
            message: 'Maximum of 2 active Receptionist accounts reached.',
          });
          return;
        }
      }
    }

    if (
      (subPath.startsWith('departments') ||
        subPath.startsWith('doctors') ||
        subPath.startsWith('consultation-types')) &&
      method !== 'GET' &&
      !isSingleAdminUser(user)
    ) {
      res.status(403).json({ status: 'error', message: 'Administrator role required to modify hospital master data' });
      return;
    }

    if (
      (subPath.startsWith('slot_templates') || subPath.startsWith('slots')) &&
      method !== 'GET'
    ) {
      if (user.role === 'ADMIN') {
        res.status(403).json({
          status: 'error',
          message: 'Administrators have read-only access to doctor schedules and slots.',
        });
        return;
      }
      const isDoctor = user.role === 'DOCTOR' && Boolean(user.doctor_id);
      if (!isDoctor) {
        res.status(403).json({ status: 'error', message: 'Only the doctor can modify their own daily slots' });
        return;
      }
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
      } else if (subPath.startsWith('slot_templates/') && method === 'DELETE') {
        res.status(403).json({
          status: 'error',
          message: 'Shift changes require administrator approval via Shift Change Request.',
        });
        return;
      } else if (subPath === 'slots' && method === 'POST') {
        const tid = Number(req.body?.template_id);
        const allTmpls = await fetchOrdsItems<SlotTemplate>('slot_templates');
        const target = allTmpls.find((t) => t.template_id === tid);
        if (!target || target.doctor_id !== user.doctor_id) {
          res.status(403).json({ status: 'error', message: 'Doctors can only create slots under their own schedule' });
          return;
        }
      }
    }

    if (subPath.startsWith('patients') && method !== 'GET' && !['RECEPTIONIST', 'PATIENT'].includes(user.role)) {
      res.status(403).json({ status: 'error', message: 'Only receptionists or patients themselves can register or edit patient records' });
      return;
    }

    if (subPath.startsWith('patients') && method !== 'GET' && user.role === 'PATIENT') {
      const targetId = Number(subPath.split('/')[1]);
      if (!targetId || targetId !== user.patient_id) {
        res.status(403).json({ status: 'error', message: 'Patients can only update their own profile' });
        return;
      }
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

    if (subPath.startsWith('payments') && method !== 'GET' && !['ADMIN', 'RECEPTIONIST'].includes(user.role)) {
      res.status(403).json({ status: 'error', message: 'Only receptionists or administrators can record payments' });
      return;
    }

    if (subPath.startsWith('token_queue') && method !== 'GET' && !['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(user.role)) {
      res.status(403).json({ status: 'error', message: 'Not authorized to manage token queue' });
      return;
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

    if (subPath === 'appointments/' && method === 'POST') {
      if (user.role === 'PATIENT') {
        outgoingBody = {
          ...outgoingBody,
          patient_id: user.patient_id,
          booking_source: 'ONLINE',
        };
      } else if (user.role !== 'RECEPTIONIST') {
        res.status(403).json({
          status: 'error',
          message: 'Only patients or front-desk receptionists can book appointments.',
        });
        return;
      }
    }

    if (/^appointments\/\d+\/(confirm|cancel)$/.test(subPath) && method === 'POST') {
      if (user.role === 'DOCTOR') {
        res.status(403).json({ status: 'error', message: 'Doctors cannot confirm or cancel patient bookings directly' });
        return;
      }
      if (user.role === 'PATIENT') {
        const apptId = Number(subPath.split('/')[1]);
        const appts = await fetchOrdsItems<Appointment>('appointments');
        const target = appts.find((a) => a.appointment_id === apptId);
        if (!target || target.patient_id !== user.patient_id) {
          res.status(403).json({ status: 'error', message: 'Patients can only manage their own appointments' });
          return;
        }
      }
    }

    if (/^appointments\/\d+\/outcome$/.test(subPath) && method === 'POST') {
      if (!['ADMIN', 'DOCTOR', 'RECEPTIONIST'].includes(user.role)) {
        res.status(403).json({ status: 'error', message: 'Not authorized to update consultation outcome' });
        return;
      }
    }

    if (subPath === 'leaves' && method === 'POST') {
      if (!['DOCTOR', 'ADMIN'].includes(user.role)) {
        res.status(403).json({ status: 'error', message: 'Only doctors or administrators can submit leave requests' });
        return;
      }
      outgoingBody = {
        ...outgoingBody,
        ...(user.role === 'DOCTOR' && user.doctor_id ? { doctor_id: user.doctor_id } : {}),
        ...(user.auth_mode === 'ords' ? { requested_by: user.user_id } : {}),
      };
    }

    if (/^leaves\/\d+\/decide$/.test(subPath) && method === 'POST') {
      if (!isSingleAdminUser(user)) {
        res.status(403).json({ status: 'error', message: 'Administrator role required to decide leave requests' });
        return;
      }
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

      // Auto-provision GIRISH_USERS portal login when Receptionist registers a new Patient with email
      if (upstream.ok && subPath === 'patients' && method === 'POST') {
        try {
          const parsedBody = text ? JSON.parse(text) : {};
          const patEmail = String(outgoingBody.email || '').trim().toLowerCase();
          const fn = String(outgoingBody.first_name || '').trim();
          const ln = String(outgoingBody.last_name || '').trim();
          if (parsedBody?.status !== 'error' && patEmail && fn && ln) {
            const [patientsList, existingUsers] = await Promise.all([
              fetchOrdsItems<Patient>('patients').catch(() => [] as Patient[]),
              fetchOrdsItems<UserAccount>('users').catch(() => [] as UserAccount[]),
            ]);
            const createdPat = patientsList
              .filter((p) => (p.email || '').trim().toLowerCase() === patEmail)
              .sort((a, b) => b.patient_id - a.patient_id)[0];
            if (createdPat && !existingUsers.some((u) => (u.email || '').toLowerCase() === patEmail)) {
              const slug = `${fn}.${ln}`.toLowerCase().replace(/[^a-z0-9]+/g, '.');
              await fetchOrdsJson('users', {
                method: 'POST',
                body: JSON.stringify({
                  username: `${slug}.${createdPat.patient_id}`,
                  email: patEmail,
                  full_name: `${fn} ${ln}`,
                  password: process.env.DEMO_PATIENT_PASSWORD || 'Patient@123',
                  role_name: 'PATIENT',
                  phone_number: String(outgoingBody.phone_number || '').trim() || undefined,
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
              parsed.items = parsed.items.filter(
                (p) => (p as Patient).patient_id === user.patient_id,
              );
            } else if (subPath === 'patients' && user.role === 'DOCTOR') {
              if (!user.doctor_id) {
                parsed.items = [];
              } else {
                const bookedIds = await getBookedPatientIdsForDoctor(user.doctor_id);
                parsed.items = parsed.items.filter((p) =>
                  bookedIds.has((p as Patient).patient_id),
                );
              }
            } else if (subPath === 'appointments' && user.role === 'PATIENT') {
              parsed.items = parsed.items.filter(
                (a) => (a as Appointment).patient_id === user.patient_id,
              );
            } else if (subPath === 'appointments' && user.role === 'DOCTOR') {
              const [slots, templates] = await Promise.all([
                fetchOrdsItems<Slot>('slots'),
                fetchOrdsItems<SlotTemplate>('slot_templates'),
              ]);
              const tmplDoctorMap = buildTemplateDoctorMap(templates);
              const docSlotIds = new Set(
                slots
                  .filter((s) => (s.doctor_id ?? tmplDoctorMap.get(s.template_id)) === user.doctor_id)
                  .map((s) => s.slot_id),
              );
              parsed.items = parsed.items.filter((a) => docSlotIds.has((a as Appointment).slot_id));
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CarePulse OPD server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
