-- =====================================================================
-- 08_consultation_mode_and_notifications.sql
-- PURPOSE :
--   1) Add CONSULTATION_MODE ('ONLINE' | 'FACE_TO_FACE') to GIRISH_APPOINTMENTS
--      with default 'FACE_TO_FACE' to preserve all legacy appointments, plus
--      optional RESCHEDULED_FROM_ID lineage column for reschedule analytics.
--   2) Update GET appointments & POST appointments/ ORDS handlers to persist,
--      validate, and return consultation_mode, enforce Asia/Kolkata non-expired
--      slots, and block duplicate active patient+slot bookings.
--   3) Update POST slots & POST slots/doctor-generate ORDS handlers to reject
--      expired slots on today's date in Asia/Kolkata timezone.
-- SAFE    : Idempotent. Calls ORDS.DEFINE_HANDLER ONLY on existing patterns.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: Schema Migration on GIRISH_APPOINTMENTS
-- ---------------------------------------------------------------------
DECLARE
    v_col_count NUMBER := 0;
    v_chk_count NUMBER := 0;
    v_rs_count  NUMBER := 0;
BEGIN
    SELECT COUNT(*)
    INTO v_col_count
    FROM USER_TAB_COLUMNS
    WHERE TABLE_NAME = 'GIRISH_APPOINTMENTS'
      AND COLUMN_NAME = 'CONSULTATION_MODE';

    IF v_col_count = 0 THEN
        EXECUTE IMMEDIATE '
            ALTER TABLE GIRISH_APPOINTMENTS
            ADD (CONSULTATION_MODE VARCHAR2(20) DEFAULT ''FACE_TO_FACE'' NOT NULL)
        ';
    END IF;

    SELECT COUNT(*)
    INTO v_chk_count
    FROM USER_CONSTRAINTS
    WHERE TABLE_NAME = 'GIRISH_APPOINTMENTS'
      AND CONSTRAINT_NAME = 'CHK_GIRISH_APPT_CONSULT_MODE';

    IF v_chk_count = 0 THEN
        EXECUTE IMMEDIATE '
            ALTER TABLE GIRISH_APPOINTMENTS
            ADD CONSTRAINT CHK_GIRISH_APPT_CONSULT_MODE
            CHECK (CONSULTATION_MODE IN (''ONLINE'', ''FACE_TO_FACE''))
        ';
    END IF;

    SELECT COUNT(*)
    INTO v_rs_count
    FROM USER_TAB_COLUMNS
    WHERE TABLE_NAME = 'GIRISH_APPOINTMENTS'
      AND COLUMN_NAME = 'RESCHEDULED_FROM_ID';

    IF v_rs_count = 0 THEN
        EXECUTE IMMEDIATE '
            ALTER TABLE GIRISH_APPOINTMENTS
            ADD (RESCHEDULED_FROM_ID NUMBER NULL)
        ';
    END IF;

    COMMIT;
END;
/

-- ---------------------------------------------------------------------
-- PART 2: Update ORDS Handlers (Handler-only, preserves all templates)
-- ---------------------------------------------------------------------
BEGIN
  -- 1. GET appointments: include consultation_mode and rescheduled_from_id
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'appointments',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'List appointments including consultation_mode',
      p_source         => '
SELECT a.appointment_id,
       a.appointment_ref,
       a.patient_id,
       p.first_name || '' '' || p.last_name AS patient_name,
       a.slot_id,
       a.status,
       NVL(a.consultation_mode, ''FACE_TO_FACE'') AS consultation_mode,
       a.booking_source,
       a.rescheduled_from_id,
       a.hold_expires_at,
       a.created_on
FROM GIRISH_APPOINTMENTS a
JOIN GIRISH_PATIENTS p
    ON p.patient_id = a.patient_id
ORDER BY a.created_on DESC'
  );

  -- 2. POST appointments/: validate Asia/Kolkata time, duplicate bookings, and persist consultation_mode
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'appointments/',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Book appointment with consultation_mode and IST slot-time validation',
      p_source         => '
DECLARE
    V_PATIENT_ID        NUMBER;
    V_SLOT_ID           NUMBER;
    V_BOOKING_SOURCE    VARCHAR2(20);
    V_CONSULT_MODE      VARCHAR2(20);
    V_APPOINTMENT_REF   VARCHAR2(20);
    V_SLOT_DATE         DATE;
    V_START_TIME        VARCHAR2(10);
    V_SLOT_STATUS       VARCHAR2(20);
    V_IST_NOW           DATE := CAST((SYSTIMESTAMP AT TIME ZONE ''Asia/Kolkata'') AS DATE);
    V_DUP_COUNT         NUMBER := 0;
BEGIN
    APEX_JSON.PARSE(:body_text);

    V_PATIENT_ID := APEX_JSON.GET_NUMBER(''patient_id'');
    V_SLOT_ID := APEX_JSON.GET_NUMBER(''slot_id'');
    V_BOOKING_SOURCE := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''booking_source'')));
    V_CONSULT_MODE := UPPER(TRIM(NVL(APEX_JSON.GET_VARCHAR2(''consultation_mode''), '''')));

    IF V_PATIENT_ID IS NULL OR V_SLOT_ID IS NULL OR V_BOOKING_SOURCE IS NULL THEN
        RAISE_APPLICATION_ERROR(-20001, ''Patient ID, Slot ID and Booking Source are required'');
    END IF;

    IF V_CONSULT_MODE NOT IN (''ONLINE'', ''FACE_TO_FACE'') THEN
        RAISE_APPLICATION_ERROR(-20002, ''Consultation mode must be ONLINE or FACE_TO_FACE'');
    END IF;

    SELECT TRUNC(slot_date), start_time, status
    INTO V_SLOT_DATE, V_START_TIME, V_SLOT_STATUS
    FROM GIRISH_SLOTS
    WHERE slot_id = V_SLOT_ID;

    IF V_SLOT_STATUS <> ''AVAILABLE'' THEN
        RAISE_APPLICATION_ERROR(-20004, ''Selected slot is no longer available'');
    END IF;

    IF V_SLOT_DATE < TRUNC(V_IST_NOW) OR
       (V_SLOT_DATE = TRUNC(V_IST_NOW) AND V_START_TIME <= TO_CHAR(V_IST_NOW, ''HH24:MI'')) THEN
        RAISE_APPLICATION_ERROR(-20005, ''Selected slot time has already passed'');
    END IF;

    SELECT COUNT(*)
    INTO V_DUP_COUNT
    FROM GIRISH_APPOINTMENTS
    WHERE patient_id = V_PATIENT_ID
      AND slot_id = V_SLOT_ID
      AND status IN (''HELD'', ''CONFIRMED'', ''COMPLETED'');

    IF V_DUP_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(-20006, ''Duplicate booking: patient already has an active appointment for this slot'');
    END IF;

    GIRISH_BOOK_APPOINTMENT(
        P_PATIENT_ID => V_PATIENT_ID,
        P_SLOT_ID => V_SLOT_ID,
        P_BOOKING_SOURCE => V_BOOKING_SOURCE,
        P_APPOINTMENT_REF => V_APPOINTMENT_REF
    );

    UPDATE GIRISH_APPOINTMENTS
    SET consultation_mode = V_CONSULT_MODE
    WHERE appointment_ref = V_APPOINTMENT_REF;

    COMMIT;

    HTP.P(
        ''{"status":"success",'' ||
        ''"message":"Appointment booked successfully",'' ||
        ''"appointment_ref":"'' || V_APPOINTMENT_REF || ''",'' ||
        ''"consultation_mode":"'' || V_CONSULT_MODE || ''"}''
    );

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(
            ''{"status":"error","message":"'' ||
            REPLACE(SQLERRM, ''"'', ''\"'') || ''"}''
        );
END;'
  );

  -- 3. POST slots: reject expired start times on today's date (Asia/Kolkata)
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slots',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Create single slot with Asia/Kolkata expiry validation',
      p_source         => '
DECLARE
    v_slot_date DATE := TO_DATE(:slot_date, ''YYYY-MM-DD'');
    v_ist_now   DATE := CAST((SYSTIMESTAMP AT TIME ZONE ''Asia/Kolkata'') AS DATE);
BEGIN
    IF TRUNC(v_slot_date) < TRUNC(v_ist_now) OR
       (TRUNC(v_slot_date) = TRUNC(v_ist_now) AND :start_time <= TO_CHAR(v_ist_now, ''HH24:MI'')) THEN
        HTP.P(''{"status":"error","message":"Cannot generate slots at or before current hospital time"}'');
        RETURN;
    END IF;

    INSERT INTO GIRISH_SLOTS
    (
        template_id,
        slot_date,
        start_time,
        end_time,
        max_patients_per_slot,
        booked_patients,
        status
    )
    VALUES
    (
        :template_id,
        v_slot_date,
        :start_time,
        :end_time,
        :max_patients_per_slot,
        0,
        ''AVAILABLE''
    );

    COMMIT;
    HTP.P(''{"status":"success","message":"Slot created successfully"}'');

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;'
  );

  -- 4. POST slots/doctor-generate: ensure template exists if missing, then define handler
  DECLARE
    v_tmpl_cnt NUMBER := 0;
  BEGIN
    SELECT COUNT(*)
    INTO v_tmpl_cnt
    FROM USER_ORDS_MODULES m
    JOIN USER_ORDS_TEMPLATES t ON t.module_id = m.id
    WHERE m.name = 'girish_opd_api'
      AND t.uri_template = 'slots/doctor-generate';

    IF v_tmpl_cnt = 0 THEN
      ORDS.DEFINE_TEMPLATE(
          p_module_name => 'girish_opd_api',
          p_pattern     => 'slots/doctor-generate',
          p_priority    => 0,
          p_etag_type   => 'HASH',
          p_etag_query  => NULL,
          p_comments    => 'Per-doctor working-hours slot generation (1 day or 1 week max)');
    END IF;
  END;

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slots/doctor-generate',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Per-doctor working-hours slot generation with Asia/Kolkata expiry check',
      p_source         => '
DECLARE
    v_doctor_id     NUMBER;
    v_start_date    DATE;
    v_days          NUMBER;
    v_duration_mins NUMBER;
    v_work_start    VARCHAR2(5);
    v_work_end      VARCHAR2(5);
    v_ist_now       DATE := CAST((SYSTIMESTAMP AT TIME ZONE ''Asia/Kolkata'') AS DATE);
    v_now_hhmm      VARCHAR2(5);
    v_cur_date      DATE;
    v_slot_date     DATE;
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
        v_norm NUMBER := MOD(p_mins, 1440);
    BEGIN
        RETURN LPAD(TRUNC(v_norm / 60), 2, ''0'') || '':'' || LPAD(MOD(v_norm, 60), 2, ''0'');
    END to_hhmm;
BEGIN
    v_now_hhmm := TO_CHAR(v_ist_now, ''HH24:MI'');
    APEX_JSON.PARSE(:body_text);
    v_doctor_id     := APEX_JSON.GET_NUMBER(''doctor_id'');
    v_start_date    := NVL(TO_DATE(APEX_JSON.GET_VARCHAR2(''start_date''), ''YYYY-MM-DD''), TRUNC(v_ist_now));
    v_days          := NVL(APEX_JSON.GET_NUMBER(''days''), 1);
    v_duration_mins := NVL(APEX_JSON.GET_NUMBER(''duration_mins''), 30);
    v_work_start    := NVL(TRIM(APEX_JSON.GET_VARCHAR2(''work_start'')), ''09:00'');
    v_work_end      := NVL(TRIM(APEX_JSON.GET_VARCHAR2(''work_end'')), ''17:00'');

    IF v_doctor_id IS NULL THEN
        HTP.P(''{"status":"error","message":"doctor_id is required"}'');
        RETURN;
    END IF;
    IF TRUNC(v_start_date) < TRUNC(v_ist_now) THEN
        HTP.P(''{"status":"error","message":"Cannot generate slots for past dates"}'');
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
                        IF v_end_min < v_cur_min THEN
                            v_end_min := v_end_min + 1440;
                        END IF;
                        WHILE v_cur_min <> v_end_min AND v_cur_min + t.dur <= v_end_min LOOP
                            v_slot_date := v_cur_date + TRUNC(v_cur_min / 1440);
                            v_s_time := to_hhmm(v_cur_min);
                            v_e_time := to_hhmm(v_cur_min + t.dur);
                            IF v_slot_date > TRUNC(v_ist_now) OR (v_slot_date = TRUNC(v_ist_now) AND v_s_time > v_now_hhmm) THEN
                                SELECT COUNT(*) INTO v_exists
                                FROM GIRISH_SLOTS
                                WHERE template_id = t.template_id
                                  AND TRUNC(slot_date) = v_slot_date
                                  AND start_time = v_s_time
                                  AND status <> ''CANCELLED'';
                                IF v_exists = 0 THEN
                                    INSERT INTO GIRISH_SLOTS (
                                        template_id, slot_date, start_time, end_time,
                                        max_patients_per_slot, booked_patients, status
                                    ) VALUES (
                                        t.template_id, v_slot_date, v_s_time, v_e_time, 1, 0, ''AVAILABLE''
                                    );
                                    v_created := v_created + 1;
                                END IF;
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
                    IF v_end_min < v_cur_min THEN
                        v_end_min := v_end_min + 1440;
                    END IF;
                    WHILE v_cur_min <> v_end_min AND v_cur_min + v_duration_mins <= v_end_min LOOP
                        v_slot_date := v_cur_date + TRUNC(v_cur_min / 1440);
                        v_s_time := to_hhmm(v_cur_min);
                        v_e_time := to_hhmm(v_cur_min + v_duration_mins);
                        IF v_slot_date > TRUNC(v_ist_now) OR (v_slot_date = TRUNC(v_ist_now) AND v_s_time > v_now_hhmm) THEN
                            INSERT INTO GIRISH_SLOTS (
                                template_id, slot_date, start_time, end_time,
                                max_patients_per_slot, booked_patients, status
                            ) VALUES (
                                v_tmpl_id, v_slot_date, v_s_time, v_e_time, 1, 0, ''AVAILABLE''
                            );
                            v_created := v_created + 1;
                        END IF;
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
END;'
  );

  COMMIT;
END;
/

-- Verification query
SELECT column_name, data_type, nullable, data_default
FROM USER_TAB_COLUMNS
WHERE TABLE_NAME = 'GIRISH_APPOINTMENTS'
  AND COLUMN_NAME IN ('CONSULTATION_MODE', 'RESCHEDULED_FROM_ID');
