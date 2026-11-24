-- =====================================================================
-- 14_cleanup_legacy_approval_and_template_tables.sql
-- PURPOSE :
--   Safely remove the 4 legacy Oracle tables requested by the user:
--     1. GIRISH_APPROVAL_HISTORY
--     2. GIRISH_APPROVAL_REQUESTS
--     3. GIRISH_APPROVAL_TYPES
--     4. GIRISH_SLOT_TEMPLATES
--
--   WHY PRE-CLEANUP IS REQUIRED BEFORE DROPPING:
--     - GIRISH_DECIDE_DOCTOR_LEAVE and ORDS POST /leaves previously read/wrote
--       GIRISH_APPROVAL_TYPES, GIRISH_APPROVAL_REQUESTS, and
--       GIRISH_APPROVAL_HISTORY. Dropping them first would invalidate
--       GIRISH_DECIDE_DOCTOR_LEAVE (ORA-00942 / ORA-06575).
--     - GIRISH_SLOTS originally held a foreign key to GIRISH_SLOT_TEMPLATES.
--       Script 13_slots_doctor_id_restructure.sql migrated GIRISH_SLOTS to
--       DOCTOR_ID; this script also guarantees the backfill & FK drop before
--       dropping GIRISH_SLOT_TEMPLATES.
--     - Legacy ORDS templates (approvals, approvals/:id/history, slot_templates,
--       slot_templates/:id) referenced those tables and are removed cleanly.
--
-- SAFE    : Idempotent (checks USER_TABLES / USER_CONSTRAINTS / USER_TAB_COLUMNS).
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop -> SQL Scripts (Run / F5)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: Update GIRISH_DECIDE_DOCTOR_LEAVE to operate directly on
--         GIRISH_DOCTOR_LEAVES + GIRISH_SLOTS without approval tables
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE GIRISH_DECIDE_DOCTOR_LEAVE
(
    P_LEAVE_ID      IN NUMBER,
    P_ADMIN_USER_ID IN NUMBER,
    P_DECISION      IN VARCHAR2,
    P_COMMENTS      IN VARCHAR2 DEFAULT NULL
)
AS
    V_DOCTOR_ID      NUMBER;
    V_LEAVE_STATUS   VARCHAR2(20);
    V_START_DATE     DATE;
    V_END_DATE       DATE;
    V_COUNT          NUMBER;
    V_CONFLICT_COUNT NUMBER := 0;
    V_CONFLICT_IDS   VARCHAR2(1500) := '';
BEGIN
    IF UPPER(P_DECISION) NOT IN ('APPROVED', 'REJECTED') THEN
        RAISE_APPLICATION_ERROR(-20040, 'Invalid leave decision');
    END IF;

    SELECT COUNT(*)
    INTO V_COUNT
    FROM GIRISH_USERS U
    JOIN GIRISH_USER_ROLES UR ON UR.USER_ID = U.USER_ID
    JOIN GIRISH_ROLES R ON R.ROLE_ID = UR.ROLE_ID
    WHERE U.USER_ID = P_ADMIN_USER_ID
      AND U.IS_ACTIVE = 'Y'
      AND UR.IS_ACTIVE = 'Y'
      AND R.ROLE_NAME = 'ADMIN'
      AND R.IS_ACTIVE = 'Y';

    IF V_COUNT = 0 THEN
        RAISE_APPLICATION_ERROR(-20041, 'User is not an active administrator');
    END IF;

    SELECT DOCTOR_ID, LEAVE_STATUS, START_DATE, END_DATE
    INTO V_DOCTOR_ID, V_LEAVE_STATUS, V_START_DATE, V_END_DATE
    FROM GIRISH_DOCTOR_LEAVES
    WHERE LEAVE_ID = P_LEAVE_ID
    FOR UPDATE;

    IF V_LEAVE_STATUS <> 'PENDING' THEN
        RAISE_APPLICATION_ERROR(-20042, 'Leave request is not pending');
    END IF;

    IF UPPER(P_DECISION) = 'APPROVED' THEN
        -- Lock doctor's slots directly via GIRISH_SLOTS.DOCTOR_ID
        FOR R_SLOT IN (
            SELECT SLOT_ID
            FROM GIRISH_SLOTS
            WHERE DOCTOR_ID = V_DOCTOR_ID
              AND SLOT_DATE >= TRUNC(V_START_DATE)
              AND SLOT_DATE < TRUNC(V_END_DATE) + 1
            ORDER BY SLOT_ID
            FOR UPDATE OF STATUS
        ) LOOP
            NULL;
        END LOOP;

        -- Find confirmed appointments and active holds directly via GIRISH_SLOTS.DOCTOR_ID
        FOR R_CONFLICT IN (
            SELECT A.APPOINTMENT_ID
            FROM GIRISH_APPOINTMENTS A
            JOIN GIRISH_SLOTS S
                ON S.SLOT_ID = A.SLOT_ID
            WHERE S.DOCTOR_ID = V_DOCTOR_ID
              AND S.SLOT_DATE >= TRUNC(V_START_DATE)
              AND S.SLOT_DATE < TRUNC(V_END_DATE) + 1
              AND (
                    UPPER(A.STATUS) = 'CONFIRMED'
                    OR (
                        UPPER(A.STATUS) = 'HELD'
                        AND A.HOLD_EXPIRES_AT > CURRENT_TIMESTAMP
                    )
                  )
            ORDER BY A.APPOINTMENT_ID
        ) LOOP
            V_CONFLICT_COUNT := V_CONFLICT_COUNT + 1;
            IF NVL(LENGTH(V_CONFLICT_IDS), 0) < 1300 THEN
                IF V_CONFLICT_IDS IS NOT NULL THEN
                    V_CONFLICT_IDS := V_CONFLICT_IDS || ',';
                END IF;
                V_CONFLICT_IDS := V_CONFLICT_IDS || R_CONFLICT.APPOINTMENT_ID;
            END IF;
        END LOOP;

        IF V_CONFLICT_COUNT > 0 THEN
            RAISE_APPLICATION_ERROR(
                -20044,
                'Leave conflicts with active appointments. IDs: ' || V_CONFLICT_IDS || '. Total conflicts: ' || V_CONFLICT_COUNT
            );
        END IF;
    END IF;

    UPDATE GIRISH_DOCTOR_LEAVES
    SET LEAVE_STATUS = UPPER(P_DECISION),
        APPROVED_BY = P_ADMIN_USER_ID,
        APPROVED_ON = CURRENT_TIMESTAMP
    WHERE LEAVE_ID = P_LEAVE_ID;

    IF UPPER(P_DECISION) = 'APPROVED' THEN
        UPDATE GIRISH_SLOTS S
        SET S.STATUS = 'CANCELLED',
            S.UPDATED_ON = CURRENT_TIMESTAMP
        WHERE S.DOCTOR_ID = V_DOCTOR_ID
          AND S.SLOT_DATE >= TRUNC(V_START_DATE)
          AND S.SLOT_DATE < TRUNC(V_END_DATE) + 1
          AND S.SLOT_DATE >= TRUNC(CAST((SYSTIMESTAMP AT TIME ZONE 'Asia/Kolkata') AS DATE))
          AND S.STATUS = 'AVAILABLE'
          AND S.BOOKED_PATIENTS = 0;
    END IF;
END GIRISH_DECIDE_DOCTOR_LEAVE;
/

-- ---------------------------------------------------------------------
-- PART 2: Update ORDS POST /leaves handler and drop obsolete ORDS templates
-- ---------------------------------------------------------------------
BEGIN
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'leaves',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Direct leave request insert without legacy approval tables',
      p_source         => '
DECLARE
    v_doctor_id     NUMBER;
    v_requested_by  NUMBER;
    v_start_date    DATE;
    v_end_date      DATE;
    v_reason        VARCHAR2(500);
    v_leave_id      NUMBER;
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

    COMMIT;
    HTP.P(''{"status":"success","message":"Leave request submitted","leave_id":'' || v_leave_id || ''}'' );
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  COMMIT;
END;
/

BEGIN
  FOR t IN (
      SELECT uri_template
      FROM (
          SELECT 'approvals' AS uri_template FROM dual UNION ALL
          SELECT 'approvals/:id/history' FROM dual UNION ALL
          SELECT 'slot_templates' FROM dual UNION ALL
          SELECT 'slot_templates/:id' FROM dual
      )
  ) LOOP
      BEGIN
          ORDS.DELETE_TEMPLATE(
              p_module_name  => 'girish_opd_api',
              p_uri_template => t.uri_template
          );
      EXCEPTION
          WHEN OTHERS THEN NULL;
      END;
  END LOOP;

  COMMIT;
END;
/

-- ---------------------------------------------------------------------
-- PART 3: Safety check on GIRISH_SLOTS before dropping GIRISH_SLOT_TEMPLATES
-- ---------------------------------------------------------------------
DECLARE
    v_cnt       NUMBER := 0;
    v_nullable  VARCHAR2(1);
BEGIN
    SELECT COUNT(*) INTO v_cnt
    FROM USER_TAB_COLUMNS
    WHERE TABLE_NAME = 'GIRISH_SLOTS'
      AND COLUMN_NAME = 'DOCTOR_ID';

    IF v_cnt = 0 THEN
        RAISE_APPLICATION_ERROR(
            -20190,
            'Run oracle_scripts/13_slots_doctor_id_restructure.sql first so GIRISH_SLOTS.DOCTOR_ID exists before dropping GIRISH_SLOT_TEMPLATES.'
        );
    END IF;

    SELECT COUNT(*) INTO v_cnt
    FROM USER_TABLES
    WHERE TABLE_NAME = 'GIRISH_SLOT_TEMPLATES';

    IF v_cnt > 0 THEN
        EXECUTE IMMEDIATE '
            UPDATE GIRISH_SLOTS s
            SET s.doctor_id = (
                SELECT t.doctor_id
                FROM GIRISH_SLOT_TEMPLATES t
                WHERE t.template_id = s.template_id
            )
            WHERE s.doctor_id IS NULL
              AND s.template_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM GIRISH_SLOT_TEMPLATES t
                  JOIN GIRISH_DOCTORS d ON d.doctor_id = t.doctor_id
                  WHERE t.template_id = s.template_id
              )
        ';
        COMMIT;
    END IF;

    FOR c IN (
        SELECT uc.constraint_name
        FROM USER_CONSTRAINTS uc
        JOIN USER_CONSTRAINTS rc ON rc.constraint_name = uc.r_constraint_name
        WHERE uc.table_name = 'GIRISH_SLOTS'
          AND uc.constraint_type = 'R'
          AND rc.table_name = 'GIRISH_SLOT_TEMPLATES'
    ) LOOP
        EXECUTE IMMEDIATE 'ALTER TABLE GIRISH_SLOTS DROP CONSTRAINT ' || c.constraint_name;
    END LOOP;

    BEGIN
        SELECT nullable INTO v_nullable
        FROM USER_TAB_COLUMNS
        WHERE TABLE_NAME = 'GIRISH_SLOTS'
          AND COLUMN_NAME = 'TEMPLATE_ID';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_nullable := 'Y';
    END;

    IF v_nullable = 'N' THEN
        EXECUTE IMMEDIATE 'ALTER TABLE GIRISH_SLOTS MODIFY (TEMPLATE_ID NULL)';
    END IF;
END;
/

-- ---------------------------------------------------------------------
-- PART 4: Drop the 4 legacy tables safely in child -> parent order
-- ---------------------------------------------------------------------
DECLARE
    v_cnt NUMBER := 0;
BEGIN
    FOR t IN (
        SELECT table_name FROM (
            SELECT 'GIRISH_APPROVAL_HISTORY'  AS table_name, 1 AS ord FROM dual UNION ALL
            SELECT 'GIRISH_APPROVAL_REQUESTS' AS table_name, 2 AS ord FROM dual UNION ALL
            SELECT 'GIRISH_APPROVAL_TYPES'    AS table_name, 3 AS ord FROM dual UNION ALL
            SELECT 'GIRISH_SLOT_TEMPLATES'    AS table_name, 4 AS ord FROM dual
        ) ORDER BY ord
    ) LOOP
        SELECT COUNT(*) INTO v_cnt
        FROM USER_TABLES
        WHERE TABLE_NAME = t.table_name;

        IF v_cnt > 0 THEN
            EXECUTE IMMEDIATE 'DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS PURGE';
        END IF;
    END LOOP;
END;
/

-- ---------------------------------------------------------------------
-- PART 5: Recompile all schema objects and verify zero invalid objects
-- ---------------------------------------------------------------------
BEGIN
    FOR p IN (
        SELECT object_name
        FROM USER_OBJECTS
        WHERE object_type = 'PROCEDURE'
          AND object_name LIKE 'GIRISH_%'
        ORDER BY object_name
    ) LOOP
        BEGIN
            EXECUTE IMMEDIATE 'ALTER PROCEDURE ' || p.object_name || ' COMPILE';
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;
    END LOOP;

    BEGIN
        DBMS_UTILITY.COMPILE_SCHEMA(
            schema         => USER,
            compile_all    => FALSE,
            reuse_settings => TRUE
        );
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
END;
/

SELECT table_name
FROM USER_TABLES
WHERE table_name IN (
    'GIRISH_APPROVAL_HISTORY',
    'GIRISH_APPROVAL_REQUESTS',
    'GIRISH_APPROVAL_TYPES',
    'GIRISH_SLOT_TEMPLATES'
);

SELECT object_name, object_type, status
FROM USER_OBJECTS
WHERE object_name LIKE 'GIRISH_%'
  AND status <> 'VALID'
ORDER BY object_name;

SELECT name, type, line, position, text
FROM USER_ERRORS
WHERE name LIKE 'GIRISH_%'
ORDER BY name, sequence;
