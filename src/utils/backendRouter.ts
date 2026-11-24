export type BackendMode = 'ords' | 'oic';

export type OicPhaseId = 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'phase5';

export const ALL_OIC_PHASES: OicPhaseId[] = ['phase1', 'phase2', 'phase3', 'phase4', 'phase5'];

export interface OicEndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  oicPath: string;
  ordsTarget: string;
  summary: string;
  contractHint: string;
  probePath?: string;
}

export interface OicPhaseSpec {
  id: OicPhaseId;
  order: number;
  title: string;
  subtitle: string;
  effortHint: string;
  endpoints: OicEndpointSpec[];
}

export const OIC_PHASE_SPECS: OicPhaseSpec[] = [
  {
    id: 'phase1',
    order: 1,
    title: 'Phase 1 · Core Catalog & Rules',
    subtitle: 'Read-heavy master data with low risk — ideal first OIC REST integrations.',
    effortHint: 'Start here (3 read/write resources)',
    endpoints: [
      {
        id: 'p1-depts-list',
        method: 'GET',
        oicPath: '/departments',
        ordsTarget: 'GET /departments/?limit=500',
        summary: 'List active clinical departments',
        contractHint: 'Returns { items: Department[] } or Department[]',
        probePath: 'departments?limit=50',
      },
      {
        id: 'p1-dept-one',
        method: 'GET',
        oicPath: '/departments/{id}',
        ordsTarget: 'GET /departments/{id}',
        summary: 'Fetch single department details',
        contractHint: 'Returns { items: [Department] }',
      },
      {
        id: 'p1-dept-write',
        method: 'POST',
        oicPath: '/departments',
        ordsTarget: 'POST /departments/ · PUT/DELETE /departments/{id}',
        summary: 'Create, update, or deactivate a department',
        contractHint: 'Body: { department_name, description } -> { status: "success" }',
      },
      {
        id: 'p1-ctypes',
        method: 'GET',
        oicPath: '/consultation-types',
        ordsTarget: 'GET /consultation-types/?limit=500 (plus POST/PUT/DELETE)',
        summary: 'Consultation types & duration/fee catalog',
        contractHint: 'Returns { items: ConsultationType[] }',
        probePath: 'consultation-types?limit=50',
      },
      {
        id: 'p1-crules',
        method: 'GET',
        oicPath: '/cancellation-rules',
        ordsTarget: 'GET /cancellation-rules?limit=500',
        summary: 'Cancellation window & refund rules',
        contractHint: 'Returns { items: CancellationRule[] }',
        probePath: 'cancellation-rules?limit=50',
      },
    ],
  },
  {
    id: 'phase2',
    order: 2,
    title: 'Phase 2 · Auth, Doctors & Patients',
    subtitle: 'Portal login/registration and clinical directory records.',
    effortHint: 'Next after Phase 1 is verified',
    endpoints: [
      {
        id: 'p2-login',
        method: 'POST',
        oicPath: '/auth/login',
        ordsTarget: 'POST /auth/login',
        summary: 'Authenticate ORDS portal credentials',
        contractHint: 'Body: { email/identifier, password } -> { status, user }',
      },
      {
        id: 'p2-register',
        method: 'POST',
        oicPath: '/auth/register',
        ordsTarget: 'POST /auth/register',
        summary: 'Patient self-registration',
        contractHint: 'Body: patient fields + password -> { status, user }',
      },
      {
        id: 'p2-doctors',
        method: 'GET',
        oicPath: '/doctors',
        ordsTarget: 'GET/POST /doctors · PUT/DELETE /doctors/{id}',
        summary: 'Doctors directory and profile mutations',
        contractHint: 'Returns { items: Doctor[] }',
        probePath: 'doctors?limit=50',
      },
      {
        id: 'p2-patients',
        method: 'GET',
        oicPath: '/patients',
        ordsTarget: 'GET/POST /patients · PUT /patients/{id}',
        summary: 'Patient registry and lookup (?email=, ?phone=)',
        contractHint: 'Returns { items: Patient[] }',
        probePath: 'patients?limit=50',
      },
    ],
  },
  {
    id: 'phase3',
    order: 3,
    title: 'Phase 3 · Schedules & Slot Inventory',
    subtitle: 'Doctor shift windows, shift change approvals, and doctor-owned appointment slots.',
    effortHint: 'Required before appointment booking',
    endpoints: [
      {
        id: 'p3-templates',
        method: 'GET',
        oicPath: '/slot_templates',
        ordsTarget: 'GET/POST /slot_templates (optional legacy)',
        summary: 'Legacy slot templates (optional fallback; slots now link directly to doctor_id)',
        contractHint: 'Returns { items: SlotTemplate[] }',
        probePath: 'slot_templates?limit=50',
      },
      {
        id: 'p3-slots',
        method: 'GET',
        oicPath: '/slots',
        ordsTarget: 'GET/POST /slots · PUT/DELETE /slots/{id}',
        summary: 'Doctor-owned consultation slots (keyed by doctor_id FK) for patient booking',
        contractHint: 'Returns { items: Slot[] } with doctor_id',
        probePath: 'slots?limit=50',
      },
      {
        id: 'p3-doctor-shifts',
        method: 'GET',
        oicPath: '/doctor-shifts',
        ordsTarget: 'GET/POST /doctor-shifts (GIRISH_DOCTOR_SHIFT_WINDOWS)',
        summary: 'Doctor shift windows, durations, and working days',
        contractHint: 'Returns { items: DoctorShiftConfig[] }',
        probePath: 'doctor-shifts?limit=50',
      },
      {
        id: 'p3-shift-requests',
        method: 'GET',
        oicPath: '/shift-change-requests',
        ordsTarget: 'GET/POST /shift-change-requests · POST /shift-change-requests/{id}/decide',
        summary: 'Doctor shift change requests and admin approval decisions',
        contractHint: 'Returns { items: ShiftChangeRequest[] }',
        probePath: 'shift-change-requests?limit=50',
      },
    ],
  },
  {
    id: 'phase4',
    order: 4,
    title: 'Phase 4 · Appointments, Clinical, Leaves, Queue & Payments',
    subtitle: 'Core transactional PL/SQL workflows (holds, outcomes, clinical records, prescriptions, leaves, queue, billing).',
    effortHint: 'Highest business value — test each action carefully',
    endpoints: [
      {
        id: 'p4-appts-list',
        method: 'GET',
        oicPath: '/appointments',
        ordsTarget: 'GET /appointments?limit=500',
        summary: 'List all appointments across statuses',
        contractHint: 'Returns { items: Appointment[] }',
        probePath: 'appointments?limit=50',
      },
      {
        id: 'p4-appts-book',
        method: 'POST',
        oicPath: '/appointments',
        ordsTarget: 'POST /appointments (GIRISH_BOOK_APPOINTMENT)',
        summary: 'Book online (HELD) or walk-in (CONFIRMED) appointment',
        contractHint: 'Body: { patient_id, slot_id, booking_source } -> { status, appointment_ref }',
      },
      {
        id: 'p4-appts-confirm',
        method: 'POST',
        oicPath: '/appointments/{id}/confirm',
        ordsTarget: 'POST /appointments/{id}/confirm',
        summary: 'Confirm held appointment',
        contractHint: 'Returns { status: "success", message }',
      },
      {
        id: 'p4-appts-cancel',
        method: 'POST',
        oicPath: '/appointments/{id}/cancel',
        ordsTarget: 'POST /appointments/{id}/cancel',
        summary: 'Cancel appointment & free slot',
        contractHint: 'Returns { status: "success", message }',
      },
      {
        id: 'p4-appts-outcome',
        method: 'POST',
        oicPath: '/appointments/{id}/outcome',
        ordsTarget: 'POST /appointments/{id}/outcome',
        summary: 'Record COMPLETED or NO_SHOW after slot ends',
        contractHint: 'Body: { outcome: "COMPLETED" | "NO_SHOW" }',
      },
      {
        id: 'p4-appts-expire',
        method: 'POST',
        oicPath: '/appointments/expire-holds',
        ordsTarget: 'POST /appointments/expire-holds',
        summary: 'Release overdue 10-minute HELD appointments',
        contractHint: 'Returns { status: "success", expired_count }',
      },
      {
        id: 'p4-leaves',
        method: 'GET',
        oicPath: '/leaves',
        ordsTarget: 'GET/POST /leaves · POST /leaves/{id}/decide',
        summary: 'Doctor leave applications & admin approval',
        contractHint: 'Returns { items: DoctorLeave[] }',
        probePath: 'leaves?limit=50',
      },
      {
        id: 'p4-payments',
        method: 'GET',
        oicPath: '/payments',
        ordsTarget: 'GET/POST /payments',
        summary: 'Consultation payment records',
        contractHint: 'Returns { items: Payment[] }',
        probePath: 'payments?limit=50',
      },
      {
        id: 'p4-queue',
        method: 'GET',
        oicPath: '/token_queue',
        ordsTarget: 'GET/POST /token_queue · PUT /token_queue/{id}',
        summary: 'OPD check-in token queue & status progression',
        contractHint: 'Returns { items: TokenQueueItem[] }',
        probePath: 'token_queue?limit=50',
      },
      {
        id: 'p4-medical-records',
        method: 'GET',
        oicPath: '/medical-records',
        ordsTarget: 'GET/POST /medical-records · PUT/DELETE /medical-records/{id}',
        summary: 'Doctor-prescribed patient medical records (GIRISH_MEDICAL_RECORDS)',
        contractHint: 'Returns { items: MedicalRecordEntry[] }',
        probePath: 'medical-records?limit=50',
      },
      {
        id: 'p4-prescriptions',
        method: 'GET',
        oicPath: '/prescriptions',
        ordsTarget: 'GET/POST /prescriptions · PUT/DELETE /prescriptions/{id}',
        summary: 'Patient prescriptions & medication plans (GIRISH_PRESCRIPTIONS)',
        contractHint: 'Returns { items: PrescriptionEntry[] }',
        probePath: 'prescriptions?limit=50',
      },
    ],
  },
  {
    id: 'phase5',
    order: 5,
    title: 'Phase 5 · Governance, Reports & Logs',
    subtitle: 'Users/roles directory, utilisation reports, and Oracle audit/error logs.',
    effortHint: 'Final phase to achieve 100% OIC coverage',
    endpoints: [
      {
        id: 'p5-users',
        method: 'GET',
        oicPath: '/users',
        ordsTarget: 'GET/POST /users',
        summary: 'Oracle user accounts directory',
        contractHint: 'Returns { items: UserAccount[] }',
        probePath: 'users?limit=50',
      },
      {
        id: 'p5-roles-perms',
        method: 'GET',
        oicPath: '/roles',
        ordsTarget: 'GET /roles · GET /permissions · GET /role-permissions',
        summary: 'Oracle RBAC definitions',
        contractHint: 'Returns { items: RoleRecord[] }',
        probePath: 'roles?limit=50',
      },
      {
        id: 'p5-reports',
        method: 'GET',
        oicPath: '/reports/utilisation',
        ordsTarget: 'GET /reports/utilisation',
        summary: 'Doctor slot utilisation metrics',
        contractHint: 'Returns { items: UtilisationReportRow[] }',
        probePath: 'reports/utilisation?limit=50',
      },
      {
        id: 'p5-logs',
        method: 'GET',
        oicPath: '/audit-logs',
        ordsTarget: 'GET /audit-logs · GET /error-logs',
        summary: 'Oracle database audit and error logs',
        contractHint: 'Returns { items: AuditLogRecord[] }',
        probePath: 'audit-logs?limit=50',
      },
    ],
  },
];

function stripQueryAndLeadingSlash(endpoint: string): string {
  const noLead = String(endpoint || '').trim().replace(/^\/+/, '');
  const qIdx = noLead.indexOf('?');
  return (qIdx >= 0 ? noLead.slice(0, qIdx) : noLead).replace(/\/+$/, '').toLowerCase();
}

export function classifyEndpointPhase(endpoint: string): OicPhaseId {
  const path = stripQueryAndLeadingSlash(endpoint);
  if (
    path.startsWith('departments') ||
    path.startsWith('consultation-types') ||
    path.startsWith('cancellation-rules')
  ) {
    return 'phase1';
  }
  if (
    path.startsWith('auth/') ||
    path === 'auth' ||
    path.startsWith('doctors') ||
    path.startsWith('patients')
  ) {
    return 'phase2';
  }
  if (
    path.startsWith('slot_templates') ||
    path.startsWith('slots') ||
    path.startsWith('doctor-shifts') ||
    path.startsWith('shift-change-requests')
  ) {
    return 'phase3';
  }
  if (
    path.startsWith('appointments') ||
    path.startsWith('leaves') ||
    path.startsWith('payments') ||
    path.startsWith('token_queue') ||
    path.startsWith('medical-records') ||
    path.startsWith('prescriptions')
  ) {
    return 'phase4';
  }
  return 'phase5';
}

export function normalizeEnabledPhases(phases?: unknown): OicPhaseId[] {
  if (!Array.isArray(phases)) return [...ALL_OIC_PHASES];
  const valid = phases.filter((p): p is OicPhaseId =>
    ALL_OIC_PHASES.includes(p as OicPhaseId),
  );
  return Array.from(new Set(valid));
}

export function shouldUseOicForEndpoint(
  mode: BackendMode,
  enabledPhases: OicPhaseId[],
  endpoint: string,
  oicConfigured: boolean,
): boolean {
  if (!oicConfigured || mode !== 'oic') return false;
  const phase = classifyEndpointPhase(endpoint);
  return enabledPhases.includes(phase);
}

export function buildUpstreamUrl(
  ordsBaseUrl: string,
  oicBaseUrl: string,
  endpoint: string,
  targetBackend: BackendMode,
): string {
  const cleanOrds = ordsBaseUrl.replace(/\/+$/, '');
  const cleanOic = oicBaseUrl.replace(/\/+$/, '');
  const raw = String(endpoint || '').replace(/^\/+/, '');
  if (targetBackend === 'ords') {
    return `${cleanOrds}/${raw}`;
  }
  const qIdx = raw.indexOf('?');
  const pathPart = (qIdx >= 0 ? raw.slice(0, qIdx) : raw).replace(/\/+$/, '');
  const queryPart = qIdx >= 0 ? raw.slice(qIdx) : '';
  return pathPart ? `${cleanOic}/${pathPart}${queryPart}` : `${cleanOic}${queryPart}`;
}

const KNOWN_COLLECTION_KEYS = [
  'items',
  'departments',
  'consultation_types',
  'cancellation_rules',
  'doctors',
  'patients',
  'slot_templates',
  'slots',
  'doctor_shifts',
  'shift_change_requests',
  'requests',
  'appointments',
  'leaves',
  'payments',
  'token_queue',
  'medical_records',
  'prescriptions',
  'users',
  'roles',
  'permissions',
  'audit_logs',
  'error_logs',
  'records',
  'results',
  'data',
];

export function normalizeBackendPayload(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    return { items: parsed };
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if ('items' in obj || 'status' in obj) {
      return parsed;
    }
    for (const key of KNOWN_COLLECTION_KEYS) {
      if (Array.isArray(obj[key])) {
        return { ...obj, items: obj[key] };
      }
    }
  }
  return parsed;
}
