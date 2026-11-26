-- =====================================================================
-- 15_audit_logs_and_sync.sql
-- PURPOSE :
--   Add ORDS POST /audit-logs handler so every portal operation
--   (login, logout, registration, password reset, shift window, shift
--    change, leave request/decision, slot actions, booking, payment,
--    paid-and-confirm, cancellation actor & refund, clinical & RBAC)
--   syncs cleanly to Oracle GIRISH_AUDIT_LOGS without foreign-key
--   errors on managed/system user IDs.
--
-- SAFE    : Idempotent (replaces POST handler on existing audit-logs template).
-- RUN AS  : NOV_2026_BATCH in Oracle APEX SQL Workshop -> SQL Scripts (Run / F5)
-- =====================================================================

BEGIN
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'girish_opd_api',
      p_pattern     => 'audit-logs',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_etag_query  => NULL,
      p_comments    => NULL);

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'audit-logs',
      p_method         => 'GET',
      p_source_type    => 'json/collection',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => NULL,
      p_source         => '
SELECT al.audit_id,
       al.user_id,
       u.username,
       al.action_name,
       al.table_name,
       al.record_id,
       al.action_description,
       al.action_on
FROM GIRISH_AUDIT_LOGS al
LEFT JOIN GIRISH_USERS u ON u.user_id = al.user_id
ORDER BY al.action_on DESC, al.audit_id DESC');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'girish_opd_api',
      p_pattern        => 'audit-logs',
      p_method         => 'POST',
      p_source_type    => 'plsql/block',
      p_items_per_page => 0,
      p_mimes_allowed  => '',
      p_comments       => 'Record portal and operational audit events into GIRISH_AUDIT_LOGS',
      p_source         => '
DECLARE
    v_req_user_id   NUMBER;
    v_safe_user_id  NUMBER := NULL;
    v_action_name   VARCHAR2(100);
    v_table_name    VARCHAR2(100);
    v_record_id     VARCHAR2(100);
    v_description   VARCHAR2(4000);
    v_audit_id      NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    v_req_user_id := APEX_JSON.GET_NUMBER(''user_id'');
    v_action_name := SUBSTR(NVL(TRIM(APEX_JSON.GET_VARCHAR2(''action_name'')), ''SYSTEM_EVENT''), 1, 100);
    v_table_name  := SUBSTR(NVL(TRIM(APEX_JSON.GET_VARCHAR2(''table_name'')), ''GIRISH_USERS''), 1, 100);
    v_record_id   := SUBSTR(TRIM(APEX_JSON.GET_VARCHAR2(''record_id'')), 1, 100);
    v_description := SUBSTR(TRIM(APEX_JSON.GET_VARCHAR2(''action_description'')), 1, 1000);

    IF v_req_user_id IS NOT NULL THEN
        BEGIN
            SELECT user_id
            INTO v_safe_user_id
            FROM GIRISH_USERS
            WHERE user_id = v_req_user_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                v_safe_user_id := NULL;
        END;
    END IF;

    INSERT INTO GIRISH_AUDIT_LOGS (
        user_id,
        action_name,
        table_name,
        record_id,
        action_description,
        action_on
    ) VALUES (
        v_safe_user_id,
        UPPER(v_action_name),
        UPPER(v_table_name),
        v_record_id,
        v_description,
        CURRENT_TIMESTAMP
    )
    RETURNING audit_id INTO v_audit_id;

    COMMIT;
    HTP.P(''{"status":"success","audit_id":'' || v_audit_id || ''}'' );
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P(''{"status":"error","message":"'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;');

  COMMIT;
END;
/

SELECT t.uri_template, h.method
FROM user_ords_modules m
JOIN user_ords_templates t ON t.module_id = m.id
JOIN user_ords_handlers h ON h.template_id = t.id
WHERE m.name = 'girish_opd_api'
  AND t.uri_template = 'audit-logs'
ORDER BY h.method;
