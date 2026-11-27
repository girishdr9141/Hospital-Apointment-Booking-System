-- =====================================================================
-- rollback/17_drop_global_views_and_procedures.sql
-- PURPOSE : Cleanly remove ONLY GBR_V_* views and GBR_* procedures (Phase 2 undo).
--           ZERO existing GIRISH_* procedures or views are touched.
-- =====================================================================
BEGIN
    FOR o IN (
        SELECT object_type, object_name
        FROM USER_OBJECTS
        WHERE object_type IN ('VIEW', 'PROCEDURE')
          AND object_name IN (
              'GBR_V_DOCTORS',
              'GBR_V_SLOTS',
              'GBR_V_APPOINTMENTS',
              'GBR_V_PAYMENTS',
              'GBR_V_BRANCH_UTILISATION',
              'GBR_ASSIGN_BRANCH_DEPT',
              'GBR_ASSIGN_DOCTOR_BRANCH',
              'GBR_CREATE_BRANCH_SLOT',
              'GBR_BOOK_APPOINTMENT',
              'GBR_RECORD_BRANCH_PAYMENT',
              'GBR_UPSERT_PATIENT_PROFILE'
          )
    ) LOOP
        EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' ' || o.object_name;
    END LOOP;
END;
/
