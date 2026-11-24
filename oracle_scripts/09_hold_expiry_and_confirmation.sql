-- =====================================================================
-- 09_hold_expiry_and_confirmation.sql
-- PURPOSE :
--   1) Make GIRISH_CONFIRM_APPOINTMENT and GIRISH_CANCEL_APPOINTMENT
--      idempotent while maintaining FOR UPDATE slot+appointment locking
--      and hold_expires_at validation.
--   2) Create/refresh an automatic Oracle DBMS_SCHEDULER job that runs
--      GIRISH_EXPIRE_APPOINTMENT_HOLDS every 1 minute at the database
--      layer (complementary to the application server's 15-second sweep).
-- SAFE    : Idempotent. Preserves GIRISH_APPT_STATUS_CHK and all existing
--           ORDS templates/handlers.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

CREATE OR REPLACE PROCEDURE GIRISH_CONFIRM_APPOINTMENT
(
    P_APPOINTMENT_ID IN NUMBER
)
AS
    V_SLOT_ID NUMBER;
    V_STATUS VARCHAR2(20);
    V_HOLD_EXPIRES TIMESTAMP;
BEGIN
    SELECT SLOT_ID
    INTO V_SLOT_ID
    FROM GIRISH_APPOINTMENTS
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID;

    -- Lock the slot first, matching booking/cancellation lock order.
    SELECT SLOT_ID
    INTO V_SLOT_ID
    FROM GIRISH_SLOTS
    WHERE SLOT_ID = V_SLOT_ID
    FOR UPDATE;

    SELECT STATUS, HOLD_EXPIRES_AT
    INTO V_STATUS, V_HOLD_EXPIRES
    FROM GIRISH_APPOINTMENTS
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID
    FOR UPDATE;

    -- Idempotent success if already confirmed
    IF V_STATUS = 'CONFIRMED' THEN
        RETURN;
    END IF;

    IF V_STATUS <> 'HELD' THEN
        RAISE_APPLICATION_ERROR(
            -20020,
            'Only held appointments can be confirmed'
        );
    END IF;

    IF V_HOLD_EXPIRES IS NULL OR V_HOLD_EXPIRES <= CURRENT_TIMESTAMP THEN
        UPDATE GIRISH_APPOINTMENTS
        SET STATUS = 'CANCELLED',
            UPDATED_ON = CURRENT_TIMESTAMP
        WHERE APPOINTMENT_ID = P_APPOINTMENT_ID;

        UPDATE GIRISH_SLOTS S
        SET BOOKED_PATIENTS = 0,
            STATUS = 'AVAILABLE',
            UPDATED_ON = CURRENT_TIMESTAMP
        WHERE S.SLOT_ID = V_SLOT_ID
          AND NOT EXISTS (
              SELECT 1
              FROM GIRISH_APPOINTMENTS A
              WHERE A.SLOT_ID = S.SLOT_ID
                AND A.STATUS IN ('HELD', 'CONFIRMED')
          );

        RAISE_APPLICATION_ERROR(
            -20021,
            'Appointment hold expired. Please book again'
        );
    END IF;

    UPDATE GIRISH_APPOINTMENTS
    SET STATUS = 'CONFIRMED',
        HOLD_EXPIRES_AT = NULL,
        UPDATED_ON = CURRENT_TIMESTAMP
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID;
END;
/

CREATE OR REPLACE PROCEDURE GIRISH_CANCEL_APPOINTMENT
(
    P_APPOINTMENT_ID IN NUMBER
)
AS
    V_SLOT_ID NUMBER;
    V_STATUS VARCHAR2(20);
BEGIN
    SELECT SLOT_ID
    INTO V_SLOT_ID
    FROM GIRISH_APPOINTMENTS
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID;

    SELECT SLOT_ID
    INTO V_SLOT_ID
    FROM GIRISH_SLOTS
    WHERE SLOT_ID = V_SLOT_ID
    FOR UPDATE;

    SELECT STATUS
    INTO V_STATUS
    FROM GIRISH_APPOINTMENTS
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID
    FOR UPDATE;

    -- Idempotent success if already cancelled
    IF V_STATUS = 'CANCELLED' THEN
        RETURN;
    END IF;

    IF V_STATUS NOT IN ('HELD', 'CONFIRMED') THEN
        RAISE_APPLICATION_ERROR(
            -20022,
            'Only held or confirmed appointments can be cancelled'
        );
    END IF;

    UPDATE GIRISH_APPOINTMENTS
    SET STATUS = 'CANCELLED',
        HOLD_EXPIRES_AT = NULL,
        UPDATED_ON = CURRENT_TIMESTAMP
    WHERE APPOINTMENT_ID = P_APPOINTMENT_ID;

    UPDATE GIRISH_SLOTS S
    SET BOOKED_PATIENTS = 0,
        STATUS = 'AVAILABLE',
        UPDATED_ON = CURRENT_TIMESTAMP
    WHERE S.SLOT_ID = V_SLOT_ID
      AND NOT EXISTS (
          SELECT 1
          FROM GIRISH_APPOINTMENTS A
          WHERE A.SLOT_ID = S.SLOT_ID
            AND A.STATUS IN ('HELD', 'CONFIRMED')
      );
END;
/

-- Optional DB-level scheduler job (runs every 1 minute if DBMS_SCHEDULER is permitted)
BEGIN
    BEGIN
        DBMS_SCHEDULER.DROP_JOB(job_name => 'GIRISH_EXPIRE_HOLDS_JOB', force => TRUE);
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;

    DBMS_SCHEDULER.CREATE_JOB(
        job_name        => 'GIRISH_EXPIRE_HOLDS_JOB',
        job_type        => 'PLSQL_BLOCK',
        job_action      => 'DECLARE v_cnt NUMBER; BEGIN GIRISH_EXPIRE_APPOINTMENT_HOLDS(v_cnt); COMMIT; END;',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=MINUTELY;INTERVAL=1',
        enabled         => TRUE,
        comments        => 'Automatically expires overdue 10-minute appointment slot holds and releases slot capacity.'
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Ignore if APEX workspace user lacks CREATE JOB privilege; BFF scheduler handles 15s sweep
        NULL;
END;
/
