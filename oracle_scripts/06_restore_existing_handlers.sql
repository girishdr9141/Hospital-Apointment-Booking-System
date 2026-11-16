-- =====================================================================
-- 06_restore_existing_handlers.sql
-- PURPOSE : Restore the 3 pre-existing ORDS handlers in girish_opd_api
--           that were dropped when 03_auth_and_missing_ords.sql
--           re-declared their existing templates:
--             1) GET  payments
--             2) GET  token_queue
--             3) POST consultation-types/
-- SAFE    : Calls ONLY ORDS.DEFINE_HANDLER (does NOT call DEFINE_TEMPLATE),
--           so existing POST payments, POST token_queue, and GET
--           consultation-types/ handlers remain completely intact.
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop (Run Script / F5)
-- =====================================================================

BEGIN
  -- 1. Restore GET payments
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'payments',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Restore GET payments collection handler',
      p_source         => '
SELECT
    p.payment_id,
    p.appointment_id,
    a.appointment_ref,
    p.payment_ref,
    p.amount,
    p.payment_method,
    p.status,
    p.created_on
FROM GIRISH_PAYMENTS p
JOIN GIRISH_APPOINTMENTS a
    ON a.appointment_id = p.appointment_id
ORDER BY p.created_on DESC');

  -- 2. Restore GET token_queue
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'token_queue',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Restore GET token_queue collection handler',
      p_source         => '
SELECT
    q.queue_id,
    q.appointment_id,
    a.appointment_ref,
    q.department_id,
    d.department_name,
    q.queue_date,
    q.token_number,
    q.status,
    q.created_on
FROM GIRISH_TOKEN_QUEUE q
JOIN GIRISH_APPOINTMENTS a
    ON a.appointment_id = q.appointment_id
JOIN GIRISH_DEPARTMENTS d
    ON d.department_id = q.department_id
ORDER BY q.queue_date DESC, q.token_number');

  -- 3. Restore POST consultation-types/
  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'consultation-types/',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Restore POST consultation-types/ creation handler',
      p_source         => '
DECLARE
    V_DEPARTMENT_ID NUMBER;
    V_NAME VARCHAR2(100);
    V_DESCRIPTION VARCHAR2(250);
    V_DURATION NUMBER;
    V_FEE NUMBER(10,2);
BEGIN
    APEX_JSON.PARSE(:body_text);

    V_DEPARTMENT_ID := APEX_JSON.GET_NUMBER(''department_id'');
    V_NAME          := APEX_JSON.GET_VARCHAR2(''consultation_type_name'');
    V_DESCRIPTION   := APEX_JSON.GET_VARCHAR2(''description'');
    V_DURATION      := APEX_JSON.GET_NUMBER(''duration_mins'');
    V_FEE           := APEX_JSON.GET_NUMBER(''consultation_fee'');

    IF V_DEPARTMENT_ID IS NULL
       OR V_NAME IS NULL
       OR V_DURATION IS NULL THEN
        RAISE_APPLICATION_ERROR(
            -20001,
            ''Department ID, consultation type name and duration are required''
        );
    END IF;

    INSERT INTO GIRISH_CONSULTATION_TYPES (
        DEPARTMENT_ID,
        CONSULTATION_TYPE_NAME,
        DESCRIPTION,
        DURATION_MINS,
        CONSULTATION_FEE
    ) VALUES (
        V_DEPARTMENT_ID,
        V_NAME,
        V_DESCRIPTION,
        V_DURATION,
        V_FEE
    );

    COMMIT;
    HTP.P(''{"status":"success","message":"Consultation type created successfully"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  COMMIT;
END;
/

-- Verification query: confirm all 3 templates now have both methods
SELECT t.uri_template, h.method
FROM user_ords_modules m
JOIN user_ords_templates t ON t.module_id = m.id
JOIN user_ords_handlers h ON h.template_id = t.id
WHERE m.name = 'girish_opd_api'
  AND t.uri_template IN ('payments', 'token_queue', 'consultation-types/')
ORDER BY t.uri_template, h.method;
