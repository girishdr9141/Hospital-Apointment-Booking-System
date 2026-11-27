-- =====================================================================
-- rollback/18_drop_global_ords_module.sql
-- PURPOSE : Cleanly remove ONLY the 'girish_global_api' ORDS module (Phase 3 undo).
--           ZERO handlers in 'girish_opd_api' are touched.
-- =====================================================================
BEGIN
    ORDS.DELETE_MODULE(p_module_name => 'girish_global_api');
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END;
/
