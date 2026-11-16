-- =====================================================================
-- 03_auth_and_missing_ords.sql
-- PURPOSE : 1) Seed/sync the 4 evaluation login accounts in GIRISH_USERS
--              and GIRISH_USER_ROLES (ADMIN, DOCTOR, PATIENT, RECEPTIONIST).
--           2) Add missing ORDS REST endpoints in module girish_opd_api
--              wrapping existing PL/SQL procedures and remaining tables.
-- SAFE    : Purely additive / idempotent. Does NOT alter existing tables,
--           constraints, or PL/SQL procedures, and does NOT overwrite
--           existing ORDS handlers.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: Ensure 4 Role-Based Accounts Exist in GIRISH_USERS
--         Uses Oracle-native salted SHA-256 via STANDARD_HASH.
--         Default evaluation passwords:
--           admin@carepulse.local      / Admin@123
--           doctor@carepulse.local     / Doctor@123
--           patient@carepulse.local    / Patient@123
--           reception@carepulse.local  / Reception@123
-- ---------------------------------------------------------------------
DECLARE
    v_admin_role_id        NUMBER;
    v_doctor_role_id       NUMBER;
    v_patient_role_id      NUMBER;
    v_reception_role_id    NUMBER;
    v_first_doctor_id      NUMBER;
    v_first_patient_id     NUMBER;
    v_user_id              NUMBER;

    PROCEDURE upsert_eval_user(
        p_username    IN VARCHAR2,
        p_email       IN VARCHAR2,
        p_raw_pw      IN VARCHAR2,
        p_full_name   IN VARCHAR2,
        p_doctor_id   IN NUMBER,
        p_patient_id  IN NUMBER,
        p_role_id     IN NUMBER
    ) IS
        v_salt VARCHAR2(32) := SUBSTR(RAWTOHEX(SYS_GUID()), 1, 16);
        v_hash VARCHAR2(500);
        v_uid  NUMBER;
    BEGIN
        SELECT 'SHA256$' || v_salt || '$' || RAWTOHEX(STANDARD_HASH(v_salt || ':' || p_raw_pw, 'SHA256'))
        INTO v_hash
        FROM dual;

        BEGIN
            SELECT user_id
            INTO v_uid
            FROM GIRISH_USERS
            WHERE LOWER(username) = LOWER(p_username)
               OR LOWER(email) = LOWER(p_email)
            FETCH FIRST 1 ROWS ONLY;

            UPDATE GIRISH_USERS
            SET password_hash = v_hash,
                full_name     = p_full_name,
                doctor_id     = COALESCE(doctor_id, p_doctor_id),
                patient_id    = COALESCE(patient_id, p_patient_id),
                is_active     = 'Y',
                updated_on    = CURRENT_TIMESTAMP
            WHERE user_id = v_uid;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                INSERT INTO GIRISH_USERS (
                    username, email, password_hash, full_name, doctor_id, patient_id, is_active
                ) VALUES (
                    p_username, p_email, v_hash, p_full_name, p_doctor_id, p_patient_id, 'Y'
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
    END upsert_eval_user;
BEGIN
    SELECT MAX(CASE WHEN role_name = 'ADMIN' THEN role_id END),
           MAX(CASE WHEN role_name = 'DOCTOR' THEN role_id END),
           MAX(CASE WHEN role_name = 'PATIENT' THEN role_id END),
           MAX(CASE WHEN role_name = 'RECEPTIONIST' THEN role_id END)
    INTO v_admin_role_id, v_doctor_role_id, v_patient_role_id, v_reception_role_id
    FROM GIRISH_ROLES
    WHERE is_active = 'Y';

    SELECT MIN(doctor_id) INTO v_first_doctor_id FROM GIRISH_DOCTORS WHERE is_active = 'Y';
    SELECT NVL(MIN(CASE WHEN patient_id = 1 THEN 1 END), MIN(patient_id)) INTO v_first_patient_id FROM GIRISH_PATIENTS;

    upsert_eval_user('admin', 'admin@carepulse.local', 'Admin@123', 'Dr. Kavita Rao (Admin)', NULL, NULL, v_admin_role_id);
    upsert_eval_user('doctor', 'doctor@carepulse.local', 'Doctor@123', 'Dr. Anil Mehta', v_first_doctor_id, NULL, v_doctor_role_id);
    upsert_eval_user('patient', 'patient@carepulse.local', 'Patient@123', 'John Doe', NULL, v_first_patient_id, v_patient_role_id);
    upsert_eval_user('receptionist', 'reception@carepulse.local', 'Reception@123', 'Meera Kulkarni', NULL, NULL, v_reception_role_id);

    COMMIT;
END;
/

-- ---------------------------------------------------------------------
-- PART 2: Missing ORDS Templates & Handlers on Module girish_opd_api
-- ---------------------------------------------------------------------
BEGIN

  -- ===================================================================
  -- 1. AUTH: POST auth/login
  -- ===================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'auth/login',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Authenticate GIRISH_USERS and return role + permissions');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'auth/login',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_identifier     VARCHAR2(200);
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
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_identifier := LOWER(TRIM(APEX_JSON.GET_VARCHAR2(''identifier'')));
    v_password   := APEX_JSON.GET_VARCHAR2(''password'');

    IF v_identifier IS NULL OR v_password IS NULL THEN
        HTP.P(''{"status":"error","message":"Email/username and password are required"}'');
        RETURN;
    END IF;

    BEGIN
        SELECT user_id, username, email, password_hash, full_name, phone_number,
               doctor_id, patient_id, is_active
        INTO v_user_id, v_username, v_email, v_stored_hash, v_full_name, v_phone,
             v_doctor_id, v_patient_id, v_is_active
        FROM GIRISH_USERS
        WHERE LOWER(username) = v_identifier
           OR LOWER(email) = v_identifier
        FETCH FIRST 1 ROWS ONLY;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            HTP.P(''{"status":"error","message":"Invalid email/username or password"}'');
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
        HTP.P(''{"status":"error","message":"Invalid email/username or password"}'');
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
END;
');

  -- ===================================================================
  -- 2. AUTH: POST auth/register
  -- ===================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'auth/register',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Register a patient in GIRISH_PATIENTS + GIRISH_USERS');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'auth/register',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_first_name   VARCHAR2(100);
    v_last_name    VARCHAR2(100);
    v_phone        VARCHAR2(15);
    v_email        VARCHAR2(150);
    v_dob          VARCHAR2(30);
    v_gender       VARCHAR2(10);
    v_blood_group  VARCHAR2(5);
    v_password     VARCHAR2(200);
    v_patient_id   NUMBER;
    v_user_id      NUMBER;
    v_role_id      NUMBER;
    v_salt         VARCHAR2(32) := SUBSTR(RAWTOHEX(SYS_GUID()), 1, 16);
    v_hash         VARCHAR2(500);
    v_full_name    VARCHAR2(210);
    v_perms_json   VARCHAR2(32767) := '''';

    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN
            RETURN ''null'';
        END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), '' '') || ''"'';
    END jstr;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_first_name  := TRIM(APEX_JSON.GET_VARCHAR2(''first_name''));
    v_last_name   := TRIM(APEX_JSON.GET_VARCHAR2(''last_name''));
    v_phone       := TRIM(APEX_JSON.GET_VARCHAR2(''phone_number''));
    v_email       := LOWER(TRIM(APEX_JSON.GET_VARCHAR2(''email'')));
    v_dob         := TRIM(APEX_JSON.GET_VARCHAR2(''date_of_birth''));
    v_gender      := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''gender'')));
    v_blood_group := TRIM(APEX_JSON.GET_VARCHAR2(''blood_group''));
    v_password    := APEX_JSON.GET_VARCHAR2(''password'');

    IF v_first_name IS NULL OR v_last_name IS NULL OR v_phone IS NULL OR v_email IS NULL OR v_password IS NULL THEN
        HTP.P(''{"status":"error","message":"First name, last name, phone, email, and password are required"}'');
        RETURN;
    END IF;

    v_full_name := v_first_name || '' '' || v_last_name;

    INSERT INTO GIRISH_PATIENTS (
        first_name, last_name, phone_number, email, date_of_birth, gender, blood_group
    ) VALUES (
        v_first_name, v_last_name, v_phone, v_email,
        CASE WHEN v_dob IS NOT NULL THEN TO_DATE(v_dob, ''YYYY-MM-DD'') ELSE NULL END,
        v_gender, v_blood_group
    )
    RETURNING patient_id INTO v_patient_id;

    SELECT ''SHA256$'' || v_salt || ''$'' || RAWTOHEX(STANDARD_HASH(v_salt || '':'' || v_password, ''SHA256''))
    INTO v_hash
    FROM dual;

    INSERT INTO GIRISH_USERS (
        username, email, password_hash, full_name, phone_number, patient_id, is_active
    ) VALUES (
        v_email, v_email, v_hash, v_full_name, v_phone, v_patient_id, ''Y''
    )
    RETURNING user_id INTO v_user_id;

    SELECT role_id INTO v_role_id FROM GIRISH_ROLES WHERE role_name = ''PATIENT'' AND is_active = ''Y'';

    INSERT INTO GIRISH_USER_ROLES (user_id, role_id, assigned_by, is_active)
    VALUES (v_user_id, v_role_id, v_user_id, ''Y'');

    INSERT INTO GIRISH_AUDIT_LOGS (user_id, action_name, table_name, record_id, action_description)
    VALUES (v_user_id, ''INSERT'', ''GIRISH_PATIENTS'', TO_CHAR(v_patient_id), ''Self-registered patient account'');

    FOR pr IN (
        SELECT p.permission_name
        FROM GIRISH_ROLE_PERMISSIONS rp
        JOIN GIRISH_PERMISSIONS p ON p.permission_id = rp.permission_id AND p.is_active = ''Y''
        WHERE rp.role_id = v_role_id
        ORDER BY p.permission_name
    ) LOOP
        v_perms_json := v_perms_json || CASE WHEN v_perms_json IS NOT NULL THEN '','' ELSE '''' END || jstr(pr.permission_name);
    END LOOP;

    COMMIT;

    HTP.P(
        ''{"status":"success","user":{'' ||
        ''"user_id":'' || TO_CHAR(v_user_id) || '','' ||
        ''"username":'' || jstr(v_email) || '','' ||
        ''"email":'' || jstr(v_email) || '','' ||
        ''"full_name":'' || jstr(v_full_name) || '','' ||
        ''"phone_number":'' || jstr(v_phone) || '','' ||
        ''"role":"PATIENT","roles":["PATIENT"],'' ||
        ''"permissions":['' || NVL(v_perms_json, '''') || ''],'' ||
        ''"doctor_id":null,"patient_id":'' || TO_CHAR(v_patient_id) ||
        ''}}''
    );

EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"Email or phone number is already registered"}'');
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;
');

  -- ===================================================================
  -- 3. CONSULTATION TYPES: add GET consultation-types/ & PUT/DELETE :id
  --    (Template consultation-types/ already exists with POST handler)
  -- ===================================================================

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'consultation-types/',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT ct.consultation_type_id,
       ct.department_id,
       d.department_name,
       ct.consultation_type_name,
       ct.description,
       ct.duration_mins,
       ct.consultation_fee,
       ct.is_active
FROM GIRISH_CONSULTATION_TYPES ct
JOIN GIRISH_DEPARTMENTS d ON d.department_id = ct.department_id
WHERE ct.is_active = ''Y''
ORDER BY d.department_name, ct.consultation_type_name');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'consultation-types/:id',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'consultation-types/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_dept_id NUMBER;
    v_name    VARCHAR2(100);
    v_desc    VARCHAR2(250);
    v_dur     NUMBER;
    v_fee     NUMBER(10,2);
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_dept_id := APEX_JSON.GET_NUMBER(''department_id'');
    v_name    := APEX_JSON.GET_VARCHAR2(''consultation_type_name'');
    v_desc    := APEX_JSON.GET_VARCHAR2(''description'');
    v_dur     := APEX_JSON.GET_NUMBER(''duration_mins'');
    v_fee     := APEX_JSON.GET_NUMBER(''consultation_fee'');

    UPDATE GIRISH_CONSULTATION_TYPES
    SET department_id          = v_dept_id,
        consultation_type_name = v_name,
        description            = v_desc,
        duration_mins          = v_dur,
        consultation_fee       = v_fee,
        updated_on             = CURRENT_TIMESTAMP
    WHERE consultation_type_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        HTP.P(''{"status":"error","message":"Consultation type not found"}'');
    ELSE
        COMMIT;
        HTP.P(''{"status":"success","message":"Consultation type updated"}'');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'consultation-types/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
BEGIN
    UPDATE GIRISH_CONSULTATION_TYPES
    SET is_active  = ''N'',
        updated_on = CURRENT_TIMESTAMP
    WHERE consultation_type_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        HTP.P(''{"status":"error","message":"Consultation type not found"}'');
    ELSE
        COMMIT;
        HTP.P(''{"status":"success","message":"Consultation type deactivated"}'');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- ===================================================================
  -- 4. PATIENTS/:id (GET, PUT)
  -- ===================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'patients/:id',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'patients/:id',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT patient_id, first_name, last_name, phone_number, email,
       date_of_birth, gender, blood_group
FROM GIRISH_PATIENTS
WHERE patient_id = :id');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'patients/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_first  VARCHAR2(100);
    v_last   VARCHAR2(100);
    v_phone  VARCHAR2(15);
    v_email  VARCHAR2(255);
    v_dob    VARCHAR2(30);
    v_gender VARCHAR2(10);
    v_blood  VARCHAR2(5);
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_first  := TRIM(APEX_JSON.GET_VARCHAR2(''first_name''));
    v_last   := TRIM(APEX_JSON.GET_VARCHAR2(''last_name''));
    v_phone  := TRIM(APEX_JSON.GET_VARCHAR2(''phone_number''));
    v_email  := NULLIF(TRIM(APEX_JSON.GET_VARCHAR2(''email'')), '''');
    v_dob    := NULLIF(TRIM(APEX_JSON.GET_VARCHAR2(''date_of_birth'')), '''');
    v_gender := NULLIF(UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''gender''))), '''');
    v_blood  := NULLIF(TRIM(APEX_JSON.GET_VARCHAR2(''blood_group'')), '''');

    UPDATE GIRISH_PATIENTS
    SET first_name    = v_first,
        last_name     = v_last,
        phone_number  = v_phone,
        email         = v_email,
        date_of_birth = CASE WHEN v_dob IS NOT NULL THEN TO_DATE(v_dob, ''YYYY-MM-DD'') ELSE NULL END,
        gender        = v_gender,
        blood_group   = v_blood,
        updated_by    = USER,
        updated_on    = CURRENT_TIMESTAMP
    WHERE patient_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        HTP.P(''{"status":"error","message":"Patient not found"}'');
    ELSE
        COMMIT;
        HTP.P(''{"status":"success","message":"Patient updated successfully"}'');
    END IF;
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"Phone number or email already belongs to another patient"}'');
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- ===================================================================
  -- 5. SLOT TEMPLATES & SLOTS GENERATE (GIRISH_GENERATE_SLOTS)
  -- ===================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'slot_templates/:id',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slot_templates/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
BEGIN
    UPDATE GIRISH_SLOT_TEMPLATES
    SET is_active  = ''N'',
        updated_by = USER,
        updated_on = CURRENT_TIMESTAMP
    WHERE template_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        HTP.P(''{"status":"error","message":"Slot template not found"}'');
    ELSE
        COMMIT;
        HTP.P(''{"status":"success","message":"Slot template deactivated"}'');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'slots/generate',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Wraps existing PL/SQL procedure GIRISH_GENERATE_SLOTS');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slots/generate',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_days NUMBER := 30;
BEGIN
    IF :body_text IS NOT NULL THEN
        APEX_JSON.PARSE(:body_text);
        v_days := NVL(APEX_JSON.GET_NUMBER(''days''), 30);
    END IF;
    GIRISH_GENERATE_SLOTS(P_DAYS => v_days);
    COMMIT;
    HTP.P(''{"status":"success","message":"Slots generated for '' || v_days || '' days"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- ===================================================================
  -- 6. APPOINTMENT LIFECYCLE PROCEDURES & CANCELLATION RULES
  -- ===================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'appointments/:id/confirm',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Wraps GIRISH_CONFIRM_APPOINTMENT');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'appointments/:id/confirm',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
BEGIN
    GIRISH_CONFIRM_APPOINTMENT(P_APPOINTMENT_ID => :id);
    COMMIT;
    HTP.P(''{"status":"success","message":"Appointment confirmed"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'appointments/:id/cancel',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Wraps GIRISH_CANCEL_APPOINTMENT');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'appointments/:id/cancel',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
BEGIN
    GIRISH_CANCEL_APPOINTMENT(P_APPOINTMENT_ID => :id);
    COMMIT;
    HTP.P(''{"status":"success","message":"Appointment cancelled and slot released"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'appointments/:id/outcome',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Wraps GIRISH_UPDATE_APPOINTMENT_OUTCOME');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'appointments/:id/outcome',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_outcome VARCHAR2(20);
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_outcome := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''outcome'')));
    GIRISH_UPDATE_APPOINTMENT_OUTCOME(
        P_APPOINTMENT_ID => :id,
        P_OUTCOME        => v_outcome
    );
    COMMIT;
    HTP.P(''{"status":"success","message":"Appointment outcome updated to '' || v_outcome || ''"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'appointments/expire-holds',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Wraps GIRISH_EXPIRE_APPOINTMENT_HOLDS');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'appointments/expire-holds',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_expired_count NUMBER := 0;
BEGIN
    GIRISH_EXPIRE_APPOINTMENT_HOLDS(P_EXPIRED_COUNT => v_expired_count);
    COMMIT;
    HTP.P(''{"status":"success","expired_count":'' || v_expired_count || ''}'' );
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'cancellation-rules',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'cancellation-rules',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT rule_id, rule_name, min_hours_before, max_hours_before,
       refund_percentage, cancellation_fee, is_active
FROM GIRISH_CANCELLATION_RULES
WHERE is_active = ''Y''
ORDER BY min_hours_before');

  -- ===================================================================
  -- 7. DOCTOR LEAVES & APPROVAL WORKFLOW
  -- ===================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'leaves',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'leaves',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT dl.leave_id,
       dl.doctor_id,
       ''Dr. '' || d.first_name || '' '' || d.last_name AS doctor_name,
       dl.requested_by,
       dl.approved_by,
       dl.start_date,
       dl.end_date,
       dl.leave_reason,
       dl.leave_status,
       dl.requested_on,
       dl.approved_on
FROM GIRISH_DOCTOR_LEAVES dl
JOIN GIRISH_DOCTORS d ON d.doctor_id = dl.doctor_id
ORDER BY dl.requested_on DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'leaves',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_doctor_id     NUMBER;
    v_requested_by  NUMBER;
    v_start_date    DATE;
    v_end_date      DATE;
    v_reason        VARCHAR2(500);
    v_leave_id      NUMBER;
    v_approval_type NUMBER;
    v_request_id    NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_doctor_id    := APEX_JSON.GET_NUMBER(''doctor_id'');
    v_requested_by := APEX_JSON.GET_NUMBER(''requested_by'');
    v_start_date   := TO_DATE(APEX_JSON.GET_VARCHAR2(''start_date''), ''YYYY-MM-DD'');
    v_end_date     := TO_DATE(APEX_JSON.GET_VARCHAR2(''end_date''), ''YYYY-MM-DD'');
    v_reason       := TRIM(APEX_JSON.GET_VARCHAR2(''leave_reason''));

    IF v_doctor_id IS NULL THEN
        RAISE_APPLICATION_ERROR(-20001, ''doctor_id is required'');
    END IF;

    IF v_requested_by IS NULL THEN
        BEGIN
            SELECT user_id INTO v_requested_by
            FROM GIRISH_USERS
            WHERE doctor_id = v_doctor_id AND is_active = ''Y''
            FETCH FIRST 1 ROWS ONLY;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                SELECT MIN(user_id) INTO v_requested_by FROM GIRISH_USERS WHERE is_active = ''Y'';
        END;
    END IF;

    INSERT INTO GIRISH_DOCTOR_LEAVES (
        doctor_id, requested_by, start_date, end_date, leave_reason, leave_status
    ) VALUES (
        v_doctor_id, v_requested_by, v_start_date, v_end_date, v_reason, ''PENDING''
    )
    RETURNING leave_id INTO v_leave_id;

    BEGIN
        SELECT approval_type_id
        INTO v_approval_type
        FROM GIRISH_APPROVAL_TYPES
        WHERE approval_type_name = ''DOCTOR_LEAVE''
          AND is_active = ''Y'';

        INSERT INTO GIRISH_APPROVAL_REQUESTS (
            approval_type_id, requested_by, request_description,
            target_table, target_record_id, request_status
        ) VALUES (
            v_approval_type, v_requested_by,
            ''Doctor leave request #'' || v_leave_id || '': '' || NVL(v_reason, ''Planned leave''),
            ''GIRISH_DOCTOR_LEAVES'', v_leave_id, ''PENDING''
        )
        RETURNING request_id INTO v_request_id;

        INSERT INTO GIRISH_APPROVAL_HISTORY (
            request_id, action_by, action_name, comments
        ) VALUES (
            v_request_id, v_requested_by, ''SUBMITTED'', v_reason
        );
    EXCEPTION
        WHEN NO_DATA_FOUND THEN NULL;
    END;

    COMMIT;
    HTP.P(''{"status":"success","message":"Leave request submitted","leave_id":'' || v_leave_id || ''}'' );
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'leaves/:id/decide',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Wraps GIRISH_DECIDE_DOCTOR_LEAVE');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'leaves/:id/decide',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_admin_user_id NUMBER;
    v_decision      VARCHAR2(20);
    v_comments      VARCHAR2(1000);
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_admin_user_id := APEX_JSON.GET_NUMBER(''admin_user_id'');
    v_decision      := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''decision'')));
    v_comments      := APEX_JSON.GET_VARCHAR2(''comments'');

    IF v_admin_user_id IS NULL THEN
        SELECT u.user_id
        INTO v_admin_user_id
        FROM GIRISH_USERS u
        JOIN GIRISH_USER_ROLES ur ON ur.user_id = u.user_id AND ur.is_active = ''Y''
        JOIN GIRISH_ROLES r ON r.role_id = ur.role_id AND r.is_active = ''Y''
        WHERE r.role_name = ''ADMIN'' AND u.is_active = ''Y''
        FETCH FIRST 1 ROWS ONLY;
    END IF;

    GIRISH_DECIDE_DOCTOR_LEAVE(
        P_LEAVE_ID      => :id,
        P_ADMIN_USER_ID => v_admin_user_id,
        P_DECISION      => v_decision,
        P_COMMENTS      => v_comments
    );

    COMMIT;
    HTP.P(''{"status":"success","message":"Leave request '' || LOWER(v_decision) || ''"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'approvals',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'approvals',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT ar.request_id,
       ar.approval_type_id,
       atp.approval_type_name,
       ar.requested_by,
       u.full_name AS requester_name,
       ar.assigned_to,
       ar.request_description,
       ar.target_table,
       ar.target_record_id,
       ar.request_status,
       ar.requested_on,
       ar.decided_on
FROM GIRISH_APPROVAL_REQUESTS ar
JOIN GIRISH_APPROVAL_TYPES atp ON atp.approval_type_id = ar.approval_type_id
LEFT JOIN GIRISH_USERS u ON u.user_id = ar.requested_by
ORDER BY ar.requested_on DESC');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'approvals/:id/history',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'approvals/:id/history',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT h.history_id,
       h.request_id,
       h.action_by,
       u.full_name AS actor_name,
       h.action_name,
       h.comments,
       h.action_on
FROM GIRISH_APPROVAL_HISTORY h
LEFT JOIN GIRISH_USERS u ON u.user_id = h.action_by
WHERE h.request_id = :id
ORDER BY h.action_on ASC');

  -- ===================================================================
  -- 8. PAYMENTS POST & TOKEN QUEUE POST/PUT
  --    (Templates payments and token_queue already exist with GET handlers)
  -- ===================================================================

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'payments',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_appt_id     NUMBER;
    v_amount      NUMBER(10,2);
    v_method      VARCHAR2(50);
    v_status      VARCHAR2(20);
    v_pay_ref     VARCHAR2(50);
    v_appt_status VARCHAR2(20);
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_appt_id := APEX_JSON.GET_NUMBER(''appointment_id'');
    v_amount  := APEX_JSON.GET_NUMBER(''amount'');
    v_method  := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''payment_method'')));
    v_status  := UPPER(NVL(TRIM(APEX_JSON.GET_VARCHAR2(''status'')), ''SUCCESS''));

    IF v_appt_id IS NULL OR v_amount IS NULL THEN
        RAISE_APPLICATION_ERROR(-20001, ''appointment_id and amount are required'');
    END IF;

    SELECT status INTO v_appt_status
    FROM GIRISH_APPOINTMENTS
    WHERE appointment_id = v_appt_id;

    v_pay_ref := ''PAY'' || SUBSTR(RAWTOHEX(SYS_GUID()), 1, 17);

    INSERT INTO GIRISH_PAYMENTS (
        appointment_id, payment_ref, amount, payment_method, status
    ) VALUES (
        v_appt_id, v_pay_ref, v_amount, v_method, v_status
    );

    IF v_status = ''SUCCESS'' AND v_appt_status = ''HELD'' THEN
        GIRISH_CONFIRM_APPOINTMENT(P_APPOINTMENT_ID => v_appt_id);
    END IF;

    COMMIT;
    HTP.P(''{"status":"success","message":"Payment recorded","payment_ref":"'' || v_pay_ref || ''"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- (Template token_queue already exists with GET handler)

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'token_queue',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_appt_id      NUMBER;
    v_appt_status  VARCHAR2(20);
    v_dept_id      NUMBER;
    v_queue_date   DATE;
    v_token_num    NUMBER;
    v_existing     NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_appt_id := APEX_JSON.GET_NUMBER(''appointment_id'');

    IF v_appt_id IS NULL THEN
        RAISE_APPLICATION_ERROR(-20001, ''appointment_id is required'');
    END IF;

    SELECT a.status, d.department_id, TRUNC(s.slot_date)
    INTO v_appt_status, v_dept_id, v_queue_date
    FROM GIRISH_APPOINTMENTS a
    JOIN GIRISH_SLOTS s ON s.slot_id = a.slot_id
    JOIN GIRISH_SLOT_TEMPLATES st ON st.template_id = s.template_id
    JOIN GIRISH_DOCTORS d ON d.doctor_id = st.doctor_id
    WHERE a.appointment_id = v_appt_id;

    IF v_appt_status <> ''CONFIRMED'' THEN
        RAISE_APPLICATION_ERROR(-20060, ''Only confirmed appointments can be checked into token queue'');
    END IF;

    SELECT COUNT(*) INTO v_existing
    FROM GIRISH_TOKEN_QUEUE
    WHERE appointment_id = v_appt_id;

    IF v_existing > 0 THEN
        RAISE_APPLICATION_ERROR(-20061, ''Token already issued for this appointment'');
    END IF;

    SELECT NVL(MAX(token_number), 0) + 1
    INTO v_token_num
    FROM GIRISH_TOKEN_QUEUE
    WHERE department_id = v_dept_id
      AND queue_date = v_queue_date;

    INSERT INTO GIRISH_TOKEN_QUEUE (
        appointment_id, department_id, queue_date, token_number, status
    ) VALUES (
        v_appt_id, v_dept_id, v_queue_date, v_token_num, ''WAITING''
    );

    COMMIT;
    HTP.P(''{"status":"success","message":"Token #'' || v_token_num || '' issued","token_number":'' || v_token_num || ''}'' );
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'token_queue/:id',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'token_queue/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
DECLARE
    v_status VARCHAR2(20);
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_status := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''status'')));

    IF v_status NOT IN (''WAITING'', ''IN_CONSULTATION'', ''DONE'', ''SKIPPED'') THEN
        RAISE_APPLICATION_ERROR(-20062, ''Invalid token queue status'');
    END IF;

    UPDATE GIRISH_TOKEN_QUEUE
    SET status = v_status
    WHERE queue_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        HTP.P(''{"status":"error","message":"Token queue item not found"}'');
    ELSE
        COMMIT;
        HTP.P(''{"status":"success","message":"Token status updated"}'');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- ===================================================================
  -- 9. RBAC & ADMIN LOGS (users, roles, permissions, audit-logs, error-logs)
  -- ===================================================================
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'users',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'users',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT u.user_id,
       u.username,
       u.email,
       u.full_name,
       u.phone_number,
       u.doctor_id,
       u.patient_id,
       r.role_name,
       u.is_active,
       u.created_on
FROM GIRISH_USERS u
LEFT JOIN GIRISH_USER_ROLES ur ON ur.user_id = u.user_id AND ur.is_active = ''Y''
LEFT JOIN GIRISH_ROLES r ON r.role_id = ur.role_id
ORDER BY u.created_on DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'users',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
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

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'roles',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'roles',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT r.role_id,
       r.role_name,
       r.description,
       r.is_active,
       COUNT(rp.permission_id) AS permission_count
FROM GIRISH_ROLES r
LEFT JOIN GIRISH_ROLE_PERMISSIONS rp ON rp.role_id = r.role_id
GROUP BY r.role_id, r.role_name, r.description, r.is_active
ORDER BY r.role_id');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'permissions',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'permissions',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT permission_id,
       permission_name,
       resource_name,
       action_name,
       description
FROM GIRISH_PERMISSIONS
WHERE is_active = ''Y''
ORDER BY resource_name, permission_name');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'audit-logs',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'audit-logs',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT al.audit_id,
       al.user_id,
       u.username,
       al.action_name,
       al.table_name,
       al.record_id,
       al.action_description,
       al.action_on
FROM GIRISH_AUDIT_LOGS al
LEFT JOIN GIRISH_USERS u ON u.user_id = al.user_id
ORDER BY al.action_on DESC');

  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'error-logs',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'error-logs',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT log_id,
       module_name,
       procedure_name,
       oracle_error_code,
       error_message,
       additional_info,
       user_name,
       created_on
FROM GIRISH_ERROR_LOGS
ORDER BY created_on DESC');

  COMMIT;
END;
/

-- Quick verification summary after running script:
SELECT t.uri_template, h.method
FROM user_ords_modules m
JOIN user_ords_templates t ON t.module_id = m.id
JOIN user_ords_handlers h ON h.template_id = t.id
WHERE m.name = 'girish_opd_api'
ORDER BY t.uri_template, h.method;
