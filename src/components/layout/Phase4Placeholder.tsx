import { Layers } from 'lucide-react';
import type { RouteKey } from '../../types/opd';

const MODULE_META: Record<
  Exclude<RouteKey, 'dashboard'>,
  { title: string; summary: string; oracleObjects: string }
> = {
  patients: {
    title: 'Patient Directory & Records',
    summary: 'Search, register, update patient demographics, and inspect appointment history.',
    oracleObjects: 'GIRISH_PATIENTS · GET/POST /patients',
  },
  'register-patient': {
    title: 'Front-Desk Patient Registration',
    summary: 'Register walk-in or new patients directly into Oracle GIRISH_PATIENTS.',
    oracleObjects: 'GIRISH_PATIENTS · POST /patients',
  },
  doctors: {
    title: 'Doctor Directory & Profiles',
    summary: 'Manage doctor profiles, departments, consultation fees, and employment types.',
    oracleObjects: 'GIRISH_DOCTORS · GET/POST/PUT/DELETE /doctors',
  },
  departments: {
    title: 'Department Management',
    summary: 'Create, update, and activate or deactivate hospital departments.',
    oracleObjects: 'GIRISH_DEPARTMENTS · GET/POST/PUT/DELETE /departments/',
  },
  'consultation-types': {
    title: 'Consultation Types',
    summary: 'Configure consultation durations and fee tiers by department.',
    oracleObjects: 'GIRISH_CONSULTATION_TYPES · POST /consultation-types/',
  },
  appointments: {
    title: 'Appointments Workspace',
    summary: 'Filter, confirm held bookings, cancel appointments, and record consultation outcomes.',
    oracleObjects: 'GIRISH_BOOK_APPOINTMENT · GIRISH_CONFIRM_APPOINTMENT · GIRISH_CANCEL_APPOINTMENT',
  },
  'book-appointment': {
    title: 'Book OPD Appointment',
    summary: 'Select department, doctor, and available slot to hold or confirm a booking.',
    oracleObjects: 'GIRISH_BOOK_APPOINTMENT · POST /appointments/',
  },
  'appointment-history': {
    title: 'Appointment History',
    summary: 'Review completed, cancelled, and past consultation records.',
    oracleObjects: 'GIRISH_APPOINTMENTS · GET /appointments',
  },
  slots: {
    title: 'Schedules & Slot Management',
    summary: 'Manage recurring slot templates and generate daily appointment slots.',
    oracleObjects: 'GIRISH_SLOT_TEMPLATES · GIRISH_SLOTS · GIRISH_GENERATE_SLOTS',
  },
  'doctor-leaves': {
    title: 'Doctor Leave Requests',
    summary: 'Submit doctor leave requests and review approval conflicts and slot impacts.',
    oracleObjects: 'GIRISH_DOCTOR_LEAVES · GIRISH_DECIDE_DOCTOR_LEAVE',
  },
  approvals: {
    title: 'Approval Governance Queue',
    summary: 'Review pending approval requests and full approval decision history.',
    oracleObjects: 'GIRISH_APPROVAL_REQUESTS · GIRISH_APPROVAL_HISTORY',
  },
  payments: {
    title: 'Payments & Fee Ledger',
    summary: 'Track consultation payments, receipts, refunds, and pending balances.',
    oracleObjects: 'GIRISH_PAYMENTS · GET /payments',
  },
  'token-queue': {
    title: 'OPD Token Queue',
    summary: 'Issue daily tokens and advance patients through Waiting, In Consultation, and Done.',
    oracleObjects: 'GIRISH_TOKEN_QUEUE · GET /token_queue',
  },
  'users-roles': {
    title: 'Users, Roles & Permissions',
    summary: 'Manage system accounts, role assignments, and granular RBAC permissions.',
    oracleObjects: 'GIRISH_USERS · GIRISH_ROLES · GIRISH_ROLE_PERMISSIONS',
  },
  'audit-logs': {
    title: 'System Audit Logs',
    summary: 'Inspect login, logout, insert, update, and delete audit trail events.',
    oracleObjects: 'GIRISH_AUDIT_LOGS · GIRISH_AUDIT_CONFIG',
  },
  'error-logs': {
    title: 'PL/SQL & API Error Logs',
    summary: 'Monitor backend procedure exceptions and Oracle error traces.',
    oracleObjects: 'GIRISH_ERROR_LOGS · GIRISH_ERROR_LOG',
  },
  profile: {
    title: 'My Profile',
    summary: 'View and update your personal contact details and clinical account metadata.',
    oracleObjects: 'GIRISH_USERS · GIRISH_PATIENTS / GIRISH_DOCTORS',
  },
};

interface Phase4PlaceholderProps {
  route: Exclude<RouteKey, 'dashboard'>;
  onBackToDashboard: () => void;
}

export function Phase4Placeholder({ route, onBackToDashboard }: Phase4PlaceholderProps) {
  const meta = MODULE_META[route];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-800">
            <Layers className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-medium text-teal-700">Clinical Operations Module</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{meta.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{meta.summary}</p>
            <p className="mt-3 font-mono text-xs text-slate-500">{meta.oracleObjects}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBackToDashboard}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
