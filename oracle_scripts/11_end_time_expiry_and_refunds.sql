-- =====================================================================
-- 11_end_time_expiry_and_refunds.sql
-- PURPOSE :
--   1) Update POST appointments/, POST slots, and POST slots/doctor-generate
--      ORDS handlers in Asia/Kolkata (IST) so slots remain open/bookable
--      until END_TIME (not START_TIME), including cross-midnight slots.
--      For example, a 13:00-13:20 slot stays active & re-bookable on cancel
--      until 13:20 IST, and only expires once 13:20 IST is reached.
-- SAFE    : Idempotent ORDS.DEFINE_HANDLER updates.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

BEGIN
  -- 1. POST appointments/: validate Asia/Kolkata END_TIME (not start_time)
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'appointments/',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Book appointment with consultation_mode and IST slot end_time validation',
      p_source         => '
DECLARE
    V_PATIENT_ID        NUMBER;
    V_SLOT_ID           NUMBER;
    V_BOOKING_SOURCE    VARCHAR2(20);
    V_CONSULT_MODE      VARCHAR2(20);
    V_APPOINTMENT_REF   VARCHAR2(20);
    V_SLOT_DATE         DATE;
    V_START_TIME        VARCHAR2(10);
    V_END_TIME          VARCHAR2(10);
    V_SLOT_END_DT       DATE;
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

    SELECT TRUNC(slot_date), start_time, NVL(end_time, start_time), status
    INTO V_SLOT_DATE, V_START_TIME, V_END_TIME, V_SLOT_STATUS
    FROM GIRISH_SLOTS
    WHERE slot_id = V_SLOT_ID;

    IF V_SLOT_STATUS <> ''AVAILABLE'' THEN
        RAISE_APPLICATION_ERROR(-20004, ''Selected slot is no longer available'');
    END IF;

    V_SLOT_END_DT := TO_DATE(
        TO_CHAR(V_SLOT_DATE, ''YYYY-MM-DD'') || '' '' || SUBSTR(TRIM(V_END_TIME), 1, 5),
        ''YYYY-MM-DD HH24:MI''
    );
    IF V_END_TIME <= V_START_TIME THEN
        V_SLOT_END_DT := V_SLOT_END_DT + 1;
    END IF;

    IF V_SLOT_END_DT <= V_IST_NOW THEN
        RAISE_APPLICATION_ERROR(-20005, ''Selected slot end time has already passed'');
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

  -- 2. POST slots: expire only after END_TIME on today's date (Asia/Kolkata)
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slots',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Create single slot with Asia/Kolkata end_time expiry validation',
      p_source         => '
DECLARE
    v_slot_date   DATE := TRUNC(TO_DATE(:slot_date, ''YYYY-MM-DD''));
    v_end_time    VARCHAR2(10) := NVL(TRIM(:end_time), TRIM(:start_time));
    v_slot_end_dt DATE;
    v_ist_now     DATE := CAST((SYSTIMESTAMP AT TIME ZONE ''Asia/Kolkata'') AS DATE);
BEGIN
    v_slot_end_dt := TO_DATE(
        TO_CHAR(v_slot_date, ''YYYY-MM-DD'') || '' '' || SUBSTR(v_end_time, 1, 5),
        ''YYYY-MM-DD HH24:MI''
    );
    IF v_end_time <= TRIM(:start_time) THEN
        v_slot_end_dt := v_slot_end_dt + 1;
    END IF;

    IF v_slot_end_dt <= v_ist_now THEN
        HTP.P(''{"status":"error","message":"Cannot generate slots whose end time is at or before current hospital time"}'');
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

  -- 3. POST slots/doctor-generate: expire only when slot END_TIME has passed (Asia/Kolkata)
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'slots/doctor-generate',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Per-doctor working-hours slot generation with Asia/Kolkata end_time expiry check',
      p_source         => '
DECLARE
    v_doctor_id     NUMBER;
    v_start_date    DATE;
    v_days          NUMBER;
    v_duration_mins NUMBER;
    v_work_start    VARCHAR2(5);
    v_work_end      VARCHAR2(5);
    v_ist_now       DATE := CAST((SYSTIMESTAMP AT TIME ZONE ''Asia/Kolkata'') AS DATE);
    v_cur_date      DATE;
    v_slot_date     DATE;
    v_slot_end_dt   DATE;
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
                            v_slot_end_dt := TO_DATE(TO_CHAR(v_slot_date, ''YYYY-MM-DD'') || '' '' || v_e_time, ''YYYY-MM-DD HH24:MI'');
                            IF v_e_time <= v_s_time THEN
                                v_slot_end_dt := v_slot_end_dt + 1;
                            END IF;
                            IF v_slot_end_dt > v_ist_now THEN
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
                        v_slot_end_dt := TO_DATE(TO_CHAR(v_slot_date, ''YYYY-MM-DD'') || '' '' || v_e_time, ''YYYY-MM-DD HH24:MI'');
                        IF v_e_time <= v_s_time THEN
                            v_slot_end_dt := v_slot_end_dt + 1;
                        END IF;
                        IF v_slot_end_dt > v_ist_now THEN
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
