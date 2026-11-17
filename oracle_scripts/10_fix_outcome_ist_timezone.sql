-- =====================================================================
-- 10_fix_outcome_ist_timezone.sql
-- PURPOSE :
--   Update GIRISH_UPDATE_APPOINTMENT_OUTCOME so that slot end times are
--   evaluated in Asia/Kolkata (IST) rather than Oracle UTC SYSDATE, and
--   cross-midnight slots (end_time <= start_time) correctly advance the
--   slot end date by 1 day.
-- SAFE    : Idempotent CREATE OR REPLACE PROCEDURE + recompile check.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

CREATE OR REPLACE PROCEDURE GIRISH_UPDATE_APPOINTMENT_OUTCOME
(
    P_APPOINTMENT_ID IN NUMBER,
    P_OUTCOME        IN VARCHAR2
)
AS
    V_SLOT_ID    NUMBER;
    V_STATUS     VARCHAR2(20);
    V_SLOT_DATE  DATE;
    V_START_TIME VARCHAR2(10);
    V_END_TIME   VARCHAR2(10);
    V_END_DT     DATE;
    V_IST_NOW    DATE := CAST((SYSTIMESTAMP AT TIME ZONE 'Asia/Kolkata') AS DATE);
BEGIN
    IF P_OUTCOME NOT IN ('COMPLETED', 'NO_SHOW') THEN
        RAISE_APPLICATION_ERROR(
            -20030,
            'Outcome must be COMPLETED or NO_SHOW'
        );
    END IF;

    SELECT SLOT_ID
    INTO V_SLOT_ID
    FROM GIRISH_APPOINTMENTS
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID;

    -- Lock slot before appointment.
    SELECT SLOT_DATE, START_TIME, END_TIME
    INTO V_SLOT_DATE, V_START_TIME, V_END_TIME
    FROM GIRISH_SLOTS
    WHERE SLOT_ID = V_SLOT_ID
    FOR UPDATE;

    SELECT STATUS
    INTO V_STATUS
    FROM GIRISH_APPOINTMENTS
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID
    FOR UPDATE;

    IF V_STATUS <> 'CONFIRMED' THEN
        RAISE_APPLICATION_ERROR(
            -20031,
            'Only confirmed appointments can be completed or marked no-show'
        );
    END IF;

    V_END_DT := TO_DATE(
        TO_CHAR(V_SLOT_DATE, 'YYYY-MM-DD') || ' ' || V_END_TIME,
        'YYYY-MM-DD HH24:MI'
    );
    IF V_END_TIME <= V_START_TIME THEN
        V_END_DT := V_END_DT + 1;
    END IF;

    IF V_END_DT > V_IST_NOW THEN
        RAISE_APPLICATION_ERROR(
            -20032,
            'Appointment end time has not passed'
        );
    END IF;

    UPDATE GIRISH_APPOINTMENTS
    SET STATUS = P_OUTCOME,
        HOLD_EXPIRES_AT = NULL,
        UPDATED_ON = CURRENT_TIMESTAMP
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID;

    -- Do not release the slot: preserve its historical booking count.
END GIRISH_UPDATE_APPOINTMENT_OUTCOME;
/

ALTER PROCEDURE GIRISH_UPDATE_APPOINTMENT_OUTCOME COMPILE;

SELECT object_name, object_type, status, last_ddl_time
FROM USER_OBJECTS
WHERE object_name = 'GIRISH_UPDATE_APPOINTMENT_OUTCOME';
