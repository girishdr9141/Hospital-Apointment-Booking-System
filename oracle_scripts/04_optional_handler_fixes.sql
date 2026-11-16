-- =====================================================================
-- 04_optional_handler_fixes.sql
-- PURPOSE : OPTIONAL cleanup for 2 pre-existing ORDS handler bugs
--           discovered during Phase 1 inspection.
--           DO NOT RUN without reviewing each change below:
--             1) GET doctors/:id was missing "WHERE doctor_id = :id".
--             2) POST/PUT doctors omitted the EMPLOYMENT_TYPE column.
--             3) DELETE reports/utilisation contained a stray doctor
--                deactivation block on the reporting endpoint.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (ONLY if approved)
-- =====================================================================

BEGIN
  -- 1. Fix GET doctors/:id to filter by :id
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'doctors/:id',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT doctor_id, department_id, first_name, last_name, specialization,
       consultation_fee, tele_consult_flag, employment_type, is_active
FROM GIRISH_DOCTORS
WHERE doctor_id = :id');

  -- 2. Include employment_type in GET/POST/PUT doctors
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'doctors',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT doctor_id,
       department_id,
       first_name,
       last_name,
       specialization,
       consultation_fee,
       tele_consult_flag,
       employment_type,
       is_active
FROM GIRISH_DOCTORS
WHERE is_active = ''Y''
ORDER BY first_name');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'doctors',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
BEGIN
    INSERT INTO GIRISH_DOCTORS (
        department_id, first_name, last_name, specialization,
        consultation_fee, tele_consult_flag, employment_type
    ) VALUES (
        :department_id, :first_name, :last_name, :specialization,
        :consultation_fee, :tele_consult_flag, NVL(:employment_type, ''FULL_TIME'')
    );
    COMMIT;
    HTP.P(''{"status": "success", "message": "Doctor added successfully."}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status": "error", "message": "'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'doctors/:id',
      p_method         => 'PUT',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
BEGIN
    UPDATE GIRISH_DOCTORS
    SET department_id     = :department_id,
        first_name        = :first_name,
        last_name         = :last_name,
        specialization    = :specialization,
        consultation_fee  = :consultation_fee,
        tele_consult_flag = :tele_consult_flag,
        employment_type   = NVL(:employment_type, employment_type),
        updated_by        = USER,
        updated_on        = CURRENT_TIMESTAMP
    WHERE doctor_id = :id;

    IF SQL%ROWCOUNT = 0 THEN
        HTP.P(''{"status":"error","message":"Doctor not found"}'');
    ELSE
        COMMIT;
        HTP.P(''{"status":"success","message":"Doctor replaced"}'');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  -- 3. Remove stray DELETE handler on reports/utilisation
  ORDS.DELETE_HANDLER(
      p_module_name  => 'girish_opd_api',
      p_uri_template => 'reports/utilisation',
      p_method       => 'DELETE');

  COMMIT;
END;
/
