-- =====================================================================
-- 07_single_admin_and_doctor_slots.sql
-- PURPOSE :
--   1) Enforce SINGLE ADMIN ONLY:
--        Name  : Girish DR
--        Email : girishramachandra12dr@gmail.com
--      Deactivate any other ADMIN role assignments and block creating
--      additional ADMIN accounts via POST /users.
--   2) Sync personal Name + Email login accounts for Doctors, Patients,
--      and Receptionists (including fixing doctor_id linkage for Dr. Anil Mehta)
--      and validate full_name on POST auth/login.
--   3) Remove previously bulk-generated unbooked future slots (keeping
--      every slot linked to an appointment), cap bulk generation to <= 7 days,
--      and add POST slots/doctor-generate for doctor-confirmed daily / 1-week slots.
-- SAFE    : Idempotent. Calls ORDS.DEFINE_HANDLER on existing patterns and
--           adds only the new slots/doctor-generate template.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: Enforce Single Admin (Girish DR) & Sync Personal User Accounts
-- ---------------------------------------------------------------------
DECLARE
    v_admin_role_id     NUMBER;
    v_doctor_role_id    NUMBER;
    v_patient_role_id   NUMBER;
    v_recept_role_id    NUMBER;
    v_admin_user_id     NUMBER;

    FUNCTION make_hash(p_raw_pw IN VARCHAR2) RETURN VARCHAR2 IS
        v_salt VARCHAR2(32) := SUBSTR(RAWTOHEX(SYS_GUID()), 1, 16);
        v_out  VARCHAR2(500);
    BEGIN
        SELECT 'SHA256$' || v_salt || '$' || RAWTOHEX(STANDARD_HASH(v_salt || ':' || p_raw_pw, 'SHA256'))
        INTO v_out
        FROM dual;
        RETURN v_out;
    END make_hash;

    PROCEDURE upsert_person_user(
        p_match_username IN VARCHAR2,
        p_username       IN VARCHAR2,
        p_email          IN VARCHAR2,
        p_raw_pw         IN VARCHAR2,
        p_full_name      IN VARCHAR2,
        p_doctor_id      IN NUMBER,
        p_patient_id     IN NUMBER,
        p_role_id        IN NUMBER
    ) IS
        v_uid  NUMBER;
        v_hash VARCHAR2(500) := make_hash(p_raw_pw);
    BEGIN
        BEGIN
            SELECT user_id
            INTO v_uid
            FROM GIRISH_USERS
            WHERE LOWER(email) = LOWER(p_email)
               OR LOWER(username) = LOWER(p_username)
               OR (p_match_username IS NOT NULL AND LOWER(username) = LOWER(p_match_username))
            ORDER BY user_id
            FETCH FIRST 1 ROWS ONLY;

            UPDATE GIRISH_USERS
            SET username      = LOWER(p_username),
                email         = LOWER(p_email),
                password_hash = v_hash,
                full_name     = p_full_name,
                doctor_id     = p_doctor_id,
                patient_id    = p_patient_id,
                is_active     = 'Y',
                updated_on    = CURRENT_TIMESTAMP
            WHERE user_id = v_uid;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                INSERT INTO GIRISH_USERS (
                    username, email, password_hash, full_name, doctor_id, patient_id, is_active
                ) VALUES (
                    LOWER(p_username), LOWER(p_email), v_hash, p_full_name, p_doctor_id, p_patient_id, 'Y'
                )
                RETURNING user_id INTO v_uid;
        END;

        IF p_role_id IS NOT NULL THEN
            MERGE INTO GIRISH_USER_ROLES ur
            USING (SELECT v_uid AS user_id, p_role_id AS role_id FROM dual) src
            ON (ur.user_id = src.user_id AND ur.role_id = src.role_id)
            WHEN MATCHED THEN
                UPDATE SET ur.is_active = 'Y'
            WHEN NOT MATCHED THEN
                INSERT (user_id, role_id, assigned_by, is_active)
                VALUES (src.user_id, src.role_id, src.user_id, 'Y');
        END IF;
    END upsert_person_user;
BEGIN
    SELECT MAX(CASE WHEN role_name = 'ADMIN' THEN role_id END),
           MAX(CASE WHEN role_name = 'DOCTOR' THEN role_id END),
           MAX(CASE WHEN role_name = 'PATIENT' THEN role_id END),
           MAX(CASE WHEN role_name = 'RECEPTIONIST' THEN role_id END)
    INTO v_admin_role_id, v_doctor_role_id, v_patient_role_id, v_recept_role_id
    FROM GIRISH_ROLES
    WHERE is_active = 'Y';

    -- 1) Update primary ADMIN (user_id = 1 or existing admin) to Girish DR
    upsert_person_user(
        p_match_username => 'admin',
        p_username       => 'girish.dr',
        p_email          => 'girishramachandra12dr@gmail.com',
        p_raw_pw         => 'Admin@123',
        p_full_name      => 'Girish DR',
        p_doctor_id      => NULL,
        p_patient_id     => NULL,
        p_role_id        => v_admin_role_id
    );

    SELECT user_id INTO v_admin_user_id
    FROM GIRISH_USERS
    WHERE LOWER(email) = 'girishramachandra12dr@gmail.com'
    FETCH FIRST 1 ROWS ONLY;

    -- Deactivate any other ADMIN role assignments to strictly enforce single admin
    UPDATE GIRISH_USER_ROLES
    SET is_active = 'N'
    WHERE role_id = v_admin_role_id
      AND user_id <> v_admin_user_id;

    UPDATE GIRISH_USERS u
    SET u.is_active = 'N',
        u.updated_on = CURRENT_TIMESTAMP
    WHERE u.user_id <> v_admin_user_id
      AND EXISTS (
          SELECT 1 FROM GIRISH_USER_ROLES ur
          WHERE ur.user_id = u.user_id AND ur.role_id = v_admin_role_id
      )
      AND NOT EXISTS (
          SELECT 1 FROM GIRISH_USER_ROLES ur2
          WHERE ur2.user_id = u.user_id AND ur2.role_id <> v_admin_role_id AND ur2.is_active = 'Y'
      );

    -- 2) Sync personal Name + Email accounts for all active Doctors
    FOR d IN (
        SELECT doctor_id, first_name, last_name
        FROM GIRISH_DOCTORS
        WHERE is_active = 'Y'
        ORDER BY doctor_id
    ) LOOP
        DECLARE
            v_doc_email    VARCHAR2(150);
            v_doc_username VARCHAR2(100);
            v_doc_name     VARCHAR2(150) := 'Dr. ' || TRIM(d.first_name) || ' ' || TRIM(d.last_name);
            v_legacy_uname VARCHAR2(100) := NULL;
        BEGIN
            IF d.doctor_id = 2 THEN
                v_doc_email := 'priya@hospital.com';
                v_doc_username := 'priya.sharma';
            ELSIF d.doctor_id = 3 THEN
                v_doc_email := 'anil.mehta@hospital.com';
                v_doc_username := 'anil.mehta';
                v_legacy_uname := 'doctor';
            ELSE
                v_doc_username := LOWER(REGEXP_REPLACE(TRIM(d.first_name) || '.' || TRIM(d.last_name), '[^a-zA-Z0-9]+', '.')) || '.' || d.doctor_id;
                v_doc_email := LOWER(REGEXP_REPLACE(TRIM(d.first_name) || '.' || TRIM(d.last_name), '[^a-zA-Z0-9]+', '.')) ||
                               CASE WHEN d.doctor_id IN (44, 45) THEN '.' || d.doctor_id ELSE '' END ||
                               '@hospital.com';
            END IF;

            upsert_person_user(
                p_match_username => v_legacy_uname,
                p_username       => v_doc_username,
                p_email          => v_doc_email,
                p_raw_pw         => 'Doctor@123',
                p_full_name      => v_doc_name,
                p_doctor_id      => d.doctor_id,
                p_patient_id     => NULL,
                p_role_id        => v_doctor_role_id
            );
        END;
    END LOOP;

    -- 3) Sync personal Name + Email accounts for existing Patients
    FOR p IN (
        SELECT patient_id, first_name, last_name, email
        FROM GIRISH_PATIENTS
        ORDER BY patient_id
    ) LOOP
        DECLARE
            v_pat_email    VARCHAR2(150) := LOWER(TRIM(NVL(p.email, 'patient.' || p.patient_id || '@example.com')));
            v_pat_name     VARCHAR2(150) := TRIM(p.first_name) || ' ' || TRIM(p.last_name);
            v_legacy_uname VARCHAR2(100) := CASE WHEN p.patient_id = 1 THEN 'patient' ELSE NULL END;
        BEGIN
            upsert_person_user(
                p_match_username => v_legacy_uname,
                p_username       => v_pat_email,
                p_email          => v_pat_email,
                p_raw_pw         => 'Patient@123',
                p_full_name      => v_pat_name,
                p_doctor_id      => NULL,
                p_patient_id     => p.patient_id,
                p_role_id        => v_patient_role_id
            );
        END;
    END LOOP;

    -- 4) Sync Receptionist personal Name + Email account (Meera Kulkarni)
    upsert_person_user(
        p_match_username => 'receptionist',
        p_username       => 'meera.kulkarni',
        p_email          => 'meera.kulkarni@hospital.com',
        p_raw_pw         => 'Reception@123',
        p_full_name      => 'Meera Kulkarni',
        p_doctor_id      => NULL,
        p_patient_id     => NULL,
        p_role_id        => v_recept_role_id
    );

    -- Clean up previously bulk-generated unbooked future slots so doctors confirm/generate daily or 1-week slots
    DELETE FROM GIRISH_SLOTS s
    WHERE s.slot_date >= TRUNC(SYSDATE)
      AND NVL(s.booked_patients, 0) = 0
      AND NOT EXISTS (
          SELECT 1 FROM GIRISH_APPOINTMENTS a WHERE a.slot_id = s.slot_id
      );

    COMMIT;
END;
/

-- ---------------------------------------------------------------------
-- PART 2: Update ORDS Handlers (auth/login, users POST, slots/generate,
--         and new slots/doctor-generate)
-- ---------------------------------------------------------------------
BEGIN
  -- 1. POST auth/login: verify personal full_name + email + password and single admin
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'auth/login',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Verify personal name + email + password and enforce single admin Girish DR',
      p_source         => '
DECLARE
    v_identifier     VARCHAR2(200);
    v_entered_name   VARCHAR2(200);
    v_password       VARCHAR2(200);
    v_user_id        GIRISH_USERS.USER_ID%TYPE;
    v_username       GIRISH_USERS.USERNAME%TYPE;
    v_email          GIRISH_USERS.EMAIL%TYPE;
    v_stored_hash    GIRISH_USERS.PASSWORD_HASH%TYPE;
    v_full_name      GIRISH_USERS.FULL_NAME%TYPE;
    v_phone          GIRISH_USERS.PHONE_NUMBER%TYPE;
    v_doctor_id      GIRISH_USERS.DOCTOR_ID%TYPE;
    v_patient_id     GIRISH_USERS.PATIENT_ID%TYPE;
    v_is_active      GIRISH_USERS.IS_ACTIVE%TYPE;
    v_role_name      VARCHAR2(50);
    v_dept_id        NUMBER;
    v_dept_name      VARCHAR2(100);
    v_specialization VARCHAR2(200);
    v_salt           VARCHAR2(100);
    v_expected_hex   VARCHAR2(200);
    v_computed_hex   VARCHAR2(200);
    v_valid          BOOLEAN := FALSE;
    v_roles_json     VARCHAR2(4000) := '''';
    v_perms_json     VARCHAR2(32767) := '''';

    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN
            RETURN ''null'';
        END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), '' '') || ''"'';
    END jstr;

    FUNCTION jnum(p_val IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN
            RETURN ''null'';
        END IF;
        RETURN TO_CHAR(p_val);
    END jnum;

    FUNCTION norm_name(p_val IN VARCHAR2, p_strip_dr IN BOOLEAN) RETURN VARCHAR2 IS
        v_clean VARCHAR2(300);
    BEGIN
        v_clean := LOWER(TRIM(REGEXP_REPLACE(NVL(p_val, ''''), ''\s+'', '' '')));
        IF p_strip_dr THEN
            v_clean := TRIM(REGEXP_REPLACE(v_clean, ''^dr\.?\s+'', '''', 1, 1, ''i''));
        END IF;
        RETURN v_clean;
    END norm_name;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_identifier   := LOWER(TRIM(NVL(APEX_JSON.GET_VARCHAR2(''email''), APEX_JSON.GET_VARCHAR2(''identifier''))));
    v_entered_name := TRIM(APEX_JSON.GET_VARCHAR2(''full_name''));
    v_password     := APEX_JSON.GET_VARCHAR2(''password'');

    IF v_identifier IS NULL OR v_password IS NULL THEN
        HTP.P(''{"status":"error","message":"Name, email ID, and password are required"}'');
        RETURN;
    END IF;

    BEGIN
        SELECT user_id, username, email, password_hash, full_name, phone_number,
               doctor_id, patient_id, is_active
        INTO v_user_id, v_username, v_email, v_stored_hash, v_full_name, v_phone,
             v_doctor_id, v_patient_id, v_is_active
        FROM GIRISH_USERS
        WHERE LOWER(email) = v_identifier
           OR LOWER(username) = v_identifier
        FETCH FIRST 1 ROWS ONLY;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            HTP.P(''{"status":"error","message":"No account found for that email ID"}'');
            RETURN;
    END;

    IF v_is_active <> ''Y'' THEN
        HTP.P(''{"status":"error","message":"User account is inactive"}'');
        RETURN;
    END IF;

    IF v_stored_hash LIKE ''SHA256$%$%'' THEN
        v_salt         := REGEXP_SUBSTR(v_stored_hash, ''^SHA256\$([^$]+)\$'', 1, 1, NULL, 1);
        v_expected_hex := UPPER(REGEXP_SUBSTR(v_stored_hash, ''\$([^$]+)$'', 1, 1, NULL, 1));
        SELECT UPPER(RAWTOHEX(STANDARD_HASH(v_salt || '':'' || v_password, ''SHA256'')))
        INTO v_computed_hex
        FROM dual;
        v_valid := (v_computed_hex = v_expected_hex);
    ELSE
        SELECT UPPER(RAWTOHEX(STANDARD_HASH(v_password, ''SHA256'')))
        INTO v_computed_hex
        FROM dual;
        v_valid := (UPPER(v_stored_hash) = v_computed_hex OR v_stored_hash = v_password);
    END IF;

    IF NOT v_valid THEN
        HTP.P(''{"status":"error","message":"Invalid email ID or password"}'');
        RETURN;
    END IF;

    SELECT r.role_name
    INTO v_role_name
    FROM GIRISH_USER_ROLES ur
    JOIN GIRISH_ROLES r ON r.role_id = ur.role_id AND r.is_active = ''Y''
    WHERE ur.user_id = v_user_id
      AND ur.is_active = ''Y''
    ORDER BY ur.user_role_id
    FETCH FIRST 1 ROWS ONLY;

    IF v_role_name = ''ADMIN'' AND LOWER(v_email) <> ''girishramachandra12dr@gmail.com'' THEN
        HTP.P(''{"status":"error","message":"Only Girish DR (girishramachandra12dr@gmail.com) is authorized as Administrator"}'');
        RETURN;
    END IF;

    IF v_entered_name IS NOT NULL THEN
        IF NOT (
            norm_name(v_entered_name, FALSE) = norm_name(v_full_name, FALSE)
            OR (v_role_name = ''DOCTOR'' AND norm_name(v_entered_name, TRUE) = norm_name(v_full_name, TRUE))
        ) THEN
            HTP.P(''{"status":"error","message":"Entered name does not match the registered user for this email ID"}'');
            RETURN;
        END IF;
    END IF;

    IF v_doctor_id IS NOT NULL THEN
        BEGIN
            SELECT d.department_id, dept.department_name, d.specialization
            INTO v_dept_id, v_dept_name, v_specialization
            FROM GIRISH_DOCTORS d
            LEFT JOIN GIRISH_DEPARTMENTS dept ON dept.department_id = d.department_id
            WHERE d.doctor_id = v_doctor_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN NULL;
        END;
    END IF;

    FOR rr IN (
        SELECT r.role_name
        FROM GIRISH_USER_ROLES ur
        JOIN GIRISH_ROLES r ON r.role_id = ur.role_id AND r.is_active = ''Y''
        WHERE ur.user_id = v_user_id AND ur.is_active = ''Y''
        ORDER BY ur.user_role_id
    ) LOOP
        v_roles_json := v_roles_json || CASE WHEN v_roles_json IS NOT NULL THEN '','' ELSE '''' END || jstr(rr.role_name);
    END LOOP;

    FOR pr IN (
        SELECT DISTINCT p.permission_name
        FROM GIRISH_USER_ROLES ur
        JOIN GIRISH_ROLES r ON r.role_id = ur.role_id AND r.is_active = ''Y''
        JOIN GIRISH_ROLE_PERMISSIONS rp ON rp.role_id = r.role_id
        JOIN GIRISH_PERMISSIONS p ON p.permission_id = rp.permission_id AND p.is_active = ''Y''
        WHERE ur.user_id = v_user_id AND ur.is_active = ''Y''
        ORDER BY p.permission_name
    ) LOOP
        v_perms_json := v_perms_json || CASE WHEN v_perms_json IS NOT NULL THEN '','' ELSE '''' END || jstr(pr.permission_name);
    END LOOP;

    INSERT INTO GIRISH_AUDIT_LOGS (user_id, action_name, table_name, record_id, action_description)
    VALUES (v_user_id, ''LOGIN'', ''GIRISH_USERS'', TO_CHAR(v_user_id), ''Signed in via CarePulse OPD portal'');
    COMMIT;

    HTP.P(
        ''{"status":"success","user":{'' ||
        ''"user_id":'' || jnum(v_user_id) || '','' ||
        ''"username":'' || jstr(v_username) || '','' ||
        ''"email":'' || jstr(v_email) || '','' ||
        ''"full_name":'' || jstr(v_full_name) || '','' ||
        ''"phone_number":'' || jstr(v_phone) || '','' ||
        ''"role":'' || jstr(v_role_name) || '','' ||
        ''"roles":['' || NVL(v_roles_json, '''') || ''],'' ||
        ''"permissions":['' || NVL(v_perms_json, '''') || ''],'' ||
        ''"doctor_id":'' || jnum(v_doctor_id) || '','' ||
        ''"patient_id":'' || jnum(v_patient_id) || '','' ||
        ''"department_id":'' || jnum(v_dept_id) || '','' ||
        ''"department_name":'' || jstr(v_dept_name) || '','' ||
        ''"specialization":'' || jstr(v_specialization) ||
        ''}}''
    );

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  -- 2. POST users: forbid creating additional ADMIN accounts
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'users',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Create non-admin user accounts (Single Admin policy enforced)',
      p_source         => '
DECLARE
    v_username  VARCHAR2(100);
    v_email     VARCHAR2(150);
    v_full_name VARCHAR2(150);
    v_phone     VARCHAR2(15);
    v_password  VARCHAR2(200);
    v_role_name VARCHAR2(50);
    v_doctor_id NUMBER;
    v_role_id   NUMBER;
    v_user_id   NUMBER;
    v_salt      VARCHAR2(32) := SUBSTR(RAWTOHEX(SYS_GUID()), 1, 16);
    v_hash      VARCHAR2(500);
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_username  := LOWER(TRIM(APEX_JSON.GET_VARCHAR2(''username'')));
    v_email     := LOWER(TRIM(APEX_JSON.GET_VARCHAR2(''email'')));
    v_full_name := TRIM(APEX_JSON.GET_VARCHAR2(''full_name''));
    v_phone     := NULLIF(TRIM(APEX_JSON.GET_VARCHAR2(''phone_number'')), '''');
    v_password  := APEX_JSON.GET_VARCHAR2(''password'');
    v_role_name := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''role_name'')));
    v_doctor_id := APEX_JSON.GET_NUMBER(''doctor_id'');

    IF v_role_name = ''ADMIN'' THEN
        HTP.P(''{"status":"error","message":"Only one system administrator (Girish DR) is allowed"}'');
        RETURN;
    END IF;

    SELECT role_id INTO v_role_id
    FROM GIRISH_ROLES
    WHERE role_name = v_role_name AND is_active = ''Y'';

    SELECT ''SHA256$'' || v_salt || ''$'' || RAWTOHEX(STANDARD_HASH(v_salt || '':'' || v_password, ''SHA256''))
    INTO v_hash
    FROM dual;

    INSERT INTO GIRISH_USERS (
        username, email, password_hash, full_name, phone_number, doctor_id, is_active
    ) VALUES (
        v_username, v_email, v_hash, v_full_name, v_phone,
        CASE WHEN v_role_name = ''DOCTOR'' THEN v_doctor_id ELSE NULL END,
        ''Y''
    )
    RETURNING user_id INTO v_user_id;

    INSERT INTO GIRISH_USER_ROLES (user_id, role_id, assigned_by, is_active)
    VALUES (v_user_id, v_role_id, v_user_id, ''Y'');

    COMMIT;
    HTP.P(''{"status":"success","message":"User created","user_id":'' || v_user_id || ''}'' );
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"Username or email already exists"}'');
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 3. Restrict POST slots/generate to <= 7 days (prevent full-month bulk generation)
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slots/generate',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Generate slots up to 7 days only (never whole month for all doctors)',
      p_source         => '
DECLARE
    v_days NUMBER := 1;
BEGIN
    IF :body_text IS NOT NULL THEN
        APEX_JSON.PARSE(:body_text);
        v_days := NVL(APEX_JSON.GET_NUMBER(''days''), 1);
    END IF;
    IF v_days < 1 OR v_days > 7 THEN
        HTP.P(''{"status":"error","message":"Bulk generation is capped at 1 to 7 days. Doctors generate daily or 1-week slots on login."}'');
        RETURN;
    END IF;
    GIRISH_GENERATE_SLOTS(P_DAYS => v_days);
    COMMIT;
    HTP.P(''{"status":"success","message":"Slots generated for '' || v_days || '' day(s)"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 4. Add POST slots/doctor-generate for single-doctor daily / 1-week working-hours generation
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'slots/doctor-generate',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Per-doctor working-hours slot generation (1 day or 1 week max)');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slots/doctor-generate',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_doctor_id     NUMBER;
    v_start_date    DATE;
    v_days          NUMBER;
    v_duration_mins NUMBER;
    v_work_start    VARCHAR2(5);
    v_work_end      VARCHAR2(5);
    v_cur_date      DATE;
    v_weekday       VARCHAR2(20);
    v_tmpl_id       NUMBER;
    v_on_leave      NUMBER := 0;
    v_created       NUMBER := 0;
    v_cur_min       NUMBER;
    v_end_min       NUMBER;
    v_s_time        VARCHAR2(5);
    v_e_time        VARCHAR2(5);
    v_exists        NUMBER;

    FUNCTION to_mins(p_hhmm IN VARCHAR2) RETURN NUMBER IS
    BEGIN
        RETURN TO_NUMBER(SUBSTR(p_hhmm, 1, 2)) * 60 + TO_NUMBER(SUBSTR(p_hhmm, 4, 2));
    END to_mins;

    FUNCTION to_hhmm(p_mins IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN LPAD(TRUNC(p_mins / 60), 2, ''0'') || '':'' || LPAD(MOD(p_mins, 60), 2, ''0'');
    END to_hhmm;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_doctor_id     := APEX_JSON.GET_NUMBER(''doctor_id'');
    v_start_date    := NVL(TO_DATE(APEX_JSON.GET_VARCHAR2(''start_date''), ''YYYY-MM-DD''), TRUNC(SYSDATE));
    v_days          := NVL(APEX_JSON.GET_NUMBER(''days''), 1);
    v_duration_mins := NVL(APEX_JSON.GET_NUMBER(''duration_mins''), 30);
    v_work_start    := NVL(TRIM(APEX_JSON.GET_VARCHAR2(''work_start'')), ''09:00'');
    v_work_end      := NVL(TRIM(APEX_JSON.GET_VARCHAR2(''work_end'')), ''17:00'');

    IF v_doctor_id IS NULL THEN
        HTP.P(''{"status":"error","message":"doctor_id is required"}'');
        RETURN;
    END IF;
    IF v_days < 1 OR v_days > 7 THEN
        HTP.P(''{"status":"error","message":"Doctors can generate slots for 1 day up to 1 week (7 days) at a time"}'');
        RETURN;
    END IF;
    IF v_duration_mins < 10 OR v_duration_mins > 120 THEN
        v_duration_mins := 30;
    END IF;

    FOR d_off IN 0 .. (v_days - 1) LOOP
        v_cur_date := TRUNC(v_start_date) + d_off;
        v_weekday  := TRIM(TO_CHAR(v_cur_date, ''DAY'', ''NLS_DATE_LANGUAGE=ENGLISH''));

        SELECT COUNT(*) INTO v_on_leave
        FROM GIRISH_DOCTOR_LEAVES
        WHERE doctor_id = v_doctor_id
          AND leave_status = ''APPROVED''
          AND v_cur_date BETWEEN TRUNC(start_date) AND TRUNC(end_date);

        IF v_on_leave = 0 THEN
            -- Check if doctor already has templates for this weekday
            DECLARE
                v_has_day_tmpl NUMBER := 0;
            BEGIN
                SELECT COUNT(*) INTO v_has_day_tmpl
                FROM GIRISH_SLOT_TEMPLATES
                WHERE doctor_id = v_doctor_id
                  AND UPPER(day_of_week) = v_weekday
                  AND is_active = ''Y'';

                IF v_has_day_tmpl > 0 THEN
                    FOR t IN (
                        SELECT template_id, start_time, end_time, NVL(slot_duration_mins, v_duration_mins) AS dur
                        FROM GIRISH_SLOT_TEMPLATES
                        WHERE doctor_id = v_doctor_id
                          AND UPPER(day_of_week) = v_weekday
                          AND is_active = ''Y''
                    ) LOOP
                        v_cur_min := to_mins(t.start_time);
                        v_end_min := to_mins(t.end_time);
                        WHILE v_cur_min + t.dur <= v_end_min LOOP
                            v_s_time := to_hhmm(v_cur_min);
                            v_e_time := to_hhmm(v_cur_min + t.dur);
                            SELECT COUNT(*) INTO v_exists
                            FROM GIRISH_SLOTS
                            WHERE template_id = t.template_id
                              AND TRUNC(slot_date) = v_cur_date
                              AND start_time = v_s_time
                              AND status <> ''CANCELLED'';
                            IF v_exists = 0 THEN
                                INSERT INTO GIRISH_SLOTS (
                                    template_id, slot_date, start_time, end_time,
                                    max_patients_per_slot, booked_patients, status
                                ) VALUES (
                                    t.template_id, v_cur_date, v_s_time, v_e_time, 1, 0, ''AVAILABLE''
                                );
                                v_created := v_created + 1;
                            END IF;
                            v_cur_min := v_cur_min + t.dur;
                        END LOOP;
                    END LOOP;
                ELSE
                    INSERT INTO GIRISH_SLOT_TEMPLATES (
                        doctor_id, day_of_week, start_time, end_time,
                        slot_duration_mins, max_patients_per_slot, is_active
                    ) VALUES (
                        v_doctor_id, v_weekday, v_work_start, v_work_end,
                        v_duration_mins, 1, ''Y''
                    )
                    RETURNING template_id INTO v_tmpl_id;

                    v_cur_min := to_mins(v_work_start);
                    v_end_min := to_mins(v_work_end);
                    WHILE v_cur_min + v_duration_mins <= v_end_min LOOP
                        v_s_time := to_hhmm(v_cur_min);
                        v_e_time := to_hhmm(v_cur_min + v_duration_mins);
                        INSERT INTO GIRISH_SLOTS (
                            template_id, slot_date, start_time, end_time,
                            max_patients_per_slot, booked_patients, status
                        ) VALUES (
                            v_tmpl_id, v_cur_date, v_s_time, v_e_time, 1, 0, ''AVAILABLE''
                        );
                        v_created := v_created + 1;
                        v_cur_min := v_cur_min + v_duration_mins;
                    END LOOP;
                END IF;
            END;
        END IF;
    END LOOP;

    COMMIT;
    HTP.P(''{"status":"success","message":"Generated '' || v_created || '' working-hour slot(s)","created_count":'' || v_created || ''}'' );
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  COMMIT;
END;
/

-- Verification query
SELECT u.user_id, u.username, u.email, u.full_name, u.doctor_id, u.patient_id, r.role_name, u.is_active
FROM GIRISH_USERS u
LEFT JOIN GIRISH_USER_ROLES ur ON ur.user_id = u.user_id AND ur.is_active = 'Y'
LEFT JOIN GIRISH_ROLES r ON r.role_id = ur.role_id
ORDER BY r.role_name, u.user_id;
