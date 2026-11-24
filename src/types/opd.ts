export type RoleName = 'SUPER_ADMIN' | 'ADMIN' | 'DOCTOR' | 'PATIENT' | 'RECEPTIONIST';

export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export type PermissionAction = 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT';

export type ModuleKey =
  | 'DASHBOARD'
  | 'PATIENTS'
  | 'DOCTORS'
  | 'RECEPTIONISTS'
  | 'DEPARTMENTS'
  | 'APPOINTMENTS'
  | 'SLOTS'
  | 'TOKEN_QUEUE'
  | 'PAYMENTS'
  | 'MEDICAL_RECORDS'
  | 'PRESCRIPTIONS'
  | 'REVENUE_ANALYTICS'
  | 'DOCTOR_ANALYTICS'
  | 'DEPARTMENT_ANALYTICS'
  | 'GEOGRAPHIC_ANALYTICS'
  | 'USERS'
  | 'ROLES'
  | 'PERMISSIONS'
  | 'SYSTEM_SETTINGS';

export interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  category: 'Overview' | 'Clinical' | 'Operations' | 'Analytics' | 'Administration';
  supportedActions: PermissionAction[];
  description: string;
}

export interface UserPermissionOverride {
  grants: string[];
  revokes: string[];
}

export interface AuthUser {
  user_id: number;
  username: string;
  email: string;
  full_name: string;
  phone_number?: string | null;
  role: RoleName;
  roles: RoleName[];
  status?: AccountStatus;
  permissions: string[];
  grants?: string[];
  revokes?: string[];
  doctor_id?: number | null;
  patient_id?: number | null;
  department_id?: number | null;
  department_name?: string | null;
  specialization?: string | null;
  auth_mode?: 'ords' | 'bridge' | 'system' | 'managed';
}

export interface Department {
  department_id: number;
  department_name: string;
  description?: string | null;
  is_active?: 'Y' | 'N';
  created_on?: string;
  updated_on?: string;
}

export interface ConsultationType {
  consultation_type_id: number;
  department_id: number;
  department_name?: string;
  consultation_type_name: string;
  description?: string | null;
  duration_mins: number;
  consultation_fee?: number | null;
  is_active?: 'Y' | 'N';
}

export interface Doctor {
  doctor_id: number;
  department_id: number;
  department_name?: string;
  first_name: string;
  last_name: string;
  specialization?: string | null;
  consultation_fee: number;
  tele_consult_flag: 'Y' | 'N';
  employment_type?: 'FULL_TIME' | 'PART_TIME';
  is_active?: 'Y' | 'N';
}

export interface Patient {
  patient_id: number;
  first_name: string;
  last_name: string;
  phone_number: string;
  email?: string | null;
  city?: string | null;
  locality?: string | null;
  date_of_birth?: string | null;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  blood_group?: string | null;
}

export interface SlotTemplate {
  template_id: number;
  doctor_id: number;
  doctor_name?: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  slot_duration_mins: number;
  max_patients_per_slot: number;
  is_active: 'Y' | 'N';
  consultation_type_id?: number | null;
}

export interface Slot {
  slot_id: number;
  doctor_id?: number | null;
  template_id?: number | null;
  slot_date: string;
  start_time: string;
  end_time: string;
  max_patients_per_slot: number;
  booked_patients: number;
  status: 'AVAILABLE' | 'SOLD_OUT' | 'CANCELLED';
  doctor_name?: string;
  department_id?: number;
  department_name?: string;
}

export type ConsultationMode = 'ONLINE' | 'FACE_TO_FACE';

export interface Appointment {
  appointment_id: number;
  appointment_ref: string;
  patient_id: number;
  patient_name: string;
  slot_id: number;
  status: 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED';
  hold_expires_at?: string | null;
  created_on?: string;
  booking_source?: 'ONLINE' | 'WALK_IN';
  consultation_mode?: ConsultationMode;
  rescheduled_from_id?: number | null;
  slot_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  consultation_fee?: number | null;
  payment_status?: 'UNPAID' | 'SUCCESS' | 'REFUND_PENDING' | 'REFUNDED' | 'NO_REFUND' | null;
  paid_amount?: number | null;
  payment_ref?: string | null;
  payment_method?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
  refund_status?: 'REFUND_PENDING' | 'REFUNDED' | 'NO_REFUND' | null;
  refund_due_at?: string | null;
  refund_completed_at?: string | null;
  refund_amount?: number | null;
  refund_percentage?: number | null;
  refund_rule_name?: string | null;
  cancellation_fee?: number | null;
}

export interface Payment {
  payment_id: number;
  appointment_id: number;
  appointment_ref: string;
  payment_ref: string;
  amount: number;
  payment_method?: string | null;
  status: 'SUCCESS' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED';
  created_on: string;
  paid_amount?: number | null;
  refund_status?: 'REFUND_PENDING' | 'REFUNDED' | 'NO_REFUND' | null;
  refund_due_at?: string | null;
  refund_completed_at?: string | null;
  refund_amount?: number | null;
  refund_percentage?: number | null;
  refund_rule_name?: string | null;
  cancellation_fee?: number | null;
  cancelled_at?: string | null;
}

export interface TokenQueueItem {
  queue_id: number;
  appointment_id: number;
  appointment_ref: string;
  department_id: number;
  department_name: string;
  queue_date: string;
  token_number: number;
  status: 'WAITING' | 'IN_CONSULTATION' | 'DONE' | 'SKIPPED';
  created_on?: string;
}

export interface DoctorLeave {
  leave_id: number;
  doctor_id: number;
  doctor_name?: string;
  requested_by: number;
  approved_by?: number | null;
  start_date: string;
  end_date: string;
  leave_reason?: string | null;
  leave_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requested_on?: string;
  approved_on?: string | null;
}

export interface ApprovalRequest {
  request_id: number;
  approval_type_id: number;
  approval_type_name?: string;
  requested_by: number;
  requester_name?: string;
  assigned_to?: number | null;
  request_description: string;
  target_table?: string | null;
  target_record_id?: number | null;
  request_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requested_on: string;
  decided_on?: string | null;
}

export interface ApprovalHistoryItem {
  history_id: number;
  request_id: number;
  action_by: number;
  actor_name?: string;
  action_name: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  comments?: string | null;
  action_on: string;
}

export interface CancellationRule {
  rule_id: number;
  rule_name: string;
  min_hours_before: number;
  max_hours_before?: number | null;
  refund_percentage: number;
  cancellation_fee: number;
  is_active: 'Y' | 'N';
}

export interface UserAccount {
  user_id: number;
  username: string;
  email: string;
  full_name: string;
  phone_number?: string | null;
  doctor_id?: number | null;
  patient_id?: number | null;
  role_name?: RoleName;
  is_active: 'Y' | 'N';
  status?: AccountStatus;
  created_on?: string;
}

export interface ManagedUserRecord {
  user_key: string;
  user_id: number;
  username: string;
  email: string;
  full_name: string;
  phone_number?: string | null;
  role: RoleName;
  status: AccountStatus;
  doctor_id?: number | null;
  patient_id?: number | null;
  grants: string[];
  revokes: string[];
  role_permissions: string[];
  effective_permissions: string[];
  created_on?: string;
  source: 'system' | 'ords' | 'managed';
  is_protected: boolean;
}

export interface RoleDefinition {
  role: RoleName;
  label: string;
  description: string;
  is_protected: boolean;
  is_immutable: boolean;
  allow_public_registration: boolean;
  max_accounts?: number | null;
  user_count: number;
  active_count: number;
  permission_count: number;
  permissions: string[];
}

export interface SecuritySettings {
  max_failed_login_attempts: number;
  lockout_minutes: number;
  min_password_length: number;
  session_ttl_hours: number;
  allow_patient_registration: boolean;
  enforce_strict_role_portal: boolean;
}

export interface RbacAuditLogEntry {
  id: string;
  actor_user_id: number | null;
  actor_name: string;
  actor_role: string;
  target_user_id?: number | null;
  target_label?: string | null;
  action: string;
  category: 'USER' | 'ROLE' | 'PERMISSION' | 'AUTH' | 'SECURITY' | 'CLINICAL' | 'BILLING';
  previous_value?: string | null;
  new_value?: string | null;
  details: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface SuperAdminOverviewResponse {
  status: 'success';
  generated_at: string;
  metrics: {
    total_users: number;
    total_admins: number;
    total_doctors: number;
    total_receptionists: number;
    total_patients: number;
    active_accounts: number;
    inactive_accounts: number;
    suspended_accounts: number;
  };
  recent_registrations: ManagedUserRecord[];
  recent_permission_changes: RbacAuditLogEntry[];
  recent_security_activities: RbacAuditLogEntry[];
  roles: RoleDefinition[];
  consultation_metrics?: {
    online_consultations: number;
    face_to_face_consultations: number;
    total_active_appointments: number;
  };
  recent_appointments?: Appointment[];
}

export interface MedicalRecordEntry {
  record_id: string;
  patient_id: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  appointment_ref?: string | null;
  visit_date: string;
  chief_complaint: string;
  diagnosis: string;
  vitals_summary?: string | null;
  clinical_notes: string;
  updated_at: string;
}

export interface PrescriptionEntry {
  prescription_id: string;
  patient_id: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  appointment_ref?: string | null;
  prescribed_date: string;
  diagnosis: string;
  medications: Array<{
    name: string;
    dosage: string;
    frequency: string;
    duration: string;
  }>;
  instructions: string;
  status: 'ACTIVE' | 'COMPLETED';
  updated_at: string;
}

export interface RoleRecord {
  role_id: number;
  role_name: RoleName;
  description?: string | null;
  is_active: 'Y' | 'N';
  permission_count?: number;
}

export interface PermissionRecord {
  permission_id: number;
  permission_name: string;
  resource_name: string;
  action_name: string;
  description?: string | null;
}

export interface AuditLogRecord {
  audit_id: number;
  user_id?: number | null;
  username?: string | null;
  action_name: string;
  table_name: string;
  record_id?: string | null;
  action_description?: string | null;
  action_on: string;
}

export interface ErrorLogRecord {
  log_id: number;
  module_name: string;
  procedure_name: string;
  oracle_error_code?: number | null;
  error_message?: string | null;
  additional_info?: string | null;
  user_name?: string | null;
  created_on: string;
}

export interface UtilisationReportRow {
  department_name: string;
  doctor_name: string;
  total_slots: number;
  total_capacity: number;
  total_booked: number;
  avg_utilisation_pct: number;
}

export interface DashboardMetrics {
  total_patients: number;
  total_doctors: number;
  total_departments: number;
  total_appointments: number;
  todays_appointments: number;
  held_appointments: number;
  confirmed_appointments: number;
  completed_appointments: number;
  cancelled_appointments: number;
  available_slots_today: number;
  total_slots_today: number;
  total_payments_amount: number;
  payments_count: number;
  waiting_tokens: number;
  in_consultation_tokens: number;
  done_tokens: number;
  pending_approvals: number | null;
  online_consultations?: number;
  face_to_face_consultations?: number;
}

export interface ShiftSession {
  start_time: string;
  end_time: string;
}

export interface ShiftChangeRequest {
  request_id: string;
  doctor_id: number;
  doctor_name: string;
  current_sessions: ShiftSession[];
  current_slot_duration_mins: number;
  current_working_days: string[];
  requested_sessions: ShiftSession[];
  requested_slot_duration_mins: number;
  requested_working_days: string[];
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_on: string;
  decided_on?: string | null;
  decided_by?: string | null;
  decision_comments?: string | null;
}

export interface DoctorShiftConfig {
  doctor_id: number;
  doctor_name?: string;
  sessions: ShiftSession[];
  slot_duration_mins: number;
  working_days: string[];
  is_registered: boolean;
  registered_at?: string | null;
  updated_at?: string | null;
  pending_change_request?: ShiftChangeRequest | null;
}

export interface DashboardSummaryResponse {
  role: RoleName;
  generated_at: string;
  source: 'oracle_ords';
  metrics: DashboardMetrics;
  recent_appointments: Appointment[];
  upcoming_slots: Slot[];
  departments: Department[];
  doctors: Doctor[];
  token_queue: TokenQueueItem[];
  payments: Payment[];
  utilisation: UtilisationReportRow[];
  patient_profile?: Patient | null;
  doctor_profile?: Doctor | null;
  doctor_templates?: SlotTemplate[];
  doctor_shift?: DoctorShiftConfig | null;
  all_doctor_shifts?: DoctorShiftConfig[];
  doctor_all_slots?: Slot[];
  doctor_leaves?: DoctorLeave[];
  doctor_slots_today_count?: number;
  doctor_on_leave_today?: boolean;
  pending_outcome_appointments?: Appointment[];
}

export type RouteKey =
  | 'dashboard'
  | 'analytics'
  | 'patients'
  | 'register-patient'
  | 'doctors'
  | 'departments'
  | 'consultation-types'
  | 'appointments'
  | 'book-appointment'
  | 'appointment-history'
  | 'slots'
  | 'doctor-leaves'
  | 'approvals'
  | 'payments'
  | 'token-queue'
  | 'medical-records'
  | 'prescriptions'
  | 'users-roles'
  | 'role-management'
  | 'permission-management'
  | 'audit-logs'
  | 'security-settings'
  | 'error-logs'
  | 'profile';

export interface NavItem {
  key: RouteKey;
  label: string;
  section: 'governance' | 'overview' | 'clinical' | 'operations' | 'administration';
  requiredPermission?: string;
  anyOfPermissions?: string[];
}

export interface PortalNotification {
  id: string;
  category:
    | 'SHIFT_REQUEST'
    | 'LEAVE_REQUEST'
    | 'APPROVAL_REQUEST'
    | 'NEW_APPOINTMENT'
    | 'ADMIN_RESPONSE'
    | 'PRESCRIPTION_CREATED'
    | 'PRESCRIPTION_UPDATED';
  title: string;
  message: string;
  route: RouteKey;
  created_at: string;
  read: boolean;
  severity: 'info' | 'success' | 'warning';
  doctor_name?: string;
  appointment_ref?: string | null;
  prescription_id?: string;
  patient_id?: number;
}

export type AnalyticsSourceTag = 'HISTORICAL' | 'LIVE';

export interface AnalyticsVisitRecord {
  id: string;
  source: AnalyticsSourceTag;
  visit_date: string; // YYYY-MM-DD
  visit_month: string; // YYYY-MM
  start_time: string; // HH:MM
  doctor_id: number;
  doctor_name: string;
  department_id: number;
  department_name: string;
  specialization: string;
  patient_id: number;
  patient_name: string;
  patient_gender: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  patient_age_group: '0-18' | '19-35' | '36-55' | '56+' | 'Unknown';
  city: string;
  locality: string;
  status: 'HELD' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  booking_source: 'ONLINE' | 'WALK_IN';
  consultation_mode?: ConsultationMode;
  rescheduled_from_id?: number | null;
  payment_method: 'UPI' | 'CARD' | 'CASH' | 'NETBANKING' | 'UNPAID';
  amount: number;
}

export interface PendingOutcomeItem {
  appointment_id: number;
  appointment_ref: string;
  doctor_id: number;
  doctor_name: string;
  department_name: string;
  patient_name: string;
  slot_date: string;
  start_time: string;
  end_time: string;
}

export interface AnalyticsDatasetResponse {
  status: 'success';
  generated_at: string;
  range_start: string;
  range_end: string;
  historical_count: number;
  live_count: number;
  pending_outcome_count?: number;
  pending_outcomes?: PendingOutcomeItem[];
  records: AnalyticsVisitRecord[];
  allowed_sections?: {
    revenue: boolean;
    doctor: boolean;
    department: boolean;
    geographic: boolean;
    export_revenue: boolean;
    export_doctor: boolean;
    export_department: boolean;
    export_geographic: boolean;
  };
}
