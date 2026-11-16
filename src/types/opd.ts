export type RoleName = 'ADMIN' | 'DOCTOR' | 'PATIENT' | 'RECEPTIONIST';

export interface AuthUser {
  user_id: number;
  username: string;
  email: string;
  full_name: string;
  phone_number?: string | null;
  role: RoleName;
  roles: RoleName[];
  permissions: string[];
  doctor_id?: number | null;
  patient_id?: number | null;
  department_id?: number | null;
  department_name?: string | null;
  specialization?: string | null;
  auth_mode?: 'ords' | 'bridge';
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
  template_id: number;
  slot_date: string;
  start_time: string;
  end_time: string;
  max_patients_per_slot: number;
  booked_patients: number;
  status: 'AVAILABLE' | 'SOLD_OUT' | 'CANCELLED';
  doctor_id?: number;
  doctor_name?: string;
  department_id?: number;
  department_name?: string;
}

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
  slot_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  consultation_fee?: number | null;
}

export interface Payment {
  payment_id: number;
  appointment_id: number;
  appointment_ref: string;
  payment_ref: string;
  amount: number;
  payment_method?: string | null;
  status: 'SUCCESS' | 'FAILED' | 'REFUNDED';
  created_on: string;
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
  created_on?: string;
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
}

export type RouteKey =
  | 'dashboard'
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
  | 'users-roles'
  | 'audit-logs'
  | 'error-logs'
  | 'profile';

export interface NavItem {
  key: RouteKey;
  label: string;
  section: 'overview' | 'clinical' | 'operations' | 'administration';
  requiredPermission?: string;
}

export interface PortalNotification {
  id: string;
  category: 'SHIFT_REQUEST' | 'LEAVE_REQUEST' | 'APPROVAL_REQUEST' | 'NEW_APPOINTMENT' | 'ADMIN_RESPONSE';
  title: string;
  message: string;
  route: RouteKey;
  created_at: string;
  read: boolean;
  severity: 'info' | 'success' | 'warning';
}
