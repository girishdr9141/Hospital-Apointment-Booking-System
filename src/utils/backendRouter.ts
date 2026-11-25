export type BackendMode = 'HYBRID' | 'OIC' | 'ORDS';
export type ServedBy = 'OIC' | 'ORDS';

export type OicPhaseId = 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'phase5';

export const ALL_OIC_PHASES: OicPhaseId[] = ['phase1', 'phase2', 'phase3', 'phase4', 'phase5'];

export interface OicIntegrationRoute {
  integrationName: string;
  version: string;
  resourcePath: string;
}

export interface RoutingDecision {
  servedBy: ServedBy;
  mode: BackendMode;
  phase: OicPhaseId;
  integrationName: string | null;
  url: string;
}

export interface OicIntegrationDescriptor {
  integrationName: string;
  version: string;
  swaggerPath: string;
  phase: OicPhaseId;
  summary: string;
  operations: string[];
}

export const OIC_INTEGRATIONS_CATALOG: OicIntegrationDescriptor[] = [
  {
    integrationName: 'CAREPULS_BOOK_APPOINTM_MAIN',
    version: '1.0',
    swaggerPath: '/CAREPULS_BOOK_APPOINTM_MAIN/1.0/metadata/swagger',
    phase: 'phase4',
    summary: 'Primary Booking Orchestrator (10-min Slot Hold + Pay & Confirm)',
    operations: ['POST /appointments', 'POST /appointments/{id}/pay-and-confirm'],
  },
  {
    integrationName: 'HOSPITAL_APPOINTMEN_API',
    version: '1.0',
    swaggerPath: '/HOSPITAL_APPOINTMEN_API/1.0/metadata/swagger',
    phase: 'phase4',
    summary: 'Appointment Cancellation, Outcomes & Token Queue Issuance',
    operations: [
      'POST /appointments/{id}/cancel',
      'POST /appointments/{id}/outcome',
      'POST /token_queue',
    ],
  },
  {
    integrationName: 'HOSPITAL_SCHEDULE_API',
    version: '1.0',
    swaggerPath: '/HOSPITAL_SCHEDULE_API/1.0/metadata/swagger',
    phase: 'phase3',
    summary: 'Doctor Slots, Shifts, Shift Change Approvals & Leaves',
    operations: [
      'POST /slots',
      'POST /doctor-shifts',
      'POST /shift-change-requests',
      'POST /shift-change-requests/{id}/decide',
      'POST /leaves',
      'POST /leaves/{id}/decide',
    ],
  },
  {
    integrationName: 'HOSPITAL_CLINICAL_API',
    version: '1.0',
    swaggerPath: '/HOSPITAL_CLINICAL_API/1.0/metadata/swagger',
    phase: 'phase4',
    summary: 'Clinical Medical Records & Prescriptions Creation',
    operations: ['POST /medical-records', 'POST /prescriptions'],
  },
  {
    integrationName: 'HOSPITAL_MODIFY_API',
    version: '1.0',
    swaggerPath: '/HOSPITAL_MODIFY_API/1.0/metadata/swagger',
    phase: 'phase4',
    summary: 'Clinical Record, Prescription & Queue Modifications',
    operations: [
      'PUT /medical-records/{id}',
      'DELETE /medical-records/{id}',
      'PUT /prescriptions/{id}',
      'DELETE /prescriptions/{id}',
      'PUT /token_queue/{id}',
    ],
  },
  {
    integrationName: 'HOSPITAL_PATIENT_AUTH_API',
    version: '1.0',
    swaggerPath: '/HOSPITAL_PATIENT_AUTH_API/1.0/metadata/swagger',
    phase: 'phase2',
    summary: 'Authentication, Registration, Patients & Staff Users',
    operations: [
      'POST /auth/login',
      'POST /auth/register',
      'POST /patients',
      'PUT /patients/{id}',
      'POST /users',
    ],
  },
  {
    integrationName: 'HOSPITAL_MASTER_DATA_API',
    version: '1.0',
    swaggerPath: '/HOSPITAL_MASTER_DATA_API/1.0/metadata/swagger',
    phase: 'phase1',
    summary: 'Departments, Consultation Types & Doctor Master Data',
    operations: [
      'POST/PUT/DELETE /departments',
      'POST/PUT/DELETE /consultation-types',
      'POST/PUT/DELETE /doctors',
    ],
  },
];

export interface OicEndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  oicPath: string;
  integrationName?: string;
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
    subtitle: 'GET reads route directly to ORDS; catalog writes route via HOSPITAL_MASTER_DATA_API in HYBRID/OIC mode.',
    effortHint: 'Master Data',
    endpoints: [
      {
        id: 'p1-depts-list',
        method: 'GET',
        oicPath: '/departments',
        ordsTarget: 'GET /departments/?limit=500 (Fast ORDS read)',
        summary: 'List active clinical departments',
        contractHint: 'Returns { items: Department[] }',
        probePath: 'departments?limit=50',
      },
      {
        id: 'p1-dept-write',
        method: 'POST',
        oicPath: '/departments',
        integrationName: 'HOSPITAL_MASTER_DATA_API',
        ordsTarget: 'POST /departments/ · PUT/DELETE /departments/{id}',
        summary: 'Create, update, or deactivate a department',
        contractHint: 'OIC: HOSPITAL_MASTER_DATA_API/1.0/departments',
      },
      {
        id: 'p1-ctypes',
        method: 'POST',
        oicPath: '/consultation-types',
        integrationName: 'HOSPITAL_MASTER_DATA_API',
        ordsTarget: 'POST /consultation-types/ · PUT/DELETE /consultation-types/{id}',
        summary: 'Create, update, or deactivate consultation types',
        contractHint: 'OIC: HOSPITAL_MASTER_DATA_API/1.0/consultation-types',
      },
      {
        id: 'p1-crules',
        method: 'GET',
        oicPath: '/cancellation-rules',
        ordsTarget: 'GET /cancellation-rules?limit=500 (Fast ORDS read)',
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
    subtitle: 'Portal auth/registration & patient writes via HOSPITAL_PATIENT_AUTH_API; doctor writes via HOSPITAL_MASTER_DATA_API.',
    effortHint: 'Identity & Directory',
    endpoints: [
      {
        id: 'p2-login',
        method: 'POST',
        oicPath: '/auth/login',
        integrationName: 'HOSPITAL_PATIENT_AUTH_API',
        ordsTarget: 'POST /auth/login',
        summary: 'Authenticate portal credentials',
        contractHint: 'OIC: HOSPITAL_PATIENT_AUTH_API/1.0/auth/login',
      },
      {
        id: 'p2-register',
        method: 'POST',
        oicPath: '/auth/register',
        integrationName: 'HOSPITAL_PATIENT_AUTH_API',
        ordsTarget: 'POST /auth/register',
        summary: 'Patient self-registration',
        contractHint: 'OIC: HOSPITAL_PATIENT_AUTH_API/1.0/auth/register',
      },
      {
        id: 'p2-doctors',
        method: 'POST',
        oicPath: '/doctors',
        integrationName: 'HOSPITAL_MASTER_DATA_API',
        ordsTarget: 'POST /doctors · PUT/DELETE /doctors/{id}',
        summary: 'Doctor directory mutations',
        contractHint: 'OIC: HOSPITAL_MASTER_DATA_API/1.0/doctors',
      },
      {
        id: 'p2-patients',
        method: 'POST',
        oicPath: '/patients',
        integrationName: 'HOSPITAL_PATIENT_AUTH_API',
        ordsTarget: 'POST /patients · PUT /patients/{id}',
        summary: 'Patient registry create & update',
        contractHint: 'OIC: HOSPITAL_PATIENT_AUTH_API/1.0/patients',
      },
    ],
  },
  {
    id: 'phase3',
    order: 3,
    title: 'Phase 3 · Schedules & Slot Inventory',
    subtitle: 'Doctor shifts, shift change approvals, and slot generation routed via HOSPITAL_SCHEDULE_API.',
    effortHint: 'Scheduling',
    endpoints: [
      {
        id: 'p3-slots',
        method: 'POST',
        oicPath: '/slots',
        integrationName: 'HOSPITAL_SCHEDULE_API',
        ordsTarget: 'POST /slots',
        summary: 'Create doctor consultation slots',
        contractHint: 'OIC: HOSPITAL_SCHEDULE_API/1.0/slots',
      },
      {
        id: 'p3-doctor-shifts',
        method: 'POST',
        oicPath: '/doctor-shifts',
        integrationName: 'HOSPITAL_SCHEDULE_API',
        ordsTarget: 'POST /doctor-shifts',
        summary: 'Register or update doctor shift windows',
        contractHint: 'OIC: HOSPITAL_SCHEDULE_API/1.0/doctor-shifts',
      },
      {
        id: 'p3-shift-requests',
        method: 'POST',
        oicPath: '/shift-change-requests',
        integrationName: 'HOSPITAL_SCHEDULE_API',
        ordsTarget: 'POST /shift-change-requests · POST .../decide',
        summary: 'Submit & decide doctor shift change requests',
        contractHint: 'OIC: HOSPITAL_SCHEDULE_API/1.0/shift-change-requests',
      },
    ],
  },
  {
    id: 'phase4',
    order: 4,
    title: 'Phase 4 · Booking, Clinical, Leaves & Queue',
    subtitle: 'Orchestrated booking/payment (CAREPULS_BOOK_APPOINTM_MAIN), clinical writes, leaves & queue updates.',
    effortHint: 'Core Transactions',
    endpoints: [
      {
        id: 'p4-appts-book',
        method: 'POST',
        oicPath: '/appointments',
        integrationName: 'CAREPULS_BOOK_APPOINTM_MAIN',
        ordsTarget: 'POST /appointments (10-min HELD or WALK_IN)',
        summary: 'Book online or walk-in appointment',
        contractHint: 'OIC: CAREPULS_BOOK_APPOINTM_MAIN/1.0/appointments',
      },
      {
        id: 'p4-appts-pay-confirm',
        method: 'POST',
        oicPath: '/appointments/{id}/pay-and-confirm',
        integrationName: 'CAREPULS_BOOK_APPOINTM_MAIN',
        ordsTarget: 'POST /payments + POST /appointments/{id}/confirm',
        summary: 'Pay consultation fee & confirm held appointment',
        contractHint: 'OIC: CAREPULS_BOOK_APPOINTM_MAIN/1.0/appointments/{id}/pay-and-confirm',
      },
      {
        id: 'p4-appts-cancel',
        method: 'POST',
        oicPath: '/appointments/{id}/cancel',
        integrationName: 'HOSPITAL_APPOINTMEN_API',
        ordsTarget: 'POST /appointments/{id}/cancel',
        summary: 'Cancel appointment & free slot',
        contractHint: 'OIC: HOSPITAL_APPOINTMEN_API/1.0/appointments/{id}/cancel',
      },
      {
        id: 'p4-appts-outcome',
        method: 'POST',
        oicPath: '/appointments/{id}/outcome',
        integrationName: 'HOSPITAL_APPOINTMEN_API',
        ordsTarget: 'POST /appointments/{id}/outcome',
        summary: 'Record COMPLETED or NO_SHOW after slot ends',
        contractHint: 'OIC: HOSPITAL_APPOINTMEN_API/1.0/appointments/{id}/outcome',
      },
      {
        id: 'p4-leaves',
        method: 'POST',
        oicPath: '/leaves',
        integrationName: 'HOSPITAL_SCHEDULE_API',
        ordsTarget: 'POST /leaves · POST /leaves/{id}/decide',
        summary: 'Submit & decide doctor leaves',
        contractHint: 'OIC: HOSPITAL_SCHEDULE_API/1.0/leaves',
      },
      {
        id: 'p4-queue',
        method: 'POST',
        oicPath: '/token_queue',
        integrationName: 'HOSPITAL_APPOINTMEN_API',
        ordsTarget: 'POST /token_queue (issue) · PUT /token_queue/{id} (HOSPITAL_MODIFY_API)',
        summary: 'OPD check-in token issuance & status progression',
        contractHint: 'OIC: HOSPITAL_APPOINTMEN_API + HOSPITAL_MODIFY_API',
      },
      {
        id: 'p4-medical-records',
        method: 'POST',
        oicPath: '/medical-records',
        integrationName: 'HOSPITAL_CLINICAL_API',
        ordsTarget: 'POST /medical-records · PUT/DELETE (HOSPITAL_MODIFY_API)',
        summary: 'Create, update, or delete medical records',
        contractHint: 'OIC: HOSPITAL_CLINICAL_API + HOSPITAL_MODIFY_API',
      },
      {
        id: 'p4-prescriptions',
        method: 'POST',
        oicPath: '/prescriptions',
        integrationName: 'HOSPITAL_CLINICAL_API',
        ordsTarget: 'POST /prescriptions · PUT/DELETE (HOSPITAL_MODIFY_API)',
        summary: 'Create, update, or delete prescriptions',
        contractHint: 'OIC: HOSPITAL_CLINICAL_API + HOSPITAL_MODIFY_API',
      },
    ],
  },
  {
    id: 'phase5',
    order: 5,
    title: 'Phase 5 · Users, Governance & Fast ORDS Reads',
    subtitle: 'Staff user creation via HOSPITAL_PATIENT_AUTH_API; all analytics, audit & GET directories stay on fast ORDS read path.',
    effortHint: 'Governance & Reads',
    endpoints: [
      {
        id: 'p5-users',
        method: 'POST',
        oicPath: '/users',
        integrationName: 'HOSPITAL_PATIENT_AUTH_API',
        ordsTarget: 'POST /users',
        summary: 'Provision Oracle portal user accounts',
        contractHint: 'OIC: HOSPITAL_PATIENT_AUTH_API/1.0/users',
      },
      {
        id: 'p5-reads',
        method: 'GET',
        oicPath: 'All GET endpoints',
        ordsTarget: 'Direct ORDS_BASE_URL read path',
        summary: 'Fast read path across HYBRID, OIC, and ORDS modes',
        contractHint: 'Always X-Served-By: ORDS',
      },
    ],
  },
];

export function parseBackendMode(raw: unknown): BackendMode | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'HYBRID' || upper === 'OIC' || upper === 'ORDS') {
    return upper;
  }
  return null;
}

export function normalizeBackendMode(
  raw: unknown,
  oicConfigured: boolean,
  fallback?: BackendMode,
): BackendMode {
  const defaultMode: BackendMode = fallback ?? (oicConfigured ? 'HYBRID' : 'ORDS');
  const parsed = parseBackendMode(raw);
  if (!parsed) {
    return oicConfigured ? defaultMode : 'ORDS';
  }
  if (!oicConfigured && (parsed === 'HYBRID' || parsed === 'OIC')) {
    return 'ORDS';
  }
  return parsed;
}

export function sanitizeEnvValue(raw: string | undefined | null): string {
  const trimmed = String(raw || '').trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeOicBaseUrl(raw: string | undefined | null): string {
  const cleaned = sanitizeEnvValue(raw).replace(/\/+$/, '');
  if (!cleaned) return '';
  // If someone pasted a full OIC Swagger or endpoint URL, normalize back to .../project/<PROJECT_CODE>
  const projectMatch = cleaned.match(/^(https?:\/\/[^?#]+\/flows\/rest\/project\/[^/]+)/i);
  if (projectMatch) {
    return projectMatch[1].replace(/\/+$/, '');
  }
  return cleaned;
}

function splitEndpoint(endpoint: string): { cleanPath: string; queryPart: string } {
  const trimmed = String(endpoint || '').trim().replace(/^\/+/, '');
  const qIdx = trimmed.indexOf('?');
  const rawPath = (qIdx >= 0 ? trimmed.slice(0, qIdx) : trimmed).replace(/\/+$/, '');
  const queryPart = qIdx >= 0 ? trimmed.slice(qIdx) : '';
  return { cleanPath: rawPath, queryPart };
}

export function classifyEndpointPhase(endpoint: string): OicPhaseId {
  const path = splitEndpoint(endpoint).cleanPath.toLowerCase();
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

export function resolveOicIntegrationRoute(
  method: string,
  endpoint: string,
): OicIntegrationRoute | null {
  const upperMethod = String(method || 'GET').trim().toUpperCase();
  if (upperMethod === 'GET' || upperMethod === 'HEAD' || upperMethod === 'OPTIONS') {
    return null;
  }

  const { cleanPath } = splitEndpoint(endpoint);
  const lower = cleanPath.toLowerCase();

  // 1. CAREPULS_BOOK_APPOINTM_MAIN (Booking orchestrator)
  if (upperMethod === 'POST' && lower === 'appointments') {
    return {
      integrationName: 'CAREPULS_BOOK_APPOINTM_MAIN',
      version: '1.0',
      resourcePath: 'appointments',
    };
  }
  if (upperMethod === 'POST' && /^appointments\/[^/]+\/pay-and-confirm$/.test(lower)) {
    return {
      integrationName: 'CAREPULS_BOOK_APPOINTM_MAIN',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }

  // 2. HOSPITAL_APPOINTMEN_API (Cancel, Outcome, Token Queue Issue)
  if (upperMethod === 'POST' && /^appointments\/[^/]+\/cancel$/.test(lower)) {
    return {
      integrationName: 'HOSPITAL_APPOINTMEN_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (upperMethod === 'POST' && /^appointments\/[^/]+\/outcome$/.test(lower)) {
    return {
      integrationName: 'HOSPITAL_APPOINTMEN_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (upperMethod === 'POST' && lower === 'token_queue') {
    return {
      integrationName: 'HOSPITAL_APPOINTMEN_API',
      version: '1.0',
      resourcePath: 'token_queue',
    };
  }

  // 3. HOSPITAL_SCHEDULE_API (Slots, Shifts, Shift Change Requests, Leaves)
  if (upperMethod === 'POST' && lower === 'slots') {
    return {
      integrationName: 'HOSPITAL_SCHEDULE_API',
      version: '1.0',
      resourcePath: 'slots',
    };
  }
  if (upperMethod === 'POST' && lower === 'doctor-shifts') {
    return {
      integrationName: 'HOSPITAL_SCHEDULE_API',
      version: '1.0',
      resourcePath: 'doctor-shifts',
    };
  }
  if (upperMethod === 'POST' && lower === 'shift-change-requests') {
    return {
      integrationName: 'HOSPITAL_SCHEDULE_API',
      version: '1.0',
      resourcePath: 'shift-change-requests',
    };
  }
  if (upperMethod === 'POST' && /^shift-change-requests\/[^/]+\/decide$/.test(lower)) {
    return {
      integrationName: 'HOSPITAL_SCHEDULE_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (upperMethod === 'POST' && lower === 'leaves') {
    return {
      integrationName: 'HOSPITAL_SCHEDULE_API',
      version: '1.0',
      resourcePath: 'leaves',
    };
  }
  if (upperMethod === 'POST' && /^leaves\/[^/]+\/decide$/.test(lower)) {
    return {
      integrationName: 'HOSPITAL_SCHEDULE_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }

  // 4. HOSPITAL_CLINICAL_API (Create Medical Records & Prescriptions)
  if (upperMethod === 'POST' && lower === 'medical-records') {
    return {
      integrationName: 'HOSPITAL_CLINICAL_API',
      version: '1.0',
      resourcePath: 'medical-records',
    };
  }
  if (upperMethod === 'POST' && lower === 'prescriptions') {
    return {
      integrationName: 'HOSPITAL_CLINICAL_API',
      version: '1.0',
      resourcePath: 'prescriptions',
    };
  }

  // 5. HOSPITAL_MODIFY_API (PUT/DELETE Medical Records, Prescriptions & PUT Token Queue)
  if (
    (upperMethod === 'PUT' || upperMethod === 'DELETE') &&
    /^medical-records\/[^/]+$/.test(lower)
  ) {
    return {
      integrationName: 'HOSPITAL_MODIFY_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (
    (upperMethod === 'PUT' || upperMethod === 'DELETE') &&
    /^prescriptions\/[^/]+$/.test(lower)
  ) {
    return {
      integrationName: 'HOSPITAL_MODIFY_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (upperMethod === 'PUT' && /^token_queue\/[^/]+$/.test(lower)) {
    return {
      integrationName: 'HOSPITAL_MODIFY_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }

  // 6. HOSPITAL_PATIENT_AUTH_API (Login, Register, Patients, Users)
  if (upperMethod === 'POST' && (lower === 'auth/login' || lower === 'auth/register')) {
    return {
      integrationName: 'HOSPITAL_PATIENT_AUTH_API',
      version: '1.0',
      resourcePath: lower,
    };
  }
  if (upperMethod === 'POST' && lower === 'patients') {
    return {
      integrationName: 'HOSPITAL_PATIENT_AUTH_API',
      version: '1.0',
      resourcePath: 'patients',
    };
  }
  if (upperMethod === 'PUT' && /^patients\/[^/]+$/.test(lower)) {
    return {
      integrationName: 'HOSPITAL_PATIENT_AUTH_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (upperMethod === 'POST' && lower === 'users') {
    return {
      integrationName: 'HOSPITAL_PATIENT_AUTH_API',
      version: '1.0',
      resourcePath: 'users',
    };
  }

  // 7. HOSPITAL_MASTER_DATA_API (Departments, Consultation Types, Doctors)
  if (upperMethod === 'POST' && lower === 'departments') {
    return {
      integrationName: 'HOSPITAL_MASTER_DATA_API',
      version: '1.0',
      resourcePath: 'departments',
    };
  }
  if (
    (upperMethod === 'PUT' || upperMethod === 'DELETE') &&
    /^departments\/[^/]+$/.test(lower)
  ) {
    return {
      integrationName: 'HOSPITAL_MASTER_DATA_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (upperMethod === 'POST' && lower === 'consultation-types') {
    return {
      integrationName: 'HOSPITAL_MASTER_DATA_API',
      version: '1.0',
      resourcePath: 'consultation-types',
    };
  }
  if (
    (upperMethod === 'PUT' || upperMethod === 'DELETE') &&
    /^consultation-types\/[^/]+$/.test(lower)
  ) {
    return {
      integrationName: 'HOSPITAL_MASTER_DATA_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }
  if (upperMethod === 'POST' && lower === 'doctors') {
    return {
      integrationName: 'HOSPITAL_MASTER_DATA_API',
      version: '1.0',
      resourcePath: 'doctors',
    };
  }
  if ((upperMethod === 'PUT' || upperMethod === 'DELETE') && /^doctors\/[^/]+$/.test(lower)) {
    return {
      integrationName: 'HOSPITAL_MASTER_DATA_API',
      version: '1.0',
      resourcePath: cleanPath,
    };
  }

  return null;
}

export function resolveRoutingDecision(params: {
  mode: BackendMode;
  method: string;
  endpoint: string;
  oicConfigured: boolean;
  ordsBaseUrl: string;
  oicBaseUrl: string;
  enabledPhases?: OicPhaseId[];
}): RoutingDecision {
  const {
    mode,
    method,
    endpoint,
    oicConfigured,
    ordsBaseUrl,
    oicBaseUrl,
    enabledPhases = ALL_OIC_PHASES,
  } = params;

  const upperMethod = String(method || 'GET').trim().toUpperCase();
  const phase = classifyEndpointPhase(endpoint);
  const cleanOrds = ordsBaseUrl.replace(/\/+$/, '');
  const cleanOic = oicBaseUrl.replace(/\/+$/, '');
  const raw = String(endpoint || '').replace(/^\/+/, '');
  const ordsUrl = `${cleanOrds}/${raw}`;

  // Rule 1: All GET (and HEAD) endpoints always route directly to ORDS_BASE_URL (fast read path)
  if (upperMethod === 'GET' || upperMethod === 'HEAD') {
    return {
      servedBy: 'ORDS',
      mode,
      phase,
      integrationName: null,
      url: ordsUrl,
    };
  }

  // Rule 2: Write endpoints (POST, PUT, PATCH, DELETE) route to OIC when mode is HYBRID or OIC
  const oicModeActive = (mode === 'HYBRID' || mode === 'OIC') && oicConfigured;
  if (oicModeActive && enabledPhases.includes(phase)) {
    const oicRoute = resolveOicIntegrationRoute(upperMethod, endpoint);
    if (oicRoute && cleanOic) {
      const { queryPart } = splitEndpoint(endpoint);
      return {
        servedBy: 'OIC',
        mode,
        phase,
        integrationName: oicRoute.integrationName,
        url: `${cleanOic}/${oicRoute.integrationName}/${oicRoute.version}/${oicRoute.resourcePath}${queryPart}`,
      };
    }
  }

  // Fallback to ORDS_BASE_URL when toggled to ORDS mode or when no OIC flow exists for that write endpoint
  return {
    servedBy: 'ORDS',
    mode,
    phase,
    integrationName: null,
    url: ordsUrl,
  };
}

export function buildUpstreamUrl(
  ordsBaseUrl: string,
  oicBaseUrl: string,
  endpoint: string,
  targetBackend: ServedBy,
  method = 'GET',
): string {
  if (targetBackend === 'ORDS') {
    return `${ordsBaseUrl.replace(/\/+$/, '')}/${String(endpoint || '').replace(/^\/+/, '')}`;
  }
  const decision = resolveRoutingDecision({
    mode: 'HYBRID',
    method,
    endpoint,
    oicConfigured: Boolean(oicBaseUrl),
    ordsBaseUrl,
    oicBaseUrl,
  });
  return decision.url;
}

export function normalizeOicMutationPayload(
  method: string,
  endpoint: string,
  body: unknown,
  actorLabel = 'SYSTEM',
): Record<string, unknown> {
  const payload =
    body && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>) }
      : {};
  const upperMethod = String(method || 'GET').trim().toUpperCase();
  const { cleanPath } = splitEndpoint(endpoint);
  const lower = cleanPath.toLowerCase();

  if (lower === 'departments' && upperMethod === 'POST') {
    return {
      ...payload,
      description: payload.description ?? '',
      is_active: payload.is_active ?? 'Y',
    };
  }
  if (/^departments\/[^/]+$/.test(lower) && upperMethod === 'PUT') {
    return {
      ...payload,
      description: payload.description ?? '',
      is_active: payload.is_active ?? 'Y',
      updated_by: payload.updated_by ?? actorLabel,
    };
  }
  if (
    (lower === 'consultation-types' && upperMethod === 'POST') ||
    (/^consultation-types\/[^/]+$/.test(lower) && upperMethod === 'PUT')
  ) {
    return {
      ...payload,
      description: payload.description ?? '',
      consultation_fee: payload.consultation_fee ?? 0,
    };
  }
  if (
    (lower === 'doctors' && upperMethod === 'POST') ||
    (/^doctors\/[^/]+$/.test(lower) && upperMethod === 'PUT')
  ) {
    return {
      ...payload,
      specialization: payload.specialization ?? '',
      tele_consult_flag: payload.tele_consult_flag ?? 'N',
      employment_type: payload.employment_type ?? 'FULL_TIME',
    };
  }
  if (lower === 'leaves' && upperMethod === 'POST') {
    return {
      ...payload,
      requested_by: payload.requested_by ?? 1,
    };
  }
  if (/^leaves\/[^/]+\/decide$/.test(lower) && upperMethod === 'POST') {
    return {
      ...payload,
      comments: payload.comments ?? '',
    };
  }
  if (/^shift-change-requests\/[^/]+\/decide$/.test(lower) && upperMethod === 'POST') {
    return {
      ...payload,
      comments: payload.comments ?? '',
    };
  }
  if (lower === 'prescriptions' && upperMethod === 'POST') {
    return {
      ...payload,
      doctor_id: payload.doctor_id ?? 0,
      doctor_name: payload.doctor_name ?? '',
      appointment_ref: payload.appointment_ref ?? '',
      instructions: payload.instructions ?? '',
      status: payload.status ?? 'ACTIVE',
      medications_json:
        payload.medications_json ?? JSON.stringify(Array.isArray(payload.medications) ? payload.medications : []),
      idempotency_key: payload.idempotency_key || `RX-${Date.now()}`,
    };
  }
  if (lower === 'medical-records' && upperMethod === 'POST') {
    return {
      ...payload,
      doctor_id: payload.doctor_id ?? 0,
      doctor_name: payload.doctor_name ?? '',
      appointment_ref: payload.appointment_ref ?? '',
      vitals_summary: payload.vitals_summary ?? '',
      clinical_notes: payload.clinical_notes ?? '',
    };
  }
  if (/^medical-records\/[^/]+$/.test(lower) && upperMethod === 'PUT') {
    return {
      ...payload,
      chief_complaint: payload.chief_complaint ?? '',
      diagnosis: payload.diagnosis ?? '',
      vitals_summary: payload.vitals_summary ?? '',
      clinical_notes: payload.clinical_notes ?? '',
    };
  }
  if (/^prescriptions\/[^/]+$/.test(lower) && upperMethod === 'PUT') {
    return {
      ...payload,
      diagnosis: payload.diagnosis ?? '',
      instructions: payload.instructions ?? '',
      status: payload.status ?? 'ACTIVE',
      medications_json:
        payload.medications_json ?? JSON.stringify(Array.isArray(payload.medications) ? payload.medications : []),
    };
  }
  if (lower === 'auth/register' && upperMethod === 'POST') {
    return {
      ...payload,
      date_of_birth: payload.date_of_birth ?? '',
      gender: payload.gender ?? '',
      blood_group: payload.blood_group ?? '',
    };
  }
  if (
    (lower === 'patients' && upperMethod === 'POST') ||
    (/^patients\/[^/]+$/.test(lower) && upperMethod === 'PUT')
  ) {
    return {
      ...payload,
      date_of_birth: payload.date_of_birth ?? '',
      gender: payload.gender ?? '',
      blood_group: payload.blood_group ?? '',
    };
  }
  if (lower === 'users' && upperMethod === 'POST') {
    return {
      ...payload,
      phone_number: payload.phone_number ?? '',
      doctor_id: payload.doctor_id ?? 0,
    };
  }
  return payload;
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
