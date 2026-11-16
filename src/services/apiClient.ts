import type {
  Appointment,
  AuditLogRecord,
  AuthUser,
  CancellationRule,
  ConsultationType,
  DashboardSummaryResponse,
  Department,
  Doctor,
  DoctorLeave,
  DoctorShiftConfig,
  ErrorLogRecord,
  Patient,
  Payment,
  PermissionRecord,
  PortalNotification,
  RoleName,
  RoleRecord,
  ShiftChangeRequest,
  ShiftSession,
  Slot,
  SlotTemplate,
  TokenQueueItem,
  UserAccount,
} from '../types/opd';
import { normalizeOrdsError } from '../utils/rules';

const TOKEN_STORAGE_KEY = 'carepulse_opd_session_token';
const departmentByIdCache = new Map<number, Department | null>();

export class ApiHttpError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
  }
}

export function isEndpointNotDeployedError(err: unknown): boolean {
  return err instanceof ApiHttpError && (err.statusCode === 404 || err.statusCode === 405);
}

export function getStoredSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage unavailability
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
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
    throw new ApiHttpError(
      normalizeOrdsError(parsed, `Request failed (${response.status})`),
      response.status,
    );
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    'status' in parsed &&
    (parsed as { status?: string }).status === 'error'
  ) {
    throw new ApiHttpError(normalizeOrdsError(parsed, 'Oracle ORDS returned an error'), 400);
  }

  return parsed as T;
}

async function fetchCollection<T>(ordsPath: string): Promise<T[]> {
  const sep = ordsPath.includes('?') ? '&' : '?';
  const res = await requestJson<{ items?: T[] }>(`/api/ords/${ordsPath}${sep}limit=500`);
  return Array.isArray(res.items) ? res.items : [];
}

export interface RegisterPatientInput {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  date_of_birth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | '';
  blood_group?: string;
  password?: string;
}

export interface OrdsActionResponse {
  status: string;
  message?: string;
  appointment_ref?: string;
  expired_count?: number;
}

export interface DirectoryAccountEntry {
  role: RoleName;
  full_name: string;
  email: string;
  detail?: string;
}

export const apiClient = {
  async getLoginDirectory(role?: RoleName): Promise<DirectoryAccountEntry[]> {
    const qs = role ? `?role=${encodeURIComponent(role)}` : '';
    const res = await requestJson<{ status: string; accounts?: DirectoryAccountEntry[] }>(
      `/api/auth/directory${qs}`,
    );
    return Array.isArray(res.accounts) ? res.accounts : [];
  },

  async login(input: {
    full_name: string;
    email: string;
    password: string;
    expected_role?: RoleName;
  }): Promise<AuthUser> {
    const res = await requestJson<{ status: string; user: AuthUser; token?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          full_name: input.full_name,
          email: input.email,
          identifier: input.email,
          password: input.password,
          ...(input.expected_role ? { expected_role: input.expected_role } : {}),
        }),
      },
    );
    if (res.token) setStoredSessionToken(res.token);
    return res.user;
  },

  async registerPatient(input: RegisterPatientInput): Promise<AuthUser> {
    const res = await requestJson<{ status: string; user: AuthUser; token?: string }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
    if (res.token) setStoredSessionToken(res.token);
    return res.user;
  },

  async patientForgotPassword(input: {
    email: string;
    phone_number: string;
    new_password: string;
    confirm_password: string;
  }): Promise<{ status: string; message: string }> {
    return requestJson<{ status: string; message: string }>(
      '/api/auth/patient/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    const res = await requestJson<{ status: string; user: AuthUser | null }>('/api/auth/me');
    return res.user ?? null;
  },

  async logout(): Promise<void> {
    try {
      await requestJson('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredSessionToken(null);
    }
  },

  async getDashboardSummary(): Promise<DashboardSummaryResponse> {
    return requestJson<DashboardSummaryResponse>('/api/dashboard/summary');
  },

  async getNotifications(): Promise<{
    unread_count: number;
    notifications: PortalNotification[];
  }> {
    return requestJson<{
      status: string;
      unread_count: number;
      notifications: PortalNotification[];
    }>('/api/notifications');
  },

  async dismissNotifications(payload: { ids?: string[]; all?: boolean }): Promise<{
    unread_count: number;
    notifications: PortalNotification[];
  }> {
    return requestJson<{
      status: string;
      unread_count: number;
      notifications: PortalNotification[];
    }>('/api/notifications/dismiss', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Departments
  getDepartments: () => fetchCollection<Department>('departments/'),
  getDepartmentById: async (id: number) => {
    const res = await requestJson<{ items?: Department[] }>(`/api/ords/departments/${id}`);
    return res.items?.[0] ?? null;
  },
  resolveDepartmentsForIds: async (deptIds: number[], activeDepts: Department[]) => {
    const known = new Set(activeDepts.map((d) => d.department_id));
    const missing = Array.from(new Set(deptIds.filter((id) => id && !known.has(id))));
    if (missing.length === 0) return activeDepts;
    const extra = (
      await Promise.all(
        missing.map(async (id) => {
          if (departmentByIdCache.has(id)) return departmentByIdCache.get(id) ?? null;
          try {
            const res = await requestJson<{ items?: Department[] }>(`/api/ords/departments/${id}`);
            const item = res.items?.[0] ?? null;
            departmentByIdCache.set(id, item);
            return item;
          } catch {
            departmentByIdCache.set(id, null);
            return null;
          }
        }),
      )
    ).filter((d): d is Department => Boolean(d));
    return [...activeDepts, ...extra];
  },
  createDepartment: (payload: { department_name: string; description?: string }) =>
    requestJson<OrdsActionResponse>('/api/ords/departments/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDepartment: (id: number, payload: { department_name: string; description?: string }) =>
    requestJson<OrdsActionResponse>(`/api/ords/departments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deactivateDepartment: (id: number) =>
    requestJson<OrdsActionResponse>(`/api/ords/departments/${id}`, { method: 'DELETE' }),

  // Consultation Types
  getConsultationTypes: () => fetchCollection<ConsultationType>('consultation-types/'),
  createConsultationType: (payload: {
    department_id: number;
    consultation_type_name: string;
    description?: string;
    duration_mins: number;
    consultation_fee?: number | null;
  }) =>
    requestJson<OrdsActionResponse>('/api/ords/consultation-types/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateConsultationType: (
    id: number,
    payload: {
      department_id: number;
      consultation_type_name: string;
      description?: string;
      duration_mins: number;
      consultation_fee?: number | null;
    },
  ) =>
    requestJson<OrdsActionResponse>(`/api/ords/consultation-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deactivateConsultationType: (id: number) =>
    requestJson<OrdsActionResponse>(`/api/ords/consultation-types/${id}`, { method: 'DELETE' }),

  // Doctors
  getDoctors: () => fetchCollection<Doctor>('doctors'),
  createDoctor: (payload: {
    department_id: number;
    first_name: string;
    last_name: string;
    specialization?: string;
    consultation_fee: number;
    tele_consult_flag: 'Y' | 'N';
    employment_type?: 'FULL_TIME' | 'PART_TIME';
    login_email?: string;
    initial_password?: string;
  }) =>
    requestJson<OrdsActionResponse & { doctor_id?: number; login_email?: string }>(
      '/api/ords/doctors',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  updateDoctor: (
    id: number,
    payload: {
      department_id: number;
      first_name: string;
      last_name: string;
      specialization?: string;
      consultation_fee: number;
      tele_consult_flag: 'Y' | 'N';
      employment_type?: 'FULL_TIME' | 'PART_TIME';
    },
  ) =>
    requestJson<OrdsActionResponse>(`/api/ords/doctors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deactivateDoctor: (id: number) =>
    requestJson<OrdsActionResponse>(`/api/ords/doctors/${id}`, { method: 'DELETE' }),

  // Patients
  getPatients: (filters?: { phone?: string; gender?: string }) => {
    const params = new URLSearchParams();
    if (filters?.phone) params.set('phone', filters.phone);
    if (filters?.gender) params.set('gender', filters.gender);
    const qs = params.toString();
    return fetchCollection<Patient>(qs ? `patients?${qs}` : 'patients');
  },
  createPatient: (payload: Omit<RegisterPatientInput, 'password'>) =>
    requestJson<OrdsActionResponse>('/api/ords/patients', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePatient: (id: number, payload: Omit<RegisterPatientInput, 'password'>) =>
    requestJson<OrdsActionResponse>(`/api/ords/patients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Doctor Shift Windows & Single-Day Slots (No bulk 1-week generation, no UI slot template management)
  getSlotTemplates: () => fetchCollection<SlotTemplate>('slot_templates'),
  getSlots: () => fetchCollection<Slot>('slots'),
  getDoctorShifts: () =>
    requestJson<{
      status: string;
      shift?: DoctorShiftConfig;
      shifts: DoctorShiftConfig[];
      change_requests: ShiftChangeRequest[];
    }>('/api/doctor/shifts'),
  registerDoctorShift: (payload: {
    sessions: ShiftSession[];
    slot_duration_mins: number;
    working_days: string[];
  }) =>
    requestJson<{ status: string; message: string; shift: DoctorShiftConfig }>(
      '/api/doctor/shift/register',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  requestShiftChange: (payload: {
    sessions: ShiftSession[];
    slot_duration_mins: number;
    working_days: string[];
    reason: string;
  }) =>
    requestJson<{ status: string; message: string; request: ShiftChangeRequest }>(
      '/api/doctor/shift/change-request',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  getShiftChangeRequests: () =>
    requestJson<{ status: string; requests: ShiftChangeRequest[] }>(
      '/api/admin/shift-change-requests',
    ),
  decideShiftChangeRequest: (
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    comments?: string,
  ) =>
    requestJson<{ status: string; message: string; request: ShiftChangeRequest }>(
      `/api/admin/shift-change-requests/${encodeURIComponent(requestId)}/decide`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, comments }),
      },
    ),
  confirmDoctorSlots: (payload: {
    doctor_id?: number;
    slots: Array<{
      slot_date: string;
      start_time: string;
      end_time: string;
      template_id?: number;
      max_patients_per_slot?: number;
    }>;
  }) =>
    requestJson<OrdsActionResponse & { created_count?: number; skipped_count?: number }>(
      '/api/doctor/slots/confirm',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  confirmDoctorDaySlots: (payload: { slot_date?: string; duration_mins?: number }) =>
    requestJson<OrdsActionResponse & { created_count?: number }>(
      '/api/doctor/slots/confirm-day',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  // Appointments
  getAppointments: () => fetchCollection<Appointment>('appointments'),
  bookAppointment: (payload: {
    patient_id: number;
    slot_id: number;
    booking_source: 'ONLINE' | 'WALK_IN';
  }) =>
    requestJson<OrdsActionResponse>('/api/ords/appointments/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  confirmAppointment: (appointmentId: number) =>
    requestJson<OrdsActionResponse>(`/api/ords/appointments/${appointmentId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  cancelAppointment: (appointmentId: number) =>
    requestJson<OrdsActionResponse>(`/api/ords/appointments/${appointmentId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  updateAppointmentOutcome: (appointmentId: number, outcome: 'COMPLETED' | 'NO_SHOW') =>
    requestJson<OrdsActionResponse>(`/api/ords/appointments/${appointmentId}/outcome`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    }),
  expireAppointmentHolds: () =>
    requestJson<OrdsActionResponse>('/api/ords/appointments/expire-holds', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getCancellationRules: () => fetchCollection<CancellationRule>('cancellation-rules'),

  // Payments
  getPayments: () => fetchCollection<Payment>('payments'),
  recordPayment: (payload: {
    appointment_id: number;
    amount: number;
    payment_method: string;
    status: 'SUCCESS' | 'FAILED' | 'REFUNDED';
  }) =>
    requestJson<OrdsActionResponse>('/api/ords/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Token Queue
  getTokenQueue: () => fetchCollection<TokenQueueItem>('token_queue'),
  issueToken: (payload: { appointment_id: number }) =>
    requestJson<OrdsActionResponse>('/api/ords/token_queue', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTokenStatus: (queueId: number, status: TokenQueueItem['status']) =>
    requestJson<OrdsActionResponse>(`/api/ords/token_queue/${queueId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Doctor Leaves & Approvals
  getLeaves: () => fetchCollection<DoctorLeave>('leaves'),
  submitLeave: (payload: {
    doctor_id?: number;
    start_date: string;
    end_date: string;
    leave_reason: string;
  }) =>
    requestJson<OrdsActionResponse>('/api/ords/leaves', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decideLeave: (leaveId: number, decision: 'APPROVED' | 'REJECTED', comments?: string) =>
    requestJson<OrdsActionResponse>(`/api/ords/leaves/${leaveId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, comments }),
    }),

  // Users, Roles & Logs (Admin)
  getUsers: () => fetchCollection<UserAccount>('users'),
  createUser: (payload: {
    username: string;
    email: string;
    full_name: string;
    password: string;
    role_name: string;
    phone_number?: string;
    doctor_id?: number | null;
  }) =>
    requestJson<OrdsActionResponse>('/api/ords/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getRoles: () => fetchCollection<RoleRecord>('roles'),
  getPermissions: () => fetchCollection<PermissionRecord>('permissions'),
  getAuditLogs: () => fetchCollection<AuditLogRecord>('audit-logs'),
  getErrorLogs: () => fetchCollection<ErrorLogRecord>('error-logs'),
};
