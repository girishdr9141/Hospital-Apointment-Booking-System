-- =====================================================================
-- rollback/16_drop_global_sidecar_tables.sql
-- PURPOSE : Cleanly remove ONLY GBR_ sidecar tables (Phase 1 undo).
--           ZERO existing GIRISH_* tables or data are touched.
-- =====================================================================
BEGIN
    FOR t IN (
        SELECT table_name
        FROM USER_TABLES
        WHERE table_name IN (
            'GBR_PAYMENT_BRANCH',
            'GBR_PATIENT_PROFILE',
            'GBR_APPT_BRANCH',
            'GBR_SLOT_BRANCH',
            'GBR_DOCTOR_BRANCHES',
            'GBR_BRANCH_DEPARTMENTS',
            'GBR_BRANCHES',
            'GBR_COUNTRIES'
        )
    ) LOOP
        EXECUTE IMMEDIATE 'DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS PURGE';
    END LOOP;
END;
/
