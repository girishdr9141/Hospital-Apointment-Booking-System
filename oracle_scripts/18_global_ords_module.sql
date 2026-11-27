-- =====================================================================
-- 18_global_ords_module.sql
-- PURPOSE :
--   Create a brand-new, isolated ORDS module 'girish_global_api' at
--   /ords/nov_2026_batch/girish_global_api/v1/ for multi-branch and
--   multi-country Global CarePulse operations.
--   ZERO templates or handlers in 'girish_opd_api' are touched.
-- SAFE    : Idempotent (ORDS.DEFINE_MODULE / TEMPLATE / HANDLER).
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

BEGIN
  ORDS.DEFINE_MODULE(
      p_module_name    => 'girish_global_api',
      p_base_path      => '/girish_global_api/v1/',
      p_items_per_page => 0,
      p_status         => 'PUBLISHED',
      p_comments       => 'Global CarePulse Multi-Branch & Multi-Country Sidecar ORDS API');

  -- 1. Countries
  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'countries');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'countries',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT country_id, country_code, country_name, currency_code, currency_symbol,
       phone_dial_code, default_timezone, fx_rate_to_inr, is_active, created_on
FROM GBR_COUNTRIES
ORDER BY CASE WHEN country_code = ''IN'' THEN 0 ELSE 1 END, country_name ASC');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'countries',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
DECLARE
    v_code VARCHAR2(10);
    v_name VARCHAR2(120);
    v_curr VARCHAR2(10);
    v_sym  VARCHAR2(10);
    v_dial VARCHAR2(15);
    v_tz   VARCHAR2(80);
    v_fx   NUMBER;
    v_id   NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_code := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''country_code'')));
    v_name := TRIM(APEX_JSON.GET_VARCHAR2(''country_name''));
    v_curr := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''currency_code'')));
    v_sym  := NVL(TRIM(APEX_JSON.GET_VARCHAR2(''currency_symbol'')), v_curr);
    v_dial := NVL(TRIM(APEX_JSON.GET_VARCHAR2(''phone_dial_code'')), ''+1'');
    v_tz   := NVL(TRIM(APEX_JSON.GET_VARCHAR2(''default_timezone'')), ''UTC'');
    v_fx   := NVL(APEX_JSON.GET_NUMBER(''fx_rate_to_inr''), 1);

    INSERT INTO GBR_COUNTRIES (country_code, country_name, currency_code, currency_symbol, phone_dial_code, default_timezone, fx_rate_to_inr, is_active)
    VALUES (v_code, v_name, v_curr, v_sym, v_dial, v_tz, v_fx, ''Y'')
    RETURNING country_id INTO v_id;

    COMMIT;
    HTP.P(''{"status":"success","country_id":'' || v_id || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 2. Branches
  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'branches');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'branches',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT b.branch_id, b.country_id, c.country_code, c.country_name, c.currency_symbol, c.fx_rate_to_inr,
       b.branch_code, b.branch_name, b.city, b.address_line, b.postal_code,
       b.phone, b.email, b.timezone_iana, b.currency_code, b.is_headquarters, b.is_active, b.created_on
FROM GBR_BRANCHES b
JOIN GBR_COUNTRIES c ON c.country_id = b.country_id
ORDER BY CASE WHEN b.is_headquarters = ''Y'' THEN 0 ELSE 1 END, c.country_name ASC, b.branch_name ASC');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'branches',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
DECLARE
    v_id NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    INSERT INTO GBR_BRANCHES (
        country_id, branch_code, branch_name, city, address_line, postal_code,
        phone, email, timezone_iana, currency_code, is_headquarters, is_active
    ) VALUES (
        APEX_JSON.GET_NUMBER(''country_id''),
        UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''branch_code''))),
        TRIM(APEX_JSON.GET_VARCHAR2(''branch_name'')),
        TRIM(APEX_JSON.GET_VARCHAR2(''city'')),
        TRIM(APEX_JSON.GET_VARCHAR2(''address_line'')),
        TRIM(APEX_JSON.GET_VARCHAR2(''postal_code'')),
        TRIM(APEX_JSON.GET_VARCHAR2(''phone'')),
        TRIM(APEX_JSON.GET_VARCHAR2(''email'')),
        NVL(TRIM(APEX_JSON.GET_VARCHAR2(''timezone_iana'')), ''UTC''),
        UPPER(NVL(TRIM(APEX_JSON.GET_VARCHAR2(''currency_code'')), ''USD'')),
        ''N'',
        ''Y''
    ) RETURNING branch_id INTO v_id;

    COMMIT;
    HTP.P(''{"status":"success","branch_id":'' || v_id || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 3. Branch Departments & Doctor Branches
  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'branch-departments');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'branch-departments',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT bd.branch_dept_id, bd.branch_id, b.branch_code, b.branch_name,
       bd.department_id, d.department_name, bd.is_specialized,
       bd.local_consultation_fee, b.currency_code, bd.is_active
FROM GBR_BRANCH_DEPARTMENTS bd
JOIN GBR_BRANCHES b ON b.branch_id = bd.branch_id
LEFT JOIN GIRISH_DEPARTMENTS d ON d.department_id = bd.department_id
ORDER BY b.branch_id, d.department_name');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'branch-departments',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
BEGIN
    APEX_JSON.PARSE(:body_text);
    GBR_ASSIGN_BRANCH_DEPT(
        P_BRANCH_ID      => APEX_JSON.GET_NUMBER(''branch_id''),
        P_DEPARTMENT_ID  => APEX_JSON.GET_NUMBER(''department_id''),
        P_IS_SPECIALIZED => NVL(APEX_JSON.GET_VARCHAR2(''is_specialized''), ''Y''),
        P_LOCAL_FEE      => APEX_JSON.GET_NUMBER(''local_consultation_fee''),
        P_IS_ACTIVE      => NVL(APEX_JSON.GET_VARCHAR2(''is_active''), ''Y'')
    );
    COMMIT;
    HTP.P(''{"status":"success"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'doctor-branches');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'doctor-branches',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT db.doc_branch_id, db.doctor_id, d.first_name || '' '' || d.last_name AS doctor_name,
       d.department_id, db.branch_id, b.branch_code, b.branch_name, b.currency_code,
       db.is_primary_branch, db.local_consultation_fee, db.is_active
FROM GBR_DOCTOR_BRANCHES db
JOIN GBR_BRANCHES b ON b.branch_id = db.branch_id
LEFT JOIN GIRISH_DOCTORS d ON d.doctor_id = db.doctor_id
ORDER BY db.branch_id, db.doctor_id');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'doctor-branches',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
BEGIN
    APEX_JSON.PARSE(:body_text);
    GBR_ASSIGN_DOCTOR_BRANCH(
        P_DOCTOR_ID  => APEX_JSON.GET_NUMBER(''doctor_id''),
        P_BRANCH_ID  => APEX_JSON.GET_NUMBER(''branch_id''),
        P_IS_PRIMARY => NVL(APEX_JSON.GET_VARCHAR2(''is_primary_branch''), ''N''),
        P_LOCAL_FEE  => APEX_JSON.GET_NUMBER(''local_consultation_fee''),
        P_IS_ACTIVE  => NVL(APEX_JSON.GET_VARCHAR2(''is_active''), ''Y'')
    );
    COMMIT;
    HTP.P(''{"status":"success"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 4. Global Slots
  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'slots');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'slots',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT slot_id, doctor_id, doctor_name, department_id, department_name,
       slot_date, start_time, end_time, max_patients_per_slot, booked_patients, status,
       branch_id, branch_code, branch_name, branch_timezone, currency_code,
       country_code, country_name, branch_resolution
FROM GBR_V_SLOTS
WHERE (:branch_id IS NULL OR branch_id = TO_NUMBER(:branch_id))
ORDER BY slot_date DESC, start_time ASC');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'slots',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
DECLARE
    v_slot_id NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    GBR_CREATE_BRANCH_SLOT(
        P_DOCTOR_ID   => APEX_JSON.GET_NUMBER(''doctor_id''),
        P_BRANCH_ID   => APEX_JSON.GET_NUMBER(''branch_id''),
        P_SLOT_DATE   => TO_DATE(SUBSTR(TRIM(APEX_JSON.GET_VARCHAR2(''slot_date'')), 1, 10), ''YYYY-MM-DD''),
        P_START_TIME  => APEX_JSON.GET_VARCHAR2(''start_time''),
        P_END_TIME    => APEX_JSON.GET_VARCHAR2(''end_time''),
        P_MAX_PATIENT => NVL(APEX_JSON.GET_NUMBER(''max_patients_per_slot''), 1),
        P_SLOT_ID     => v_slot_id
    );
    COMMIT;
    HTP.P(''{"status":"success","slot_id":'' || v_slot_id || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 5. Global Appointments
  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'appointments');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'appointments',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT appointment_id, appointment_ref, patient_id, patient_name, slot_id,
       doctor_id, doctor_name, department_id, department_name,
       slot_date, start_time, end_time, status, booking_source, consultation_mode,
       hold_expires_at, created_on, branch_id, branch_code, branch_name,
       branch_timezone, currency_code, country_code, country_name,
       paid_local_currency, paid_local_amount, branch_resolution
FROM GBR_V_APPOINTMENTS
WHERE (:branch_id IS NULL OR branch_id = TO_NUMBER(:branch_id))
ORDER BY created_on DESC, appointment_id DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'appointments',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
DECLARE
    v_ref VARCHAR2(40);
    v_id  NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    GBR_BOOK_APPOINTMENT(
        P_PATIENT_ID        => APEX_JSON.GET_NUMBER(''patient_id''),
        P_SLOT_ID           => APEX_JSON.GET_NUMBER(''slot_id''),
        P_BRANCH_ID         => APEX_JSON.GET_NUMBER(''branch_id''),
        P_BOOKING_SOURCE    => NVL(APEX_JSON.GET_VARCHAR2(''booking_source''), ''ONLINE''),
        P_CONSULTATION_MODE => NVL(APEX_JSON.GET_VARCHAR2(''consultation_mode''), ''FACE_TO_FACE''),
        P_APPOINTMENT_REF   => v_ref,
        P_APPOINTMENT_ID    => v_id
    );
    COMMIT;
    HTP.P(''{"status":"success","appointment_id":'' || v_id || '',"appointment_ref":"'' || v_ref || ''"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 6. Global Payments & Patient Profiles & Utilisation
  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'payments');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'payments',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT payment_id, appointment_id, appointment_ref, payment_ref,
       base_inr_amount, payment_method, status, created_on,
       branch_id, branch_code, branch_name, country_code,
       local_currency, local_amount, fx_rate_to_inr
FROM GBR_V_PAYMENTS
WHERE (:branch_id IS NULL OR branch_id = TO_NUMBER(:branch_id))
ORDER BY created_on DESC, payment_id DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'payments',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
DECLARE
    v_pay_id  NUMBER;
    v_pay_ref VARCHAR2(40);
BEGIN
    APEX_JSON.PARSE(:body_text);
    GBR_RECORD_BRANCH_PAYMENT(
        P_APPOINTMENT_ID  => APEX_JSON.GET_NUMBER(''appointment_id''),
        P_BRANCH_ID       => APEX_JSON.GET_NUMBER(''branch_id''),
        P_PAYMENT_METHOD  => NVL(APEX_JSON.GET_VARCHAR2(''payment_method''), ''UPI''),
        P_LOCAL_CURRENCY  => NVL(APEX_JSON.GET_VARCHAR2(''local_currency''), ''INR''),
        P_LOCAL_AMOUNT    => APEX_JSON.GET_NUMBER(''local_amount''),
        P_BASE_INR_AMOUNT => APEX_JSON.GET_NUMBER(''base_inr_amount''),
        P_FX_RATE_TO_INR  => NVL(APEX_JSON.GET_NUMBER(''fx_rate_to_inr''), 1),
        P_PAYMENT_ID      => v_pay_id,
        P_PAYMENT_REF     => v_pay_ref
    );
    COMMIT;
    HTP.P(''{"status":"success","payment_id":'' || v_pay_id || '',"payment_ref":"'' || v_pay_ref || ''"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'patient-profiles');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'patient-profiles',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT pp.patient_profile_id, pp.patient_id, pp.country_id, c.country_code, c.country_name,
       pp.home_branch_id, b.branch_code, b.branch_name, pp.city, pp.address_line,
       pp.postal_code, pp.preferred_currency, pp.updated_on
FROM GBR_PATIENT_PROFILE pp
LEFT JOIN GBR_COUNTRIES c ON c.country_id = pp.country_id
LEFT JOIN GBR_BRANCHES b ON b.branch_id = pp.home_branch_id
ORDER BY pp.patient_id');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'patient-profiles',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => '
BEGIN
    APEX_JSON.PARSE(:body_text);
    GBR_UPSERT_PATIENT_PROFILE(
        P_PATIENT_ID         => APEX_JSON.GET_NUMBER(''patient_id''),
        P_COUNTRY_ID         => APEX_JSON.GET_NUMBER(''country_id''),
        P_HOME_BRANCH_ID     => APEX_JSON.GET_NUMBER(''home_branch_id''),
        P_CITY               => APEX_JSON.GET_VARCHAR2(''city''),
        P_ADDRESS_LINE       => APEX_JSON.GET_VARCHAR2(''address_line''),
        P_POSTAL_CODE        => APEX_JSON.GET_VARCHAR2(''postal_code''),
        P_PREFERRED_CURRENCY => APEX_JSON.GET_VARCHAR2(''preferred_currency'')
    );
    COMMIT;
    HTP.P(''{"status":"success"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(p_module_name => 'girish_global_api', p_pattern => 'reports/branch-utilisation');
  ORDS.DEFINE_HANDLER(
      p_module_name => 'girish_global_api',
      p_pattern     => 'reports/branch-utilisation',
      p_method      => 'GET',
      p_source_type => 'json/collection',
      p_source      => '
SELECT branch_id, branch_code, branch_name, city, timezone_iana, currency_code,
       country_code, country_name, total_slots, booked_slots,
       total_appointments, confirmed_appointments, completed_appointments,
       total_local_revenue, total_inr_revenue
FROM GBR_V_BRANCH_UTILISATION
ORDER BY branch_id');

  COMMIT;
END;
/
