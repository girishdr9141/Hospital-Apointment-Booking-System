-- =====================================================================
-- 09_recompile_invalid_procedures.sql
-- PURPOSE :
--   1) Recompile GIRISH_DECIDE_DOCTOR_LEAVE and
--      GIRISH_UPDATE_APPOINTMENT_OUTCOME (invalidated after ALTER TABLE
--      GIRISH_APPOINTMENTS in 08_consultation_mode_and_notifications.sql).
--   2) Recompile any remaining invalid PL/SQL objects in current schema.
--   3) Print object status and any compiler errors (if any exist).
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

ALTER PROCEDURE GIRISH_DECIDE_DOCTOR_LEAVE COMPILE;
ALTER PROCEDURE GIRISH_UPDATE_APPOINTMENT_OUTCOME COMPILE;

BEGIN
    DBMS_UTILITY.COMPILE_SCHEMA(
        schema         => USER,
        compile_all    => FALSE,
        reuse_settings => TRUE
    );
END;
/

-- Verify procedure status (should both be VALID)
SELECT object_name, object_type, status, last_ddl_time
FROM USER_OBJECTS
WHERE object_name IN (
    'GIRISH_BOOK_APPOINTMENT',
    'GIRISH_CANCEL_APPOINTMENT',
    'GIRISH_CONFIRM_APPOINTMENT',
    'GIRISH_DECIDE_DOCTOR_LEAVE',
    'GIRISH_EXPIRE_APPOINTMENT_HOLDS',
    'GIRISH_GENERATE_SLOTS',
    'GIRISH_UPDATE_APPOINTMENT_OUTCOME'
)
ORDER BY object_name;

-- Check if any compilation errors exist for those procedures
SELECT name, type, line, position, text
FROM USER_ERRORS
WHERE name IN (
    'GIRISH_DECIDE_DOCTOR_LEAVE',
    'GIRISH_UPDATE_APPOINTMENT_OUTCOME'
)
ORDER BY name, sequence;
