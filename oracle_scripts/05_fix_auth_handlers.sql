-- =====================================================================
-- 05_fix_auth_handlers.sql
-- PURPOSE : Patch ONLY POST auth/login and POST auth/register handlers
--           in girish_opd_api so they output VARCHAR2 JSON via HTP.P
--           (avoiding HTP.P(CLOB) overload error ORDS-25001).
-- SAFE    : Only updates those 2 auth handlers; does not touch data or
--           any other handlers created by 03_auth_and_missing_ords.sql.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

BEGIN
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

  COMMIT;
END;
/
