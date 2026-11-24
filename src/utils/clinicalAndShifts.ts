import type {
  DoctorShiftConfig,
  MedicalRecordEntry,
  PrescriptionEntry,
  ShiftChangeRequest,
  ShiftSession,
} from '../types/opd';

function parseJsonArray<T>(raw: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function parseWorkingDays(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((d) => String(d || '').trim().toUpperCase())
      .filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      return parseJsonArray<string>(trimmed)
        .map((d) => String(d || '').trim().toUpperCase())
        .filter(Boolean);
    }
    return trimmed
      .split(',')
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean);
  }
  return [];
}

function normalizeIsoDate(raw: unknown, fallback = ''): string {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

function normalizeIsoTimestamp(raw: unknown, fallback = ''): string {
  const s = String(raw || '').trim();
  return s || fallback;
}

function parseMedications(
  raw: unknown,
): PrescriptionEntry['medications'] {
  const list = parseJsonArray<Record<string, unknown>>(raw, []);
  return list
    .map((m) => ({
      name: String(m?.name || '').trim(),
      dosage: String(m?.dosage || '').trim(),
      frequency: String(m?.frequency || '').trim(),
      duration: String(m?.duration || '').trim(),
    }))
    .filter((m) => m.name.length > 0);
}

function parseSessions(raw: unknown): ShiftSession[] {
  const list = parseJsonArray<Record<string, unknown>>(raw, []);
  return list
    .map((s) => ({
      start_time: String(s?.start_time || '').trim().slice(0, 5),
      end_time: String(s?.end_time || '').trim().slice(0, 5),
    }))
    .filter((s) => s.start_time.length === 5 && s.end_time.length === 5);
}

export function parseOracleMedicalRecordRow(
  row: Record<string, unknown>,
): MedicalRecordEntry | null {
  const recordId = String(row.record_id ?? row.RECORD_ID ?? '').trim();
  const patientId = Number(row.patient_id ?? row.PATIENT_ID ?? 0);
  if (!recordId || !patientId) return null;

  return {
    record_id: recordId,
    patient_id: patientId,
    patient_name: String(
      row.patient_name ?? row.PATIENT_NAME ?? `Patient #${patientId}`,
    ).trim(),
    doctor_id: Number(row.doctor_id ?? row.DOCTOR_ID ?? 0),
    doctor_name: String(row.doctor_name ?? row.DOCTOR_NAME ?? '').trim(),
    appointment_ref:
      String(row.appointment_ref ?? row.APPOINTMENT_REF ?? '').trim() || null,
    visit_date: normalizeIsoDate(row.visit_date ?? row.VISIT_DATE),
    chief_complaint: String(
      row.chief_complaint ?? row.CHIEF_COMPLAINT ?? '',
    ).trim(),
    diagnosis: String(row.diagnosis ?? row.DIAGNOSIS ?? '').trim(),
    vitals_summary:
      String(row.vitals_summary ?? row.VITALS_SUMMARY ?? '').trim() || null,
    clinical_notes: String(
      row.clinical_notes ?? row.CLINICAL_NOTES ?? '',
    ).trim(),
    updated_at: normalizeIsoTimestamp(
      row.updated_at ?? row.updated_on ?? row.UPDATED_ON ?? row.created_on ?? row.CREATED_ON,
    ),
  };
}

export function serializeMedicalRecordForOracle(entry: MedicalRecordEntry) {
  return {
    record_id: entry.record_id,
    patient_id: entry.patient_id,
    patient_name: entry.patient_name,
    doctor_id: entry.doctor_id || null,
    doctor_name: entry.doctor_name,
    appointment_ref: entry.appointment_ref || null,
    visit_date: entry.visit_date.slice(0, 10),
    chief_complaint: entry.chief_complaint,
    diagnosis: entry.diagnosis,
    vitals_summary: entry.vitals_summary || null,
    clinical_notes: entry.clinical_notes || '',
  };
}

export function parseOraclePrescriptionRow(
  row: Record<string, unknown>,
): PrescriptionEntry | null {
  const prescriptionId = String(
    row.prescription_id ?? row.PRESCRIPTION_ID ?? '',
  ).trim();
  const patientId = Number(row.patient_id ?? row.PATIENT_ID ?? 0);
  if (!prescriptionId || !patientId) return null;

  const rawStatus = String(row.status ?? row.STATUS ?? 'ACTIVE')
    .trim()
    .toUpperCase();
  const status: 'ACTIVE' | 'COMPLETED' =
    rawStatus === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE';

  return {
    prescription_id: prescriptionId,
    patient_id: patientId,
    patient_name: String(
      row.patient_name ?? row.PATIENT_NAME ?? `Patient #${patientId}`,
    ).trim(),
    doctor_id: Number(row.doctor_id ?? row.DOCTOR_ID ?? 0),
    doctor_name: String(row.doctor_name ?? row.DOCTOR_NAME ?? '').trim(),
    appointment_ref:
      String(row.appointment_ref ?? row.APPOINTMENT_REF ?? '').trim() || null,
    prescribed_date: normalizeIsoDate(
      row.prescribed_date ?? row.PRESCRIBED_DATE,
    ),
    diagnosis: String(row.diagnosis ?? row.DIAGNOSIS ?? '').trim(),
    medications: parseMedications(
      row.medications ?? row.medications_json ?? row.MEDICATIONS_JSON,
    ),
    instructions: String(row.instructions ?? row.INSTRUCTIONS ?? '').trim(),
    status,
    updated_at: normalizeIsoTimestamp(
      row.updated_at ?? row.updated_on ?? row.UPDATED_ON ?? row.created_on ?? row.CREATED_ON,
    ),
  };
}

export function serializePrescriptionForOracle(
  entry: PrescriptionEntry,
  idempotencyKey?: string,
) {
  return {
    prescription_id: entry.prescription_id,
    patient_id: entry.patient_id,
    patient_name: entry.patient_name,
    doctor_id: entry.doctor_id || null,
    doctor_name: entry.doctor_name,
    appointment_ref: entry.appointment_ref || null,
    prescribed_date: entry.prescribed_date.slice(0, 10),
    diagnosis: entry.diagnosis,
    medications: entry.medications,
    medications_json: JSON.stringify(entry.medications),
    instructions: entry.instructions || '',
    status: entry.status,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  };
}

export function parseOracleDoctorShiftRow(
  row: Record<string, unknown>,
): DoctorShiftConfig | null {
  const doctorId = Number(row.doctor_id ?? row.DOCTOR_ID ?? 0);
  if (!doctorId) return null;

  const isRegRaw = row.is_registered ?? row.IS_REGISTERED ?? 'Y';
  const isRegistered =
    typeof isRegRaw === 'boolean'
      ? isRegRaw
      : String(isRegRaw).trim().toUpperCase() !== 'N';

  return {
    doctor_id: doctorId,
    doctor_name: String(row.doctor_name ?? row.DOCTOR_NAME ?? '').trim() || undefined,
    sessions: parseSessions(
      row.sessions ?? row.sessions_json ?? row.SESSIONS_JSON,
    ),
    slot_duration_mins: Number(
      row.slot_duration_mins ?? row.SLOT_DURATION_MINS ?? 30,
    ),
    working_days: parseWorkingDays(
      row.working_days ?? row.WORKING_DAYS,
    ),
    is_registered: isRegistered,
    registered_at:
      normalizeIsoTimestamp(row.registered_at ?? row.REGISTERED_AT) || null,
    updated_at:
      normalizeIsoTimestamp(row.updated_at ?? row.updated_on ?? row.UPDATED_ON) ||
      null,
  };
}

export function serializeDoctorShiftForOracle(shift: DoctorShiftConfig) {
  const workingDaysCsv = shift.working_days.join(',');
  return {
    doctor_id: shift.doctor_id,
    doctor_name: shift.doctor_name || `Doctor #${shift.doctor_id}`,
    sessions: shift.sessions,
    sessions_json: JSON.stringify(shift.sessions),
    slot_duration_mins: shift.slot_duration_mins,
    // Keep working_days as CSV string for Oracle APEX_JSON.GET_VARCHAR2 compatibility inside NVL()
    working_days: workingDaysCsv,
    working_days_csv: workingDaysCsv,
    is_registered: shift.is_registered ? 'Y' : 'N',
  };
}

export function parseOracleShiftChangeRequestRow(
  row: Record<string, unknown>,
): ShiftChangeRequest | null {
  const requestId = String(row.request_id ?? row.REQUEST_ID ?? '').trim();
  const doctorId = Number(row.doctor_id ?? row.DOCTOR_ID ?? 0);
  if (!requestId || !doctorId) return null;

  const rawStatus = String(row.status ?? row.STATUS ?? 'PENDING')
    .trim()
    .toUpperCase();
  const status: ShiftChangeRequest['status'] =
    rawStatus === 'APPROVED'
      ? 'APPROVED'
      : rawStatus === 'REJECTED'
        ? 'REJECTED'
        : 'PENDING';

  return {
    request_id: requestId,
    doctor_id: doctorId,
    doctor_name: String(
      row.doctor_name ?? row.DOCTOR_NAME ?? `Doctor #${doctorId}`,
    ).trim(),
    current_sessions: parseSessions(
      row.current_sessions ??
        row.current_sessions_json ??
        row.CURRENT_SESSIONS_JSON,
    ),
    current_slot_duration_mins: Number(
      row.current_slot_duration_mins ?? row.CURRENT_SLOT_DURATION_MINS ?? 30,
    ),
    current_working_days: parseWorkingDays(
      row.current_working_days ?? row.CURRENT_WORKING_DAYS,
    ),
    requested_sessions: parseSessions(
      row.requested_sessions ??
        row.requested_sessions_json ??
        row.REQUESTED_SESSIONS_JSON,
    ),
    requested_slot_duration_mins: Number(
      row.requested_slot_duration_mins ??
        row.REQUESTED_SLOT_DURATION_MINS ??
        30,
    ),
    requested_working_days: parseWorkingDays(
      row.requested_working_days ?? row.REQUESTED_WORKING_DAYS,
    ),
    reason: String(row.reason ?? row.REASON ?? '').trim(),
    status,
    requested_on: normalizeIsoTimestamp(row.requested_on ?? row.REQUESTED_ON),
    decided_on:
      normalizeIsoTimestamp(row.decided_on ?? row.DECIDED_ON) || null,
    decided_by:
      String(row.decided_by ?? row.DECIDED_BY ?? '').trim() || null,
    decision_comments:
      String(
        row.decision_comments ?? row.DECISION_COMMENTS ?? '',
      ).trim() || null,
  };
}

export function serializeShiftChangeRequestForOracle(req: ShiftChangeRequest) {
  const currentDaysCsv = req.current_working_days.join(',');
  const requestedDaysCsv = req.requested_working_days.join(',');
  return {
    request_id: req.request_id,
    doctor_id: req.doctor_id,
    doctor_name: req.doctor_name,
    current_sessions: req.current_sessions,
    current_sessions_json: JSON.stringify(req.current_sessions),
    current_slot_duration_mins: req.current_slot_duration_mins,
    current_working_days: currentDaysCsv,
    current_working_days_csv: currentDaysCsv,
    requested_sessions: req.requested_sessions,
    requested_sessions_json: JSON.stringify(req.requested_sessions),
    requested_slot_duration_mins: req.requested_slot_duration_mins,
    requested_working_days: requestedDaysCsv,
    requested_working_days_csv: requestedDaysCsv,
    reason: req.reason,
    status: req.status,
  };
}

export function mergeByIdWithOraclePriority<T>(
  oracleRows: T[],
  localRows: T[],
  getId: (row: T) => string,
  getSortKey: (row: T) => string,
): T[] {
  const byId = new Map<string, T>();
  for (const row of localRows) {
    byId.set(getId(row), row);
  }
  for (const row of oracleRows) {
    byId.set(getId(row), row);
  }
  return Array.from(byId.values()).sort((a, b) =>
    getSortKey(b).localeCompare(getSortKey(a)),
  );
}

export function mergeShiftMaps(
  oracleShifts: DoctorShiftConfig[],
  localShiftsMap: Record<string, DoctorShiftConfig>,
): Record<string, DoctorShiftConfig> {
  const merged: Record<string, DoctorShiftConfig> = { ...localShiftsMap };
  for (const shift of oracleShifts) {
    merged[String(shift.doctor_id)] = shift;
  }
  return merged;
}
