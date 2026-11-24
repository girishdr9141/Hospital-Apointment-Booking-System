-- =====================================================================
-- 12_clinical_and_shift_tables.sql
-- PURPOSE :
--   1) Create normalized Oracle tables for features previously stored in JSON:
--        - GIRISH_MEDICAL_RECORDS
--        - GIRISH_PRESCRIPTIONS
--        - GIRISH_DOCTOR_SHIFT_WINDOWS
--        - GIRISH_SHIFT_CHANGE_REQUESTS
--   2) Safely seed initial sample rows (guarded by parent FK existence checks).
--   3) Define ORDS REST templates & handlers on module 'girish_opd_api' for:
--        - GET/POST medical-records, PUT/DELETE medical-records/:id
--        - GET/POST prescriptions, PUT/DELETE prescriptions/:id
--        - GET/POST doctor-shifts
--        - GET/POST shift-change-requests, POST shift-change-requests/:id/decide
-- SAFE    : Idempotent (checks USER_TABLES / USER_INDEXES / MERGE INTO).
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: Tables & Indexes (Idempotent)
-- ---------------------------------------------------------------------
DECLARE
    v_cnt NUMBER := 0;
BEGIN
    -- 1. GIRISH_MEDICAL_RECORDS
    SELECT COUNT(*) INTO v_cnt FROM USER_TABLES WHERE TABLE_NAME = 'GIRISH_MEDICAL_RECORDS';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE '
            CREATE TABLE GIRISH_MEDICAL_RECORDS (
                RECORD_ID       VARCHAR2(40)  NOT NULL,
                PATIENT_ID      NUMBER        NOT NULL,
                PATIENT_NAME    VARCHAR2(200) NOT NULL,
                DOCTOR_ID       NUMBER        NULL,
                DOCTOR_NAME     VARCHAR2(200) NOT NULL,
                APPOINTMENT_ID  NUMBER        NULL,
                APPOINTMENT_REF VARCHAR2(30)  NULL,
                VISIT_DATE      DATE          NOT NULL,
                CHIEF_COMPLAINT VARCHAR2(500) NOT NULL,
                DIAGNOSIS       VARCHAR2(500) NOT NULL,
                VITALS_SUMMARY  VARCHAR2(500) NULL,
                CLINICAL_NOTES  CLOB          NULL,
                CREATED_ON      TIMESTAMP(6)  DEFAULT CURRENT_TIMESTAMP NOT NULL,
                UPDATED_ON      TIMESTAMP(6)  DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT PK_GIRISH_MED_REC PRIMARY KEY (RECORD_ID),
                CONSTRAINT FK_GMR_PATIENT FOREIGN KEY (PATIENT_ID) REFERENCES GIRISH_PATIENTS (PATIENT_ID),
                CONSTRAINT FK_GMR_DOCTOR  FOREIGN KEY (DOCTOR_ID)  REFERENCES GIRISH_DOCTORS (DOCTOR_ID),
                CONSTRAINT FK_GMR_APPT    FOREIGN KEY (APPOINTMENT_ID) REFERENCES GIRISH_APPOINTMENTS (APPOINTMENT_ID)
            )
        ';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GMR_PATIENT';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GMR_PATIENT ON GIRISH_MEDICAL_RECORDS (PATIENT_ID)';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GMR_DOCTOR';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GMR_DOCTOR ON GIRISH_MEDICAL_RECORDS (DOCTOR_ID)';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GMR_VISIT_DATE';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GMR_VISIT_DATE ON GIRISH_MEDICAL_RECORDS (VISIT_DATE)';
    END IF;

    -- 2. GIRISH_PRESCRIPTIONS
    SELECT COUNT(*) INTO v_cnt FROM USER_TABLES WHERE TABLE_NAME = 'GIRISH_PRESCRIPTIONS';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE '
            CREATE TABLE GIRISH_PRESCRIPTIONS (
                PRESCRIPTION_ID  VARCHAR2(40)  NOT NULL,
                PATIENT_ID       NUMBER        NOT NULL,
                PATIENT_NAME     VARCHAR2(200) NOT NULL,
                DOCTOR_ID        NUMBER        NULL,
                DOCTOR_NAME      VARCHAR2(200) NOT NULL,
                APPOINTMENT_ID   NUMBER        NULL,
                APPOINTMENT_REF  VARCHAR2(30)  NULL,
                PRESCRIBED_DATE  DATE          NOT NULL,
                DIAGNOSIS        VARCHAR2(500) NOT NULL,
                MEDICATIONS_JSON CLOB          NOT NULL,
                INSTRUCTIONS     CLOB          NULL,
                STATUS           VARCHAR2(20)  DEFAULT ''ACTIVE'' NOT NULL,
                IDEMPOTENCY_KEY  VARCHAR2(150) NULL,
                CREATED_ON       TIMESTAMP(6)  DEFAULT CURRENT_TIMESTAMP NOT NULL,
                UPDATED_ON       TIMESTAMP(6)  DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT PK_GIRISH_RX PRIMARY KEY (PRESCRIPTION_ID),
                CONSTRAINT CHK_GRX_STATUS CHECK (STATUS IN (''ACTIVE'', ''COMPLETED'')),
                CONSTRAINT UQ_GRX_IDEM UNIQUE (IDEMPOTENCY_KEY),
                CONSTRAINT FK_GRX_PATIENT FOREIGN KEY (PATIENT_ID) REFERENCES GIRISH_PATIENTS (PATIENT_ID),
                CONSTRAINT FK_GRX_DOCTOR  FOREIGN KEY (DOCTOR_ID)  REFERENCES GIRISH_DOCTORS (DOCTOR_ID),
                CONSTRAINT FK_GRX_APPT    FOREIGN KEY (APPOINTMENT_ID) REFERENCES GIRISH_APPOINTMENTS (APPOINTMENT_ID)
            )
        ';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GRX_PATIENT';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GRX_PATIENT ON GIRISH_PRESCRIPTIONS (PATIENT_ID)';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GRX_DOCTOR';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GRX_DOCTOR ON GIRISH_PRESCRIPTIONS (DOCTOR_ID)';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GRX_DATE';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GRX_DATE ON GIRISH_PRESCRIPTIONS (PRESCRIBED_DATE)';
    END IF;

    -- 3. GIRISH_DOCTOR_SHIFT_WINDOWS
    SELECT COUNT(*) INTO v_cnt FROM USER_TABLES WHERE TABLE_NAME = 'GIRISH_DOCTOR_SHIFT_WINDOWS';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE '
            CREATE TABLE GIRISH_DOCTOR_SHIFT_WINDOWS (
                SHIFT_ID           NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY NOT NULL,
                DOCTOR_ID          NUMBER        NOT NULL,
                DOCTOR_NAME        VARCHAR2(200) NOT NULL,
                SESSIONS_JSON      CLOB          NOT NULL,
                SLOT_DURATION_MINS NUMBER        NOT NULL,
                WORKING_DAYS       VARCHAR2(200) NOT NULL,
                IS_REGISTERED      CHAR(1)       DEFAULT ''Y'' NOT NULL,
                REGISTERED_AT      TIMESTAMP(6)  DEFAULT CURRENT_TIMESTAMP NOT NULL,
                UPDATED_ON         TIMESTAMP(6)  DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT PK_GIRISH_DOC_SHIFT PRIMARY KEY (SHIFT_ID),
                CONSTRAINT UQ_GDSW_DOCTOR UNIQUE (DOCTOR_ID),
                CONSTRAINT CHK_GDSW_DUR CHECK (SLOT_DURATION_MINS BETWEEN 10 AND 120),
                CONSTRAINT CHK_GDSW_REG CHECK (IS_REGISTERED IN (''Y'', ''N'')),
                CONSTRAINT FK_GDSW_DOCTOR FOREIGN KEY (DOCTOR_ID) REFERENCES GIRISH_DOCTORS (DOCTOR_ID)
            )
        ';
    END IF;

    -- 4. GIRISH_SHIFT_CHANGE_REQUESTS
    SELECT COUNT(*) INTO v_cnt FROM USER_TABLES WHERE TABLE_NAME = 'GIRISH_SHIFT_CHANGE_REQUESTS';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE '
            CREATE TABLE GIRISH_SHIFT_CHANGE_REQUESTS (
                REQUEST_ID                   VARCHAR2(40)   NOT NULL,
                DOCTOR_ID                    NUMBER         NOT NULL,
                DOCTOR_NAME                  VARCHAR2(200)  NOT NULL,
                CURRENT_SESSIONS_JSON        CLOB           NOT NULL,
                CURRENT_SLOT_DURATION_MINS   NUMBER         NOT NULL,
                CURRENT_WORKING_DAYS         VARCHAR2(200)  NOT NULL,
                REQUESTED_SESSIONS_JSON      CLOB           NOT NULL,
                REQUESTED_SLOT_DURATION_MINS NUMBER         NOT NULL,
                REQUESTED_WORKING_DAYS       VARCHAR2(200)  NOT NULL,
                REASON                       VARCHAR2(1000) NOT NULL,
                STATUS                       VARCHAR2(20)   DEFAULT ''PENDING'' NOT NULL,
                REQUESTED_ON                 TIMESTAMP(6)   DEFAULT CURRENT_TIMESTAMP NOT NULL,
                DECIDED_ON                   TIMESTAMP(6)   NULL,
                DECIDED_BY                   VARCHAR2(150)  NULL,
                DECISION_COMMENTS            VARCHAR2(1000) NULL,
                CONSTRAINT PK_GIRISH_SHIFT_REQ PRIMARY KEY (REQUEST_ID),
                CONSTRAINT CHK_GSCR_DUR CHECK (REQUESTED_SLOT_DURATION_MINS BETWEEN 10 AND 120),
                CONSTRAINT CHK_GSCR_STATUS CHECK (STATUS IN (''PENDING'', ''APPROVED'', ''REJECTED'')),
                CONSTRAINT FK_GSCR_DOCTOR FOREIGN KEY (DOCTOR_ID) REFERENCES GIRISH_DOCTORS (DOCTOR_ID)
            )
        ';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GSCR_DOCTOR';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GSCR_DOCTOR ON GIRISH_SHIFT_CHANGE_REQUESTS (DOCTOR_ID)';
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM USER_INDEXES WHERE INDEX_NAME = 'IDX_GSCR_STATUS';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'CREATE INDEX IDX_GSCR_STATUS ON GIRISH_SHIFT_CHANGE_REQUESTS (STATUS)';
    END IF;

    COMMIT;
END;
/

-- ---------------------------------------------------------------------
-- PART 2: Safe Initial Seed Migration (Guarded by FK existence)
-- ---------------------------------------------------------------------
BEGIN
    -- Seed initial Medical Records if patient exists
    MERGE INTO GIRISH_MEDICAL_RECORDS tgt
    USING (
        SELECT 'MR-1001' AS record_id, 1 AS patient_id, 'John Doe' AS patient_name,
               2 AS doctor_id, 'Dr. Priya Sharma' AS doctor_name, 'APT-2026-001' AS appointment_ref,
               DATE '2026-11-10' AS visit_date,
               'Intermittent tension headaches and morning dizziness for 5 days' AS chief_complaint,
               'Primary Tension-Type Headache / Mild Cervical Strain' AS diagnosis,
               'BP 118/76 mmHg · Pulse 74 bpm · Temp 98.4°F · SpO2 99%' AS vitals_summary,
               'Neurological exam intact; cranial nerves II-XII normal. Advised hydration, screen ergonomics, and follow-up if aura or photophobia develops.' AS clinical_notes
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_PATIENTS WHERE patient_id = 1)
        UNION ALL
        SELECT 'MR-1002', 22, 'Amit Verma', 3, 'Dr. Anil Mehta', 'APT-2026-014', DATE '2026-11-12',
               'Right knee stiffness and pain when climbing stairs',
               'Early Patellofemoral Chondromalacia',
               'BP 124/80 mmHg · Pulse 78 bpm · BMI 24.6',
               'Mild crepitus on extension without joint effusion. Recommended quadriceps strengthening physiotherapy for 3 weeks and reduced high-impact running.'
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_PATIENTS WHERE patient_id = 22)
        UNION ALL
        SELECT 'MR-1003', 23, 'Sneha Reddy', 2, 'Dr. Priya Sharma', 'APT-2026-019', DATE '2026-11-14',
               'Recurring migraine episodes triggered by sleep disruption',
               'Episodic Migraine without Aura',
               'BP 112/72 mmHg · Pulse 70 bpm · SpO2 99%',
               'Reviewed trigger diary. Prescribed acute abortive therapy and regular sleep hygiene routine. Schedule review after 14 days.'
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_PATIENTS WHERE patient_id = 23)
        UNION ALL
        SELECT 'MR-1004', 61, 'Arjun Nair', 3, 'Dr. Anil Mehta', 'APT-2026-022', DATE '2026-11-15',
               'Post-sprain left ankle follow-up evaluation',
               'Recovering Grade I Lateral Ankle Sprain',
               'BP 120/78 mmHg · Pulse 72 bpm · Temp 98.2°F',
               'Swelling markedly subsided; full weight-bearing achieved without antalgic gait. Cleared for light walking and gradual ankle proprioception exercises.'
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_PATIENTS WHERE patient_id = 61)
    ) src
    ON (tgt.record_id = src.record_id)
    WHEN NOT MATCHED THEN
        INSERT (record_id, patient_id, patient_name, doctor_id, doctor_name, appointment_ref, visit_date, chief_complaint, diagnosis, vitals_summary, clinical_notes)
        VALUES (
            src.record_id,
            src.patient_id,
            src.patient_name,
            CASE WHEN EXISTS (SELECT 1 FROM GIRISH_DOCTORS d WHERE d.doctor_id = src.doctor_id) THEN src.doctor_id ELSE NULL END,
            src.doctor_name,
            src.appointment_ref,
            src.visit_date,
            src.chief_complaint,
            src.diagnosis,
            src.vitals_summary,
            src.clinical_notes
        );

    -- Seed initial Prescriptions if patient exists
    MERGE INTO GIRISH_PRESCRIPTIONS tgt
    USING (
        SELECT 'RX-2001' AS prescription_id, 1 AS patient_id, 'John Doe' AS patient_name,
               2 AS doctor_id, 'Dr. Priya Sharma' AS doctor_name, 'APT-2026-001' AS appointment_ref,
               DATE '2026-11-10' AS prescribed_date,
               'Primary Tension-Type Headache' AS diagnosis,
               '[{"name":"Paracetamol 650mg","dosage":"1 tablet","frequency":"SOS (max 3/day)","duration":"5 days"},{"name":"Magnesium Glycinate 200mg","dosage":"1 capsule","frequency":"Once nightly","duration":"14 days"}]' AS medications_json,
               'Take after meals with water. Maintain 2.5L daily fluid intake and 15-minute screen breaks.' AS instructions,
               'ACTIVE' AS status
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_PATIENTS WHERE patient_id = 1)
        UNION ALL
        SELECT 'RX-2002', 22, 'Amit Verma', 3, 'Dr. Anil Mehta', 'APT-2026-014', DATE '2026-11-12',
               'Early Patellofemoral Chondromalacia',
               '[{"name":"Diclofenac Gel 1%","dosage":"Topical thin layer","frequency":"Twice daily","duration":"10 days"},{"name":"Calcium + Vitamin D3","dosage":"1 tablet","frequency":"Once daily after lunch","duration":"30 days"}]',
               'Apply topical gel gently around knee cap without vigorous massage. Continue isometric quad sets.',
               'ACTIVE'
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_PATIENTS WHERE patient_id = 22)
        UNION ALL
        SELECT 'RX-2003', 23, 'Sneha Reddy', 2, 'Dr. Priya Sharma', 'APT-2026-019', DATE '2026-11-14',
               'Episodic Migraine without Aura',
               '[{"name":"Sumatriptan 50mg","dosage":"1 tablet","frequency":"At headache onset (max 2/day)","duration":"As needed"},{"name":"Riboflavin (Vit B2) 400mg","dosage":"1 capsule","frequency":"Once daily morning","duration":"30 days"}]',
               'Rest in a quiet dark room after taking abortive dose. Avoid skipping meals.',
               'ACTIVE'
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_PATIENTS WHERE patient_id = 23)
    ) src
    ON (tgt.prescription_id = src.prescription_id)
    WHEN NOT MATCHED THEN
        INSERT (prescription_id, patient_id, patient_name, doctor_id, doctor_name, appointment_ref, prescribed_date, diagnosis, medications_json, instructions, status)
        VALUES (
            src.prescription_id,
            src.patient_id,
            src.patient_name,
            CASE WHEN EXISTS (SELECT 1 FROM GIRISH_DOCTORS d WHERE d.doctor_id = src.doctor_id) THEN src.doctor_id ELSE NULL END,
            src.doctor_name,
            src.appointment_ref,
            src.prescribed_date,
            src.diagnosis,
            src.medications_json,
            src.instructions,
            src.status
        );

    -- Seed Doctor Shift Windows if doctor exists
    MERGE INTO GIRISH_DOCTOR_SHIFT_WINDOWS tgt
    USING (
        SELECT 2 AS doctor_id, 'Dr. Priya Sharma' AS doctor_name,
               '[{"start_time":"09:00","end_time":"12:00"},{"start_time":"14:00","end_time":"17:00"}]' AS sessions_json,
               30 AS slot_duration_mins,
               'FRIDAY,MONDAY,SUNDAY,THURSDAY,TUESDAY,WEDNESDAY' AS working_days
        FROM dual WHERE EXISTS (SELECT 1 FROM GIRISH_DOCTORS WHERE doctor_id = 2)
        UNION ALL
        SELECT 3, 'Dr. Anil Mehta',
               '[{"start_time":"17:00","end_time":"20:00"},{"start_time":"22:00","end_time":"01:00"}]',
               30,
               'FRIDAY,SUNDAY,THURSDAY,TUESDAY,SATURDAY'
        FROM dual WHERE EXISTS (SELECT 1 FROM GIRISH_DOCTORS WHERE doctor_id = 3)
        UNION ALL
        SELECT 5, 'Dr. Vikram Rao',
               '[{"start_time":"09:00","end_time":"11:00"},{"start_time":"13:00","end_time":"17:00"}]',
               15,
               'FRIDAY,MONDAY,THURSDAY,TUESDAY,WEDNESDAY'
        FROM dual WHERE EXISTS (SELECT 1 FROM GIRISH_DOCTORS WHERE doctor_id = 5)
        UNION ALL
        SELECT 46, 'Dr. Rohit Ramachandra',
               '[{"start_time":"10:00","end_time":"15:20"}]',
               20,
               'FRIDAY,MONDAY,THURSDAY,TUESDAY,WEDNESDAY'
        FROM dual WHERE EXISTS (SELECT 1 FROM GIRISH_DOCTORS WHERE doctor_id = 46)
    ) src
    ON (tgt.doctor_id = src.doctor_id)
    WHEN NOT MATCHED THEN
        INSERT (doctor_id, doctor_name, sessions_json, slot_duration_mins, working_days, is_registered)
        VALUES (src.doctor_id, src.doctor_name, src.sessions_json, src.slot_duration_mins, src.working_days, 'Y');

    -- Seed historical Shift Change Request if doctor 46 exists
    MERGE INTO GIRISH_SHIFT_CHANGE_REQUESTS tgt
    USING (
        SELECT 'SCR-1794762901927' AS request_id, 46 AS doctor_id, 'Dr. Rohit Ramachandra' AS doctor_name,
               '[{"start_time":"13:00","end_time":"14:20"},{"start_time":"15:00","end_time":"16:00"}]' AS current_sessions_json,
               20 AS current_slot_duration_mins,
               'FRIDAY,MONDAY,THURSDAY,TUESDAY,WEDNESDAY' AS current_working_days,
               '[{"start_time":"10:00","end_time":"15:20"}]' AS requested_sessions_json,
               20 AS requested_slot_duration_mins,
               'FRIDAY,MONDAY,THURSDAY,TUESDAY,WEDNESDAY' AS requested_working_days,
               'Personal' AS reason,
               'APPROVED' AS status,
               'Girish DR' AS decided_by,
               'ok' AS decision_comments
        FROM dual
        WHERE EXISTS (SELECT 1 FROM GIRISH_DOCTORS WHERE doctor_id = 46)
    ) src
    ON (tgt.request_id = src.request_id)
    WHEN NOT MATCHED THEN
        INSERT (request_id, doctor_id, doctor_name, current_sessions_json, current_slot_duration_mins, current_working_days, requested_sessions_json, requested_slot_duration_mins, requested_working_days, reason, status, decided_on, decided_by, decision_comments)
        VALUES (src.request_id, src.doctor_id, src.doctor_name, src.current_sessions_json, src.current_slot_duration_mins, src.current_working_days, src.requested_sessions_json, src.requested_slot_duration_mins, src.requested_working_days, src.reason, src.status, CURRENT_TIMESTAMP, src.decided_by, src.decision_comments);

    COMMIT;
END;
/

-- ---------------------------------------------------------------------
-- PART 3: ORDS Templates & Handlers on module 'girish_opd_api'
-- ---------------------------------------------------------------------
BEGIN
  -- 1. Medical Records (GET, POST)
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'medical-records',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Medical records collection');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'medical-records',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'List medical records',
      p_source         => '
SELECT record_id,
       patient_id,
       patient_name,
       doctor_id,
       doctor_name,
       appointment_id,
       appointment_ref,
       TO_CHAR(visit_date, ''YYYY-MM-DD'') AS visit_date,
       chief_complaint,
       diagnosis,
       vitals_summary,
       clinical_notes,
       TO_CHAR(updated_on, ''YYYY-MM-DD"T"HH24:MI:SS"Z"'') AS updated_at
FROM GIRISH_MEDICAL_RECORDS
ORDER BY visit_date DESC, updated_on DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'medical-records',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Create medical record',
      p_source         => '
DECLARE
    v_record_id       VARCHAR2(40);
    v_patient_id      NUMBER;
    v_patient_name    VARCHAR2(200);
    v_doctor_id       NUMBER;
    v_doctor_name     VARCHAR2(200);
    v_appointment_ref VARCHAR2(30);
    v_appointment_id  NUMBER := NULL;
    v_visit_date      DATE;
    v_complaint       VARCHAR2(500);
    v_diagnosis       VARCHAR2(500);
    v_vitals          VARCHAR2(500);
    v_notes           CLOB;
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_record_id       := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''record_id''), ''''));
    IF v_record_id IS NULL THEN
        v_record_id := ''MR-'' || TO_CHAR(SYSTIMESTAMP, ''YYYYMMDDHH24MISSFF3'');
    END IF;
    v_patient_id      := APEX_JSON.GET_NUMBER(''patient_id'');
    v_patient_name    := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''patient_name''), ''Patient #'' || v_patient_id));
    v_doctor_id       := APEX_JSON.GET_NUMBER(''doctor_id'');
    v_doctor_name     := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''doctor_name''), ''Doctor #'' || v_doctor_id));
    v_appointment_ref := TRIM(APEX_JSON.GET_VARCHAR2(''appointment_ref''));
    v_visit_date      := TO_DATE(SUBSTR(NVL(APEX_JSON.GET_VARCHAR2(''visit_date''), TO_CHAR(SYSDATE, ''YYYY-MM-DD'')), 1, 10), ''YYYY-MM-DD'');
    v_complaint       := TRIM(APEX_JSON.GET_VARCHAR2(''chief_complaint''));
    v_diagnosis       := TRIM(APEX_JSON.GET_VARCHAR2(''diagnosis''));
    v_vitals          := TRIM(APEX_JSON.GET_VARCHAR2(''vitals_summary''));
    v_notes           := APEX_JSON.GET_CLOB(''clinical_notes'');

    IF v_patient_id IS NULL OR v_complaint IS NULL OR v_diagnosis IS NULL THEN
        RAISE_APPLICATION_ERROR(-20101, ''Patient, chief complaint, and diagnosis are required'');
    END IF;

    IF v_appointment_ref IS NOT NULL THEN
        BEGIN
            SELECT appointment_id INTO v_appointment_id
            FROM GIRISH_APPOINTMENTS
            WHERE appointment_ref = v_appointment_ref
            FETCH FIRST 1 ROWS ONLY;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN v_appointment_id := NULL;
        END;
    END IF;

    INSERT INTO GIRISH_MEDICAL_RECORDS (
        record_id, patient_id, patient_name, doctor_id, doctor_name,
        appointment_id, appointment_ref, visit_date, chief_complaint,
        diagnosis, vitals_summary, clinical_notes
    ) VALUES (
        v_record_id, v_patient_id, v_patient_name, v_doctor_id, v_doctor_name,
        v_appointment_id, v_appointment_ref, v_visit_date, v_complaint,
        v_diagnosis, v_vitals, NVL(v_notes, ''Recorded during OPD consultation.'')
    );

    COMMIT;
    HTP.P(''{"status":"success","record_id":'' || jstr(v_record_id) || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  -- 2. Medical Records Item (PUT, DELETE)
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'medical-records/:id',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Single medical record operations');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'medical-records/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Update medical record',
      p_source         => '
DECLARE
    v_complaint VARCHAR2(500);
    v_diagnosis VARCHAR2(500);
    v_vitals    VARCHAR2(500);
    v_notes     CLOB;
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_complaint := TRIM(APEX_JSON.GET_VARCHAR2(''chief_complaint''));
    v_diagnosis := TRIM(APEX_JSON.GET_VARCHAR2(''diagnosis''));
    v_vitals    := TRIM(APEX_JSON.GET_VARCHAR2(''vitals_summary''));
    v_notes     := APEX_JSON.GET_CLOB(''clinical_notes'');

    UPDATE GIRISH_MEDICAL_RECORDS
    SET chief_complaint = NVL(v_complaint, chief_complaint),
        diagnosis       = NVL(v_diagnosis, diagnosis),
        vitals_summary  = CASE WHEN APEX_JSON.DOES_EXIST(''vitals_summary'') THEN v_vitals ELSE vitals_summary END,
        clinical_notes  = CASE WHEN APEX_JSON.DOES_EXIST(''clinical_notes'') THEN v_notes ELSE clinical_notes END,
        updated_on      = CURRENT_TIMESTAMP
    WHERE record_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        RAISE_APPLICATION_ERROR(-20102, ''Medical record not found'');
    END IF;

    COMMIT;
    HTP.P(''{"status":"success","record_id":'' || jstr(:id) || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'medical-records/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Delete medical record',
      p_source         => '
DECLARE
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    DELETE FROM GIRISH_MEDICAL_RECORDS WHERE record_id = :id;
    IF SQL%ROWCOUNT = 0 THEN
        RAISE_APPLICATION_ERROR(-20103, ''Medical record not found'');
    END IF;
    COMMIT;
    HTP.P(''{"status":"success","message":"Medical record deleted"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  -- 3. Prescriptions (GET, POST)
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'prescriptions',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Prescriptions collection');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'prescriptions',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'List prescriptions',
      p_source         => '
SELECT prescription_id,
       patient_id,
       patient_name,
       doctor_id,
       doctor_name,
       appointment_id,
       appointment_ref,
       TO_CHAR(prescribed_date, ''YYYY-MM-DD'') AS prescribed_date,
       diagnosis,
       medications_json,
       instructions,
       status,
       TO_CHAR(updated_on, ''YYYY-MM-DD"T"HH24:MI:SS"Z"'') AS updated_at
FROM GIRISH_PRESCRIPTIONS
ORDER BY prescribed_date DESC, updated_on DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'prescriptions',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Create prescription',
      p_source         => '
DECLARE
    v_rx_id           VARCHAR2(40);
    v_existing_id     VARCHAR2(40);
    v_patient_id      NUMBER;
    v_patient_name    VARCHAR2(200);
    v_doctor_id       NUMBER;
    v_doctor_name     VARCHAR2(200);
    v_appointment_ref VARCHAR2(30);
    v_appointment_id  NUMBER := NULL;
    v_prescribed_date DATE;
    v_diagnosis       VARCHAR2(500);
    v_meds_json       CLOB;
    v_med_cnt         NUMBER := 0;
    v_instructions    CLOB;
    v_status          VARCHAR2(20);
    v_idem_key        VARCHAR2(150);
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_idem_key := TRIM(APEX_JSON.GET_VARCHAR2(''idempotency_key''));
    IF v_idem_key IS NOT NULL THEN
        BEGIN
            SELECT prescription_id INTO v_existing_id
            FROM GIRISH_PRESCRIPTIONS
            WHERE idempotency_key = v_idem_key
            FETCH FIRST 1 ROWS ONLY;
            HTP.P(''{"status":"success","prescription_id":'' || jstr(v_existing_id) || '',"deduplicated":true}'');
            RETURN;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN NULL;
        END;
    END IF;

    v_rx_id := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''prescription_id''), ''''));
    IF v_rx_id IS NULL THEN
        v_rx_id := ''RX-'' || TO_CHAR(SYSTIMESTAMP, ''YYYYMMDDHH24MISSFF3'');
    END IF;
    v_patient_id      := APEX_JSON.GET_NUMBER(''patient_id'');
    v_patient_name    := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''patient_name''), ''Patient #'' || v_patient_id));
    v_doctor_id       := APEX_JSON.GET_NUMBER(''doctor_id'');
    v_doctor_name     := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''doctor_name''), ''Doctor #'' || v_doctor_id));
    v_appointment_ref := TRIM(APEX_JSON.GET_VARCHAR2(''appointment_ref''));
    v_prescribed_date := TO_DATE(SUBSTR(NVL(APEX_JSON.GET_VARCHAR2(''prescribed_date''), TO_CHAR(SYSDATE, ''YYYY-MM-DD'')), 1, 10), ''YYYY-MM-DD'');
    v_diagnosis       := TRIM(APEX_JSON.GET_VARCHAR2(''diagnosis''));
    v_meds_json       := APEX_JSON.GET_CLOB(''medications_json'');
    v_instructions    := APEX_JSON.GET_CLOB(''instructions'');
    v_status          := UPPER(TRIM(NVL(APEX_JSON.GET_VARCHAR2(''status''), ''ACTIVE'')));
    IF v_status NOT IN (''ACTIVE'', ''COMPLETED'') THEN
        v_status := ''ACTIVE'';
    END IF;

    IF v_meds_json IS NULL OR DBMS_LOB.GETLENGTH(v_meds_json) = 0 THEN
        v_med_cnt := NVL(APEX_JSON.GET_COUNT(''medications''), 0);
        IF v_med_cnt > 0 THEN
            v_meds_json := ''['';
            FOR i IN 1 .. v_med_cnt LOOP
                IF i > 1 THEN v_meds_json := v_meds_json || '',''; END IF;
                v_meds_json := v_meds_json || ''{"name":'' || jstr(APEX_JSON.GET_VARCHAR2(''medications[%d].name'', i)) ||
                               '','' || ''"dosage":'' || jstr(APEX_JSON.GET_VARCHAR2(''medications[%d].dosage'', i)) ||
                               '','' || ''"frequency":'' || jstr(APEX_JSON.GET_VARCHAR2(''medications[%d].frequency'', i)) ||
                               '','' || ''"duration":'' || jstr(APEX_JSON.GET_VARCHAR2(''medications[%d].duration'', i)) || ''}'';
            END LOOP;
            v_meds_json := v_meds_json || '']'';
        END IF;
    END IF;

    IF v_patient_id IS NULL OR v_diagnosis IS NULL OR v_meds_json IS NULL THEN
        RAISE_APPLICATION_ERROR(-20111, ''Patient, diagnosis, and medications are required'');
    END IF;

    IF v_appointment_ref IS NOT NULL THEN
        BEGIN
            SELECT appointment_id INTO v_appointment_id
            FROM GIRISH_APPOINTMENTS
            WHERE appointment_ref = v_appointment_ref
            FETCH FIRST 1 ROWS ONLY;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN v_appointment_id := NULL;
        END;
    END IF;

    INSERT INTO GIRISH_PRESCRIPTIONS (
        prescription_id, patient_id, patient_name, doctor_id, doctor_name,
        appointment_id, appointment_ref, prescribed_date, diagnosis,
        medications_json, instructions, status, idempotency_key
    ) VALUES (
        v_rx_id, v_patient_id, v_patient_name, v_doctor_id, v_doctor_name,
        v_appointment_id, v_appointment_ref, v_prescribed_date, v_diagnosis,
        v_meds_json, NVL(v_instructions, ''Take medications as directed.''), v_status, v_idem_key
    );

    COMMIT;
    HTP.P(''{"status":"success","prescription_id":'' || jstr(v_rx_id) || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  -- 4. Prescriptions Item (PUT, DELETE)
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'prescriptions/:id',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Single prescription operations');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'prescriptions/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Update prescription',
      p_source         => '
DECLARE
    v_diagnosis    VARCHAR2(500);
    v_instructions CLOB;
    v_status       VARCHAR2(20);
    v_meds_json    CLOB;
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_diagnosis    := TRIM(APEX_JSON.GET_VARCHAR2(''diagnosis''));
    v_instructions := APEX_JSON.GET_CLOB(''instructions'');
    v_status       := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''status'')));
    v_meds_json    := APEX_JSON.GET_CLOB(''medications_json'');

    UPDATE GIRISH_PRESCRIPTIONS
    SET diagnosis        = NVL(v_diagnosis, diagnosis),
        instructions     = CASE WHEN APEX_JSON.DOES_EXIST(''instructions'') THEN v_instructions ELSE instructions END,
        status           = CASE WHEN v_status IN (''ACTIVE'', ''COMPLETED'') THEN v_status ELSE status END,
        medications_json = CASE WHEN v_meds_json IS NOT NULL AND DBMS_LOB.GETLENGTH(v_meds_json) > 0 THEN v_meds_json ELSE medications_json END,
        updated_on       = CURRENT_TIMESTAMP
    WHERE prescription_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        RAISE_APPLICATION_ERROR(-20112, ''Prescription not found'');
    END IF;

    COMMIT;
    HTP.P(''{"status":"success","prescription_id":'' || jstr(:id) || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'prescriptions/:id',
      p_method         => 'DELETE',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Delete prescription',
      p_source         => '
DECLARE
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    DELETE FROM GIRISH_PRESCRIPTIONS WHERE prescription_id = :id;
    IF SQL%ROWCOUNT = 0 THEN
        RAISE_APPLICATION_ERROR(-20113, ''Prescription not found'');
    END IF;
    COMMIT;
    HTP.P(''{"status":"success","message":"Prescription deleted"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  -- 5. Doctor Shift Windows (GET, POST upsert)
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'doctor-shifts',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Doctor shift windows collection');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'doctor-shifts',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'List doctor shift windows',
      p_source         => '
SELECT shift_id,
       doctor_id,
       doctor_name,
       sessions_json,
       slot_duration_mins,
       working_days,
       is_registered,
       TO_CHAR(registered_at, ''YYYY-MM-DD"T"HH24:MI:SS"Z"'') AS registered_at,
       TO_CHAR(updated_on, ''YYYY-MM-DD"T"HH24:MI:SS"Z"'') AS updated_at
FROM GIRISH_DOCTOR_SHIFT_WINDOWS
ORDER BY doctor_id ASC');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'doctor-shifts',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Upsert doctor shift window',
      p_source         => '
DECLARE
    v_doctor_id     NUMBER;
    v_doctor_name   VARCHAR2(200);
    v_sessions_json CLOB;
    v_duration      NUMBER;
    v_working_days  VARCHAR2(200);
    v_is_reg        CHAR(1);
    v_cnt           NUMBER := 0;
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_doctor_id     := APEX_JSON.GET_NUMBER(''doctor_id'');
    v_doctor_name   := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''doctor_name''), ''Doctor #'' || v_doctor_id));
    v_sessions_json := APEX_JSON.GET_CLOB(''sessions_json'');
    v_duration      := NVL(APEX_JSON.GET_NUMBER(''slot_duration_mins''), 30);
    v_working_days  := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''working_days_csv'')));
    v_is_reg        := CASE WHEN UPPER(NVL(APEX_JSON.GET_VARCHAR2(''is_registered''), ''Y'')) = ''N'' THEN ''N'' ELSE ''Y'' END;

    IF v_sessions_json IS NULL OR DBMS_LOB.GETLENGTH(v_sessions_json) = 0 THEN
        v_cnt := NVL(APEX_JSON.GET_COUNT(''sessions''), 0);
        IF v_cnt > 0 THEN
            v_sessions_json := ''['';
            FOR i IN 1 .. v_cnt LOOP
                IF i > 1 THEN v_sessions_json := v_sessions_json || '',''; END IF;
                v_sessions_json := v_sessions_json || ''{"start_time":'' || jstr(APEX_JSON.GET_VARCHAR2(''sessions[%d].start_time'', i)) ||
                                   '','' || ''"end_time":'' || jstr(APEX_JSON.GET_VARCHAR2(''sessions[%d].end_time'', i)) || ''}'';
            END LOOP;
            v_sessions_json := v_sessions_json || '']'';
        END IF;
    END IF;

    IF v_working_days IS NULL THEN
        BEGIN
            v_cnt := APEX_JSON.GET_COUNT(''working_days'');
        EXCEPTION
            WHEN OTHERS THEN
                v_cnt := NULL;
        END;
        IF NVL(v_cnt, 0) > 0 THEN
            FOR i IN 1 .. v_cnt LOOP
                IF i > 1 THEN v_working_days := v_working_days || '',''; END IF;
                v_working_days := v_working_days || UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''working_days[%d]'', i)));
            END LOOP;
        ELSIF v_cnt IS NULL AND APEX_JSON.DOES_EXIST(''working_days'') THEN
            v_working_days := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''working_days'')));
        END IF;
    END IF;

    IF v_doctor_id IS NULL OR v_sessions_json IS NULL OR v_working_days IS NULL THEN
        RAISE_APPLICATION_ERROR(-20121, ''doctor_id, sessions, and working_days are required'');
    END IF;

    MERGE INTO GIRISH_DOCTOR_SHIFT_WINDOWS tgt
    USING (SELECT v_doctor_id AS doctor_id FROM dual) src
    ON (tgt.doctor_id = src.doctor_id)
    WHEN MATCHED THEN
        UPDATE SET doctor_name        = v_doctor_name,
                   sessions_json      = v_sessions_json,
                   slot_duration_mins = v_duration,
                   working_days       = v_working_days,
                   is_registered      = v_is_reg,
                   updated_on         = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (doctor_id, doctor_name, sessions_json, slot_duration_mins, working_days, is_registered)
        VALUES (v_doctor_id, v_doctor_name, v_sessions_json, v_duration, v_working_days, v_is_reg);

    COMMIT;
    HTP.P(''{"status":"success","doctor_id":'' || v_doctor_id || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  -- 6. Shift Change Requests (GET, POST)
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'shift-change-requests',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Shift change requests collection');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'shift-change-requests',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'List shift change requests',
      p_source         => '
SELECT request_id,
       doctor_id,
       doctor_name,
       current_sessions_json,
       current_slot_duration_mins,
       current_working_days,
       requested_sessions_json,
       requested_slot_duration_mins,
       requested_working_days,
       reason,
       status,
       TO_CHAR(requested_on, ''YYYY-MM-DD"T"HH24:MI:SS"Z"'') AS requested_on,
       CASE WHEN decided_on IS NOT NULL THEN TO_CHAR(decided_on, ''YYYY-MM-DD"T"HH24:MI:SS"Z"'') ELSE NULL END AS decided_on,
       decided_by,
       decision_comments
FROM GIRISH_SHIFT_CHANGE_REQUESTS
ORDER BY requested_on DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'shift-change-requests',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Submit shift change request',
      p_source         => '
DECLARE
    v_request_id    VARCHAR2(40);
    v_doctor_id     NUMBER;
    v_doctor_name   VARCHAR2(200);
    v_cur_sess      CLOB;
    v_cur_dur       NUMBER;
    v_cur_days      VARCHAR2(200);
    v_req_sess      CLOB;
    v_req_dur       NUMBER;
    v_req_days      VARCHAR2(200);
    v_reason        VARCHAR2(1000);
    v_pending_cnt   NUMBER := 0;
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_request_id  := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''request_id''), ''''));
    IF v_request_id IS NULL THEN
        v_request_id := ''SCR-'' || TO_CHAR(SYSTIMESTAMP, ''YYYYMMDDHH24MISSFF3'');
    END IF;
    v_doctor_id   := APEX_JSON.GET_NUMBER(''doctor_id'');
    v_doctor_name := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''doctor_name''), ''Doctor #'' || v_doctor_id));
    v_cur_sess    := NVL(APEX_JSON.GET_CLOB(''current_sessions_json''), ''[]'');
    v_cur_dur     := NVL(APEX_JSON.GET_NUMBER(''current_slot_duration_mins''), 30);
    v_cur_days    := NVL(APEX_JSON.GET_VARCHAR2(''current_working_days_csv''), ''MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY'');
    v_req_sess    := APEX_JSON.GET_CLOB(''requested_sessions_json'');
    v_req_dur     := NVL(APEX_JSON.GET_NUMBER(''requested_slot_duration_mins''), 30);
    v_req_days    := NVL(APEX_JSON.GET_VARCHAR2(''requested_working_days_csv''), ''MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY'');
    v_reason      := TRIM(APEX_JSON.GET_VARCHAR2(''reason''));

    IF v_doctor_id IS NULL OR v_req_sess IS NULL OR v_reason IS NULL THEN
        RAISE_APPLICATION_ERROR(-20131, ''doctor_id, requested_sessions_json, and reason are required'');
    END IF;

    SELECT COUNT(*) INTO v_pending_cnt
    FROM GIRISH_SHIFT_CHANGE_REQUESTS
    WHERE doctor_id = v_doctor_id
      AND status = ''PENDING'';

    IF v_pending_cnt > 0 THEN
        RAISE_APPLICATION_ERROR(-20132, ''Doctor already has a pending shift change request'');
    END IF;

    INSERT INTO GIRISH_SHIFT_CHANGE_REQUESTS (
        request_id, doctor_id, doctor_name,
        current_sessions_json, current_slot_duration_mins, current_working_days,
        requested_sessions_json, requested_slot_duration_mins, requested_working_days,
        reason, status
    ) VALUES (
        v_request_id, v_doctor_id, v_doctor_name,
        v_cur_sess, v_cur_dur, v_cur_days,
        v_req_sess, v_req_dur, v_req_days,
        v_reason, ''PENDING''
    );

    COMMIT;
    HTP.P(''{"status":"success","request_id":'' || jstr(v_request_id) || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  -- 7. Decide Shift Change Request (POST updates request AND shift window atomically)
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'shift-change-requests/:id/decide',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => 'Approve or reject a shift change request');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'shift-change-requests/:id/decide',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Apply shift change request decision and update GIRISH_DOCTOR_SHIFT_WINDOWS on approval',
      p_source         => '
DECLARE
    v_decision    VARCHAR2(20);
    v_decided_by  VARCHAR2(150);
    v_comments    VARCHAR2(1000);
    v_doctor_id   NUMBER;
    v_doctor_name VARCHAR2(200);
    v_req_sess    CLOB;
    v_req_dur     NUMBER;
    v_req_days    VARCHAR2(200);
    v_cur_status  VARCHAR2(20);
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN ''null''; END IF;
        RETURN ''"'' || REPLACE(REPLACE(REPLACE(REPLACE(p_val, ''\'', ''\\''), ''"'', ''\"''), CHR(13), ''''), CHR(10), ''\n'') || ''"'';
    END;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_decision   := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(''decision'')));
    v_decided_by := TRIM(NVL(APEX_JSON.GET_VARCHAR2(''decided_by''), ''Administrator''));
    v_comments   := TRIM(APEX_JSON.GET_VARCHAR2(''comments''));

    IF v_decision NOT IN (''APPROVED'', ''REJECTED'') THEN
        RAISE_APPLICATION_ERROR(-20133, ''Decision must be APPROVED or REJECTED'');
    END IF;

    SELECT doctor_id, doctor_name, requested_sessions_json, requested_slot_duration_mins, requested_working_days, status
    INTO v_doctor_id, v_doctor_name, v_req_sess, v_req_dur, v_req_days, v_cur_status
    FROM GIRISH_SHIFT_CHANGE_REQUESTS
    WHERE request_id = :id
    FOR UPDATE;

    IF v_cur_status <> ''PENDING'' THEN
        RAISE_APPLICATION_ERROR(-20134, ''Shift change request has already been decided'');
    END IF;

    UPDATE GIRISH_SHIFT_CHANGE_REQUESTS
    SET status            = v_decision,
        decided_on        = CURRENT_TIMESTAMP,
        decided_by        = v_decided_by,
        decision_comments = v_comments
    WHERE request_id = :id;

    IF v_decision = ''APPROVED'' THEN
        MERGE INTO GIRISH_DOCTOR_SHIFT_WINDOWS tgt
        USING (SELECT v_doctor_id AS doctor_id FROM dual) src
        ON (tgt.doctor_id = src.doctor_id)
        WHEN MATCHED THEN
            UPDATE SET doctor_name        = v_doctor_name,
                       sessions_json      = v_req_sess,
                       slot_duration_mins = v_req_dur,
                       working_days       = v_req_days,
                       is_registered      = ''Y'',
                       updated_on         = CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (doctor_id, doctor_name, sessions_json, slot_duration_mins, working_days, is_registered)
            VALUES (v_doctor_id, v_doctor_name, v_req_sess, v_req_dur, v_req_days, ''Y'');
    END IF;

    COMMIT;
    HTP.P(''{"status":"success","request_id":'' || jstr(:id) || '',"decision":'' || jstr(v_decision) || ''}'');
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"Shift change request not found"}'');
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":'' || jstr(SQLERRM) || ''}'');
END;');

  COMMIT;
END;
/
