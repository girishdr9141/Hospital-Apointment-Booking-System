-- =====================================================================
-- 17_global_sidecar_views_and_procedures.sql
-- PURPOSE :
--   1) Create read-only reporting views (GBR_V_*) joining existing
--      GIRISH_* tables with GBR_* sidecar link tables, defaulting any
--      unlinked legacy or voice records to the Headquarters branch.
--   2) Create brand-new GBR_* wrapper procedures that validate branch
--      rules and call existing GIRISH_* procedures UNCHANGED.
--   ZERO existing GIRISH_* procedures or views are modified.
-- SAFE    : Idempotent (CREATE OR REPLACE VIEW / PROCEDURE).
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: Read-Only Sidecar Views (HQ Fallback for Legacy & Voice)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW GBR_V_DOCTORS AS
SELECT
    d.doctor_id,
    d.department_id,
    dep.department_name,
    d.first_name,
    d.last_name,
    d.first_name || ' ' || d.last_name AS doctor_name,
    d.specialization,
    d.consultation_fee AS base_inr_fee,
    d.tele_consult_flag,
    d.is_active AS doctor_active,
    NVL(db.branch_id, hq.branch_id) AS branch_id,
    NVL(b.branch_code, hq.branch_code) AS branch_code,
    NVL(b.branch_name, hq.branch_name) AS branch_name,
    NVL(c.country_code, hqc.country_code) AS country_code,
    NVL(c.country_name, hqc.country_name) AS country_name,
    NVL(b.currency_code, hq.currency_code) AS currency_code,
    NVL(db.local_consultation_fee, ROUND(d.consultation_fee / NVL(c.fx_rate_to_inr, 1), 2)) AS local_consultation_fee,
    NVL(db.is_primary_branch, 'Y') AS is_primary_branch
FROM GIRISH_DOCTORS d
LEFT JOIN GIRISH_DEPARTMENTS dep
    ON dep.department_id = d.department_id
LEFT JOIN GBR_DOCTOR_BRANCHES db
    ON db.doctor_id = d.doctor_id
   AND db.is_active = 'Y'
LEFT JOIN GBR_BRANCHES b
    ON b.branch_id = db.branch_id
LEFT JOIN GBR_COUNTRIES c
    ON c.country_id = b.country_id
CROSS JOIN (
    SELECT b2.branch_id, b2.branch_code, b2.branch_name, b2.currency_code, b2.country_id
    FROM GBR_BRANCHES b2
    WHERE b2.is_headquarters = 'Y'
      AND ROWNUM = 1
) hq
LEFT JOIN GBR_COUNTRIES hqc
    ON hqc.country_id = hq.country_id;
/

CREATE OR REPLACE VIEW GBR_V_SLOTS AS
SELECT
    s.slot_id,
    s.doctor_id,
    d.first_name || ' ' || d.last_name AS doctor_name,
    d.department_id,
    dep.department_name,
    TO_CHAR(s.slot_date, 'YYYY-MM-DD') AS slot_date,
    s.start_time,
    s.end_time,
    s.max_patients_per_slot,
    s.booked_patients,
    s.status,
    NVL(sb.branch_id, hq.branch_id) AS branch_id,
    NVL(b.branch_code, hq.branch_code) AS branch_code,
    NVL(b.branch_name, hq.branch_name) AS branch_name,
    NVL(sb.branch_timezone, NVL(b.timezone_iana, hq.timezone_iana)) AS branch_timezone,
    NVL(b.currency_code, hq.currency_code) AS currency_code,
    NVL(c.country_code, hqc.country_code) AS country_code,
    NVL(c.country_name, hqc.country_name) AS country_name,
    CASE WHEN sb.slot_id IS NULL THEN 'HQ_DEFAULT' ELSE 'LINKED' END AS branch_resolution
FROM GIRISH_SLOTS s
LEFT JOIN GIRISH_DOCTORS d
    ON d.doctor_id = s.doctor_id
LEFT JOIN GIRISH_DEPARTMENTS dep
    ON dep.department_id = d.department_id
LEFT JOIN GBR_SLOT_BRANCH sb
    ON sb.slot_id = s.slot_id
LEFT JOIN GBR_BRANCHES b
    ON b.branch_id = sb.branch_id
LEFT JOIN GBR_COUNTRIES c
    ON c.country_id = b.country_id
CROSS JOIN (
    SELECT b2.branch_id, b2.branch_code, b2.branch_name, b2.timezone_iana, b2.currency_code, b2.country_id
    FROM GBR_BRANCHES b2
    WHERE b2.is_headquarters = 'Y'
      AND ROWNUM = 1
) hq
LEFT JOIN GBR_COUNTRIES hqc
    ON hqc.country_id = hq.country_id;
/

CREATE OR REPLACE VIEW GBR_V_APPOINTMENTS AS
SELECT
    a.appointment_id,
    a.appointment_ref,
    a.patient_id,
    p.first_name || ' ' || p.last_name AS patient_name,
    a.slot_id,
    s.doctor_id,
    d.first_name || ' ' || d.last_name AS doctor_name,
    d.department_id,
    dep.department_name,
    TO_CHAR(s.slot_date, 'YYYY-MM-DD') AS slot_date,
    s.start_time,
    s.end_time,
    a.status,
    a.booking_source,
    NVL(ab.consultation_mode, 'FACE_TO_FACE') AS consultation_mode,
    a.hold_expires_at,
    a.created_on,
    NVL(ab.branch_id, NVL(sb.branch_id, hq.branch_id)) AS branch_id,
    NVL(b.branch_code, hq.branch_code) AS branch_code,
    NVL(b.branch_name, hq.branch_name) AS branch_name,
    NVL(b.timezone_iana, hq.timezone_iana) AS branch_timezone,
    NVL(b.currency_code, hq.currency_code) AS currency_code,
    NVL(c.country_code, hqc.country_code) AS country_code,
    NVL(c.country_name, hqc.country_name) AS country_name,
    pb.local_currency AS paid_local_currency,
    pb.local_amount AS paid_local_amount,
    CASE WHEN ab.appointment_id IS NULL THEN 'HQ_DEFAULT' ELSE 'LINKED' END AS branch_resolution
FROM GIRISH_APPOINTMENTS a
JOIN GIRISH_SLOTS s
    ON s.slot_id = a.slot_id
LEFT JOIN GIRISH_PATIENTS p
    ON p.patient_id = a.patient_id
LEFT JOIN GIRISH_DOCTORS d
    ON d.doctor_id = s.doctor_id
LEFT JOIN GIRISH_DEPARTMENTS dep
    ON dep.department_id = d.department_id
LEFT JOIN GBR_APPT_BRANCH ab
    ON ab.appointment_id = a.appointment_id
LEFT JOIN GBR_SLOT_BRANCH sb
    ON sb.slot_id = s.slot_id
LEFT JOIN GBR_BRANCHES b
    ON b.branch_id = NVL(ab.branch_id, sb.branch_id)
LEFT JOIN GBR_COUNTRIES c
    ON c.country_id = b.country_id
LEFT JOIN GBR_PAYMENT_BRANCH pb
    ON pb.appointment_id = a.appointment_id
CROSS JOIN (
    SELECT b2.branch_id, b2.branch_code, b2.branch_name, b2.timezone_iana, b2.currency_code, b2.country_id
    FROM GBR_BRANCHES b2
    WHERE b2.is_headquarters = 'Y'
      AND ROWNUM = 1
) hq
LEFT JOIN GBR_COUNTRIES hqc
    ON hqc.country_id = hq.country_id;
/

CREATE OR REPLACE VIEW GBR_V_PAYMENTS AS
SELECT
    py.payment_id,
    py.appointment_id,
    ap.appointment_ref,
    py.payment_ref,
    py.amount AS base_inr_amount,
    py.payment_method,
    py.status,
    py.created_on,
    NVL(pb.branch_id, NVL(ab.branch_id, hq.branch_id)) AS branch_id,
    NVL(b.branch_code, hq.branch_code) AS branch_code,
    NVL(b.branch_name, hq.branch_name) AS branch_name,
    NVL(c.country_code, hqc.country_code) AS country_code,
    NVL(pb.local_currency, NVL(b.currency_code, hq.currency_code)) AS local_currency,
    NVL(pb.local_amount, py.amount) AS local_amount,
    NVL(pb.fx_rate_to_inr, 1) AS fx_rate_to_inr
FROM GIRISH_PAYMENTS py
LEFT JOIN GIRISH_APPOINTMENTS ap
    ON ap.appointment_id = py.appointment_id
LEFT JOIN GBR_PAYMENT_BRANCH pb
    ON pb.payment_id = py.payment_id
LEFT JOIN GBR_APPT_BRANCH ab
    ON ab.appointment_id = py.appointment_id
LEFT JOIN GBR_BRANCHES b
    ON b.branch_id = NVL(pb.branch_id, ab.branch_id)
LEFT JOIN GBR_COUNTRIES c
    ON c.country_id = b.country_id
CROSS JOIN (
    SELECT b2.branch_id, b2.branch_code, b2.branch_name, b2.currency_code, b2.country_id
    FROM GBR_BRANCHES b2
    WHERE b2.is_headquarters = 'Y'
      AND ROWNUM = 1
) hq
LEFT JOIN GBR_COUNTRIES hqc
    ON hqc.country_id = hq.country_id;
/

CREATE OR REPLACE VIEW GBR_V_BRANCH_UTILISATION AS
SELECT
    b.branch_id,
    b.branch_code,
    b.branch_name,
    b.city,
    b.timezone_iana,
    b.currency_code,
    c.country_code,
    c.country_name,
    NVL(sl.total_slots, 0) AS total_slots,
    NVL(sl.booked_slots, 0) AS booked_slots,
    NVL(ap.total_appointments, 0) AS total_appointments,
    NVL(ap.confirmed_appointments, 0) AS confirmed_appointments,
    NVL(ap.completed_appointments, 0) AS completed_appointments,
    NVL(py.total_local_revenue, 0) AS total_local_revenue,
    NVL(py.total_inr_revenue, 0) AS total_inr_revenue
FROM GBR_BRANCHES b
JOIN GBR_COUNTRIES c ON c.country_id = b.country_id
LEFT JOIN (
    SELECT branch_id,
           COUNT(*) AS total_slots,
           SUM(CASE WHEN booked_patients > 0 OR status = 'SOLD_OUT' THEN 1 ELSE 0 END) AS booked_slots
    FROM GBR_V_SLOTS
    GROUP BY branch_id
) sl ON sl.branch_id = b.branch_id
LEFT JOIN (
    SELECT branch_id,
           COUNT(*) AS total_appointments,
           SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_appointments,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_appointments
    FROM GBR_V_APPOINTMENTS
    GROUP BY branch_id
) ap ON ap.branch_id = b.branch_id
LEFT JOIN (
    SELECT branch_id,
           SUM(CASE WHEN status = 'SUCCESS' THEN local_amount ELSE 0 END) AS total_local_revenue,
           SUM(CASE WHEN status = 'SUCCESS' THEN base_inr_amount ELSE 0 END) AS total_inr_revenue
    FROM GBR_V_PAYMENTS
    GROUP BY branch_id
) py ON py.branch_id = b.branch_id;
/

-- ---------------------------------------------------------------------
-- PART 2: Sidecar Wrapper Procedures (Zero Edits to GIRISH_* Procs)
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE GBR_ASSIGN_BRANCH_DEPT
(
    P_BRANCH_ID       IN NUMBER,
    P_DEPARTMENT_ID   IN NUMBER,
    P_IS_SPECIALIZED  IN VARCHAR2 DEFAULT 'Y',
    P_LOCAL_FEE       IN NUMBER   DEFAULT NULL,
    P_IS_ACTIVE       IN VARCHAR2 DEFAULT 'Y'
)
AS
    v_cnt NUMBER := 0;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM GBR_BRANCHES WHERE BRANCH_ID = P_BRANCH_ID AND IS_ACTIVE = 'Y';
    IF v_cnt = 0 THEN
        RAISE_APPLICATION_ERROR(-20501, 'Active branch not found for branch_id');
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM GIRISH_DEPARTMENTS WHERE DEPARTMENT_ID = P_DEPARTMENT_ID AND IS_ACTIVE = 'Y';
    IF v_cnt = 0 THEN
        RAISE_APPLICATION_ERROR(-20502, 'Active department not found in GIRISH_DEPARTMENTS');
    END IF;

    MERGE INTO GBR_BRANCH_DEPARTMENTS tgt
    USING (SELECT P_BRANCH_ID AS branch_id, P_DEPARTMENT_ID AS department_id FROM DUAL) src
    ON (tgt.branch_id = src.branch_id AND tgt.department_id = src.department_id)
    WHEN MATCHED THEN
        UPDATE SET tgt.is_specialized = CASE WHEN UPPER(NVL(P_IS_SPECIALIZED, 'N')) = 'Y' THEN 'Y' ELSE 'N' END,
                   tgt.local_consultation_fee = P_LOCAL_FEE,
                   tgt.is_active = CASE WHEN UPPER(NVL(P_IS_ACTIVE, 'Y')) = 'Y' THEN 'Y' ELSE 'N' END
    WHEN NOT MATCHED THEN
        INSERT (branch_id, department_id, is_specialized, local_consultation_fee, is_active)
        VALUES (
            P_BRANCH_ID,
            P_DEPARTMENT_ID,
            CASE WHEN UPPER(NVL(P_IS_SPECIALIZED, 'N')) = 'Y' THEN 'Y' ELSE 'N' END,
            P_LOCAL_FEE,
            CASE WHEN UPPER(NVL(P_IS_ACTIVE, 'Y')) = 'Y' THEN 'Y' ELSE 'N' END
        );
END GBR_ASSIGN_BRANCH_DEPT;
/

CREATE OR REPLACE PROCEDURE GBR_ASSIGN_DOCTOR_BRANCH
(
    P_DOCTOR_ID       IN NUMBER,
    P_BRANCH_ID       IN NUMBER,
    P_IS_PRIMARY      IN VARCHAR2 DEFAULT 'N',
    P_LOCAL_FEE       IN NUMBER   DEFAULT NULL,
    P_IS_ACTIVE       IN VARCHAR2 DEFAULT 'Y'
)
AS
    v_cnt NUMBER := 0;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM GIRISH_DOCTORS WHERE DOCTOR_ID = P_DOCTOR_ID AND IS_ACTIVE = 'Y';
    IF v_cnt = 0 THEN
        RAISE_APPLICATION_ERROR(-20503, 'Active doctor not found in GIRISH_DOCTORS');
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM GBR_BRANCHES WHERE BRANCH_ID = P_BRANCH_ID AND IS_ACTIVE = 'Y';
    IF v_cnt = 0 THEN
        RAISE_APPLICATION_ERROR(-20504, 'Active branch not found in GBR_BRANCHES');
    END IF;

    IF UPPER(NVL(P_IS_PRIMARY, 'N')) = 'Y' THEN
        UPDATE GBR_DOCTOR_BRANCHES
        SET is_primary_branch = 'N'
        WHERE doctor_id = P_DOCTOR_ID
          AND branch_id <> P_BRANCH_ID;
    END IF;

    MERGE INTO GBR_DOCTOR_BRANCHES tgt
    USING (SELECT P_DOCTOR_ID AS doctor_id, P_BRANCH_ID AS branch_id FROM DUAL) src
    ON (tgt.doctor_id = src.doctor_id AND tgt.branch_id = src.branch_id)
    WHEN MATCHED THEN
        UPDATE SET tgt.is_primary_branch = CASE WHEN UPPER(NVL(P_IS_PRIMARY, 'N')) = 'Y' THEN 'Y' ELSE 'N' END,
                   tgt.local_consultation_fee = P_LOCAL_FEE,
                   tgt.is_active = CASE WHEN UPPER(NVL(P_IS_ACTIVE, 'Y')) = 'Y' THEN 'Y' ELSE 'N' END
    WHEN NOT MATCHED THEN
        INSERT (doctor_id, branch_id, is_primary_branch, local_consultation_fee, is_active)
        VALUES (
            P_DOCTOR_ID,
            P_BRANCH_ID,
            CASE WHEN UPPER(NVL(P_IS_PRIMARY, 'N')) = 'Y' THEN 'Y' ELSE 'N' END,
            P_LOCAL_FEE,
            CASE WHEN UPPER(NVL(P_IS_ACTIVE, 'Y')) = 'Y' THEN 'Y' ELSE 'N' END
        );
END GBR_ASSIGN_DOCTOR_BRANCH;
/

CREATE OR REPLACE PROCEDURE GBR_CREATE_BRANCH_SLOT
(
    P_DOCTOR_ID   IN  NUMBER,
    P_BRANCH_ID   IN  NUMBER,
    P_SLOT_DATE   IN  DATE,
    P_START_TIME  IN  VARCHAR2,
    P_END_TIME    IN  VARCHAR2,
    P_MAX_PATIENT IN  NUMBER DEFAULT 1,
    P_SLOT_ID     OUT NUMBER
)
AS
    v_cnt      NUMBER := 0;
    v_tz       VARCHAR2(80);
    v_is_hq    CHAR(1);
    v_dup_cnt  NUMBER := 0;
BEGIN
    SELECT timezone_iana, is_headquarters
    INTO v_tz, v_is_hq
    FROM GBR_BRANCHES
    WHERE branch_id = P_BRANCH_ID
      AND is_active = 'Y';

    SELECT COUNT(*) INTO v_cnt FROM GIRISH_DOCTORS WHERE doctor_id = P_DOCTOR_ID AND is_active = 'Y';
    IF v_cnt = 0 THEN
        RAISE_APPLICATION_ERROR(-20505, 'Active doctor not found');
    END IF;

    IF v_is_hq <> 'Y' THEN
        SELECT COUNT(*) INTO v_cnt
        FROM GBR_DOCTOR_BRANCHES
        WHERE doctor_id = P_DOCTOR_ID
          AND branch_id = P_BRANCH_ID
          AND is_active = 'Y';
        IF v_cnt = 0 THEN
            RAISE_APPLICATION_ERROR(-20506, 'Doctor is not assigned to the selected branch');
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_dup_cnt
    FROM GIRISH_SLOTS
    WHERE doctor_id = P_DOCTOR_ID
      AND TRUNC(slot_date) = TRUNC(P_SLOT_DATE)
      AND start_time = SUBSTR(TRIM(P_START_TIME), 1, 5)
      AND status <> 'CANCELLED';

    IF v_dup_cnt > 0 THEN
        RAISE_APPLICATION_ERROR(-20507, 'Doctor already has a slot at this date and start time');
    END IF;

    INSERT INTO GIRISH_SLOTS (
        doctor_id, template_id, slot_date, start_time, end_time,
        max_patients_per_slot, booked_patients, status
    ) VALUES (
        P_DOCTOR_ID, NULL, TRUNC(P_SLOT_DATE),
        SUBSTR(TRIM(P_START_TIME), 1, 5),
        SUBSTR(TRIM(NVL(P_END_TIME, P_START_TIME)), 1, 5),
        NVL(P_MAX_PATIENT, 1), 0, 'AVAILABLE'
    )
    RETURNING slot_id INTO P_SLOT_ID;

    INSERT INTO GBR_SLOT_BRANCH (slot_id, branch_id, branch_timezone)
    VALUES (P_SLOT_ID, P_BRANCH_ID, v_tz);
END GBR_CREATE_BRANCH_SLOT;
/

CREATE OR REPLACE PROCEDURE GBR_BOOK_APPOINTMENT
(
    P_PATIENT_ID        IN  NUMBER,
    P_SLOT_ID           IN  NUMBER,
    P_BRANCH_ID         IN  NUMBER,
    P_BOOKING_SOURCE    IN  VARCHAR2 DEFAULT 'ONLINE',
    P_CONSULTATION_MODE IN  VARCHAR2 DEFAULT 'FACE_TO_FACE',
    P_APPOINTMENT_REF   OUT VARCHAR2,
    P_APPOINTMENT_ID    OUT NUMBER
)
AS
    v_slot_branch_id NUMBER;
    v_hq_branch_id   NUMBER;
    v_doc_id         NUMBER;
    v_branch_active  NUMBER := 0;
    v_doc_assigned   NUMBER := 0;
    v_mode           VARCHAR2(20);
BEGIN
    SELECT COUNT(*) INTO v_branch_active
    FROM GBR_BRANCHES
    WHERE branch_id = P_BRANCH_ID
      AND is_active = 'Y';
    IF v_branch_active = 0 THEN
        RAISE_APPLICATION_ERROR(-20510, 'Selected branch is inactive or does not exist');
    END IF;

    SELECT branch_id INTO v_hq_branch_id
    FROM GBR_BRANCHES
    WHERE is_headquarters = 'Y'
      AND ROWNUM = 1;

    SELECT doctor_id INTO v_doc_id
    FROM GIRISH_SLOTS
    WHERE slot_id = P_SLOT_ID;

    BEGIN
        SELECT branch_id INTO v_slot_branch_id
        FROM GBR_SLOT_BRANCH
        WHERE slot_id = P_SLOT_ID;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_slot_branch_id := v_hq_branch_id;
    END;

    IF v_slot_branch_id <> P_BRANCH_ID THEN
        RAISE_APPLICATION_ERROR(-20511, 'Slot does not belong to the selected branch');
    END IF;

    IF P_BRANCH_ID <> v_hq_branch_id THEN
        SELECT COUNT(*) INTO v_doc_assigned
        FROM GBR_DOCTOR_BRANCHES
        WHERE doctor_id = v_doc_id
          AND branch_id = P_BRANCH_ID
          AND is_active = 'Y';
        IF v_doc_assigned = 0 THEN
            RAISE_APPLICATION_ERROR(-20512, 'Doctor is not active at the selected branch');
        END IF;
    END IF;

    v_mode := CASE WHEN UPPER(NVL(P_CONSULTATION_MODE, 'FACE_TO_FACE')) = 'ONLINE' THEN 'ONLINE' ELSE 'FACE_TO_FACE' END;

    -- Delegate 100% of core booking logic to the untouched existing procedure!
    GIRISH_BOOK_APPOINTMENT(
        P_PATIENT_ID      => P_PATIENT_ID,
        P_SLOT_ID         => P_SLOT_ID,
        P_BOOKING_SOURCE  => NVL(UPPER(P_BOOKING_SOURCE), 'ONLINE'),
        P_APPOINTMENT_REF => P_APPOINTMENT_REF
    );

    SELECT appointment_id INTO P_APPOINTMENT_ID
    FROM GIRISH_APPOINTMENTS
    WHERE appointment_ref = P_APPOINTMENT_REF;

    MERGE INTO GBR_APPT_BRANCH tgt
    USING (SELECT P_APPOINTMENT_ID AS appointment_id FROM DUAL) src
    ON (tgt.appointment_id = src.appointment_id)
    WHEN MATCHED THEN
        UPDATE SET tgt.branch_id = P_BRANCH_ID,
                   tgt.appointment_ref = P_APPOINTMENT_REF,
                   tgt.consultation_mode = v_mode
    WHEN NOT MATCHED THEN
        INSERT (appointment_id, appointment_ref, branch_id, consultation_mode)
        VALUES (P_APPOINTMENT_ID, P_APPOINTMENT_REF, P_BRANCH_ID, v_mode);
END GBR_BOOK_APPOINTMENT;
/

CREATE OR REPLACE PROCEDURE GBR_RECORD_BRANCH_PAYMENT
(
    P_APPOINTMENT_ID  IN  NUMBER,
    P_BRANCH_ID       IN  NUMBER,
    P_PAYMENT_METHOD  IN  VARCHAR2 DEFAULT 'UPI',
    P_LOCAL_CURRENCY  IN  VARCHAR2 DEFAULT 'INR',
    P_LOCAL_AMOUNT    IN  NUMBER,
    P_BASE_INR_AMOUNT IN  NUMBER,
    P_FX_RATE_TO_INR  IN  NUMBER DEFAULT 1,
    P_PAYMENT_ID      OUT NUMBER,
    P_PAYMENT_REF     OUT VARCHAR2
)
AS
    v_appt_ref VARCHAR2(40);
BEGIN
    SELECT appointment_ref INTO v_appt_ref
    FROM GIRISH_APPOINTMENTS
    WHERE appointment_id = P_APPOINTMENT_ID;

    -- Confirm appointment via untouched GIRISH_CONFIRM_APPOINTMENT if still HELD
    GIRISH_CONFIRM_APPOINTMENT(P_APPOINTMENT_ID => P_APPOINTMENT_ID);

    P_PAYMENT_REF := 'PAY' || SUBSTR(RAWTOHEX(SYS_GUID()), 1, 17);

    INSERT INTO GIRISH_PAYMENTS (
        appointment_id, payment_ref, amount, payment_method, status
    ) VALUES (
        P_APPOINTMENT_ID, P_PAYMENT_REF, NVL(P_BASE_INR_AMOUNT, P_LOCAL_AMOUNT),
        NVL(UPPER(P_PAYMENT_METHOD), 'UPI'), 'SUCCESS'
    )
    RETURNING payment_id INTO P_PAYMENT_ID;

    MERGE INTO GBR_PAYMENT_BRANCH tgt
    USING (SELECT P_PAYMENT_ID AS payment_id FROM DUAL) src
    ON (tgt.payment_id = src.payment_id)
    WHEN NOT MATCHED THEN
        INSERT (payment_id, appointment_id, branch_id, local_currency, local_amount, base_inr_amount, fx_rate_to_inr)
        VALUES (
            P_PAYMENT_ID,
            P_APPOINTMENT_ID,
            P_BRANCH_ID,
            UPPER(NVL(P_LOCAL_CURRENCY, 'INR')),
            P_LOCAL_AMOUNT,
            NVL(P_BASE_INR_AMOUNT, P_LOCAL_AMOUNT),
            NVL(P_FX_RATE_TO_INR, 1)
        );
END GBR_RECORD_BRANCH_PAYMENT;
/

CREATE OR REPLACE PROCEDURE GBR_UPSERT_PATIENT_PROFILE
(
    P_PATIENT_ID         IN NUMBER,
    P_COUNTRY_ID         IN NUMBER DEFAULT NULL,
    P_HOME_BRANCH_ID     IN NUMBER DEFAULT NULL,
    P_CITY               IN VARCHAR2 DEFAULT NULL,
    P_ADDRESS_LINE       IN VARCHAR2 DEFAULT NULL,
    P_POSTAL_CODE        IN VARCHAR2 DEFAULT NULL,
    P_PREFERRED_CURRENCY IN VARCHAR2 DEFAULT NULL
)
AS
    v_cnt NUMBER := 0;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM GIRISH_PATIENTS WHERE patient_id = P_PATIENT_ID;
    IF v_cnt = 0 THEN
        RAISE_APPLICATION_ERROR(-20520, 'Patient not found in GIRISH_PATIENTS');
    END IF;

    MERGE INTO GBR_PATIENT_PROFILE tgt
    USING (SELECT P_PATIENT_ID AS patient_id FROM DUAL) src
    ON (tgt.patient_id = src.patient_id)
    WHEN MATCHED THEN
        UPDATE SET tgt.country_id = P_COUNTRY_ID,
                   tgt.home_branch_id = P_HOME_BRANCH_ID,
                   tgt.city = P_CITY,
                   tgt.address_line = P_ADDRESS_LINE,
                   tgt.postal_code = P_POSTAL_CODE,
                   tgt.preferred_currency = P_PREFERRED_CURRENCY,
                   tgt.updated_on = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (patient_id, country_id, home_branch_id, city, address_line, postal_code, preferred_currency)
        VALUES (P_PATIENT_ID, P_COUNTRY_ID, P_HOME_BRANCH_ID, P_CITY, P_ADDRESS_LINE, P_POSTAL_CODE, P_PREFERRED_CURRENCY);
END GBR_UPSERT_PATIENT_PROFILE;
/

ALTER VIEW GBR_V_DOCTORS COMPILE;
ALTER VIEW GBR_V_SLOTS COMPILE;
ALTER VIEW GBR_V_APPOINTMENTS COMPILE;
ALTER VIEW GBR_V_PAYMENTS COMPILE;
ALTER VIEW GBR_V_BRANCH_UTILISATION COMPILE;
ALTER PROCEDURE GBR_ASSIGN_BRANCH_DEPT COMPILE;
ALTER PROCEDURE GBR_ASSIGN_DOCTOR_BRANCH COMPILE;
ALTER PROCEDURE GBR_CREATE_BRANCH_SLOT COMPILE;
ALTER PROCEDURE GBR_BOOK_APPOINTMENT COMPILE;
ALTER PROCEDURE GBR_RECORD_BRANCH_PAYMENT COMPILE;
ALTER PROCEDURE GBR_UPSERT_PATIENT_PROFILE COMPILE;
