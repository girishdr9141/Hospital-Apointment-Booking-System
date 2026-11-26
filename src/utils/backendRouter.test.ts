import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_OIC_PHASES,
  OIC_INTEGRATIONS_CATALOG,
  OIC_PHASE_SPECS,
  classifyEndpointPhase,
  normalizeBackendMode,
  normalizeBackendPayload,
  normalizeEnabledPhases,
  normalizeOicBaseUrl,
  normalizeOicMutationPayload,
  parseBackendMode,
  resolveOicIntegrationRoute,
  resolveRoutingDecision,
  sanitizeEnvValue,
} from './backendRouter';

const ORDS_URL =
  'https://ga97be9115f23e9-moviestreamworkshop.adb.ap-mumbai-1.oraclecloudapps.com/ords/nov_2026_batch/girish_opd_api/v1';
const OIC_URL =
  'https://conneqtion-dev2-bmwxqal1yvum-bo.integration.ap-mumbai-1.ocp.oraclecloud.com/ic/api/integration/v2/flows/rest/project/HOSPITAL_APPOINTMEN_BOOKING';

test('parseBackendMode and normalizeBackendMode handle HYBRID, OIC, ORDS, and legacy values', () => {
  assert.equal(parseBackendMode('hybrid'), 'HYBRID');
  assert.equal(parseBackendMode('OIC'), 'OIC');
  assert.equal(parseBackendMode('ords'), 'ORDS');
  assert.equal(parseBackendMode('invalid'), null);

  assert.equal(normalizeBackendMode(undefined, true), 'HYBRID');
  assert.equal(normalizeBackendMode(undefined, false), 'ORDS');
  assert.equal(normalizeBackendMode('OIC', true), 'OIC');
  assert.equal(normalizeBackendMode('OIC', false), 'ORDS');
  assert.equal(normalizeBackendMode('HYBRID', false), 'ORDS');
  assert.equal(normalizeBackendMode('ORDS', true), 'ORDS');
});

test('all GET requests always route directly to ORDS_BASE_URL regardless of mode', () => {
  for (const mode of ['HYBRID', 'OIC', 'ORDS'] as const) {
    const d1 = resolveRoutingDecision({
      mode,
      method: 'GET',
      endpoint: 'appointments?limit=500',
      oicConfigured: true,
      ordsBaseUrl: ORDS_URL,
      oicBaseUrl: OIC_URL,
    });
    assert.equal(d1.servedBy, 'ORDS');
    assert.equal(d1.integrationName, null);
    assert.equal(d1.url, `${ORDS_URL}/appointments?limit=500`);

    const d2 = resolveRoutingDecision({
      mode,
      method: 'GET',
      endpoint: 'departments/?limit=500',
      oicConfigured: true,
      ordsBaseUrl: ORDS_URL,
      oicBaseUrl: OIC_URL,
    });
    assert.equal(d2.servedBy, 'ORDS');
    assert.equal(d2.url, `${ORDS_URL}/departments/?limit=500`);
  }
});

test('write endpoints route to the exact OIC integration in HYBRID and OIC modes and fall back to ORDS in ORDS mode', () => {
  const cases: Array<{
    method: string;
    endpoint: string;
    expectedIntegration: string;
    expectedResource: string;
  }> = [
    {
      method: 'POST',
      endpoint: 'appointments/',
      expectedIntegration: 'CAREPULS_BOOK_APPOINTM_MAIN',
      expectedResource: 'appointments',
    },
    {
      method: 'POST',
      endpoint: 'appointments/181/pay-and-confirm',
      expectedIntegration: 'CAREPULS_BOOK_APPOINTM_MAIN',
      expectedResource: 'appointments/181/pay-and-confirm',
    },
    {
      method: 'POST',
      endpoint: 'appointments/181/cancel',
      expectedIntegration: 'HOSPITAL_APPOINTMEN_API',
      expectedResource: 'appointments/181/cancel',
    },
    {
      method: 'POST',
      endpoint: 'appointments/181/outcome',
      expectedIntegration: 'HOSPITAL_APPOINTMEN_API',
      expectedResource: 'appointments/181/outcome',
    },
    {
      method: 'POST',
      endpoint: 'token_queue',
      expectedIntegration: 'HOSPITAL_APPOINTMEN_API',
      expectedResource: 'token_queue',
    },
    {
      method: 'POST',
      endpoint: 'slots',
      expectedIntegration: 'HOSPITAL_SCHEDULE_API',
      expectedResource: 'slots',
    },
    {
      method: 'POST',
      endpoint: 'doctor-shifts',
      expectedIntegration: 'HOSPITAL_SCHEDULE_API',
      expectedResource: 'doctor-shifts',
    },
    {
      method: 'POST',
      endpoint: 'shift-change-requests',
      expectedIntegration: 'HOSPITAL_SCHEDULE_API',
      expectedResource: 'shift-change-requests',
    },
    {
      method: 'POST',
      endpoint: 'shift-change-requests/SCR-101/decide',
      expectedIntegration: 'HOSPITAL_SCHEDULE_API',
      expectedResource: 'shift-change-requests/SCR-101/decide',
    },
    {
      method: 'POST',
      endpoint: 'leaves',
      expectedIntegration: 'HOSPITAL_SCHEDULE_API',
      expectedResource: 'leaves',
    },
    {
      method: 'POST',
      endpoint: 'leaves/44/decide',
      expectedIntegration: 'HOSPITAL_SCHEDULE_API',
      expectedResource: 'leaves/44/decide',
    },
    {
      method: 'POST',
      endpoint: 'medical-records',
      expectedIntegration: 'HOSPITAL_CLINICAL_API',
      expectedResource: 'medical-records',
    },
    {
      method: 'POST',
      endpoint: 'prescriptions',
      expectedIntegration: 'HOSPITAL_CLINICAL_API',
      expectedResource: 'prescriptions',
    },
    {
      method: 'PUT',
      endpoint: 'medical-records/MR-1001',
      expectedIntegration: 'HOSPITAL_MODIFY_API',
      expectedResource: 'medical-records/MR-1001',
    },
    {
      method: 'DELETE',
      endpoint: 'prescriptions/RX-2001',
      expectedIntegration: 'HOSPITAL_MODIFY_API',
      expectedResource: 'prescriptions/RX-2001',
    },
    {
      method: 'PUT',
      endpoint: 'token_queue/19',
      expectedIntegration: 'HOSPITAL_MODIFY_API',
      expectedResource: 'token_queue/19',
    },
    {
      method: 'POST',
      endpoint: 'auth/login',
      expectedIntegration: 'HOSPITAL_PATIENT_AUTH_API',
      expectedResource: 'auth/login',
    },
    {
      method: 'POST',
      endpoint: 'auth/register',
      expectedIntegration: 'HOSPITAL_PATIENT_AUTH_API',
      expectedResource: 'auth/register',
    },
    {
      method: 'POST',
      endpoint: 'patients',
      expectedIntegration: 'HOSPITAL_PATIENT_AUTH_API',
      expectedResource: 'patients',
    },
    {
      method: 'PUT',
      endpoint: 'patients/77',
      expectedIntegration: 'HOSPITAL_PATIENT_AUTH_API',
      expectedResource: 'patients/77',
    },
    {
      method: 'POST',
      endpoint: 'users',
      expectedIntegration: 'HOSPITAL_PATIENT_AUTH_API',
      expectedResource: 'users',
    },
    {
      method: 'POST',
      endpoint: 'departments/',
      expectedIntegration: 'HOSPITAL_MASTER_DATA_API',
      expectedResource: 'departments',
    },
    {
      method: 'PUT',
      endpoint: 'consultation-types/5',
      expectedIntegration: 'HOSPITAL_MASTER_DATA_API',
      expectedResource: 'consultation-types/5',
    },
    {
      method: 'DELETE',
      endpoint: 'doctors/12',
      expectedIntegration: 'HOSPITAL_MASTER_DATA_API',
      expectedResource: 'doctors/12',
    },
  ];

  for (const c of cases) {
    const route = resolveOicIntegrationRoute(c.method, c.endpoint);
    assert.ok(route, `Expected OIC route for ${c.method} ${c.endpoint}`);
    assert.equal(route.integrationName, c.expectedIntegration);
    assert.equal(route.resourcePath, c.expectedResource);

    for (const mode of ['HYBRID', 'OIC'] as const) {
      const decision = resolveRoutingDecision({
        mode,
        method: c.method,
        endpoint: c.endpoint,
        oicConfigured: true,
        ordsBaseUrl: ORDS_URL,
        oicBaseUrl: OIC_URL,
      });
      assert.equal(decision.servedBy, 'OIC');
      assert.equal(decision.integrationName, c.expectedIntegration);
      assert.equal(
        decision.url,
        `${OIC_URL}/${c.expectedIntegration}/1.0/${c.expectedResource}`,
      );
    }

    const ordsFallback = resolveRoutingDecision({
      mode: 'ORDS',
      method: c.method,
      endpoint: c.endpoint,
      oicConfigured: true,
      ordsBaseUrl: ORDS_URL,
      oicBaseUrl: OIC_URL,
    });
    assert.equal(ordsFallback.servedBy, 'ORDS');
    assert.equal(ordsFallback.integrationName, null);
    assert.equal(ordsFallback.url, `${ORDS_URL}/${c.endpoint}`);
  }
});

test('ORDS-only write endpoints fall back cleanly to ORDS_BASE_URL even in HYBRID/OIC modes', () => {
  for (const ep of ['appointments/expire-holds', 'appointments/12/confirm', 'payments', 'cancellation-rules']) {
    const decision = resolveRoutingDecision({
      mode: 'HYBRID',
      method: 'POST',
      endpoint: ep,
      oicConfigured: true,
      ordsBaseUrl: ORDS_URL,
      oicBaseUrl: OIC_URL,
    });
    assert.equal(decision.servedBy, 'ORDS');
    assert.equal(decision.integrationName, null);
    assert.equal(decision.url, `${ORDS_URL}/${ep}`);
  }
});

test('normalizeOicMutationPayload ensures required schema strings are populated', () => {
  const deptPut = normalizeOicMutationPayload(
    'PUT',
    'departments/2',
    { department_name: 'Cardiology' },
    'Karan Tulsani',
  );
  assert.equal(deptPut.is_active, 'Y');
  assert.equal(deptPut.updated_by, 'Karan Tulsani');
  assert.equal(deptPut.description, '');

  const leaveDecide = normalizeOicMutationPayload('POST', 'leaves/12/decide', {
    admin_user_id: 1,
    decision: 'APPROVED',
  });
  assert.equal(leaveDecide.comments, '');

  const rxPost = normalizeOicMutationPayload('POST', 'prescriptions', {
    patient_id: 1,
    diagnosis: 'Viral Fever',
  });
  assert.ok(typeof rxPost.idempotency_key === 'string' && rxPost.idempotency_key.length > 0);
  assert.equal(rxPost.appointment_ref, '');

  const mrPost = normalizeOicMutationPayload('POST', 'medical-records', {
    patient_id: 1,
    chief_complaint: 'Fever',
    diagnosis: 'Viral',
    appointment_ref: null,
    vitals_summary: null,
  });
  assert.equal(mrPost.appointment_ref, '');
  assert.equal(mrPost.vitals_summary, '');
  assert.equal(mrPost.clinical_notes, '');

  const ctPost = normalizeOicMutationPayload('POST', 'consultation-types', {
    department_id: 1,
    consultation_type_name: 'General',
    duration_mins: 30,
  });
  assert.equal(ctPost.consultation_fee, 0);
  assert.equal(ctPost.description, '');
});

test('phase classification, catalogs, and ORDS collection payload normalization remain intact', () => {
  assert.equal(classifyEndpointPhase('departments/'), 'phase1');
  assert.equal(classifyEndpointPhase('auth/login'), 'phase2');
  assert.equal(classifyEndpointPhase('slots/25082'), 'phase3');
  assert.equal(classifyEndpointPhase('appointments/181/outcome'), 'phase4');
  assert.equal(classifyEndpointPhase('audit-logs'), 'phase5');
  assert.deepEqual(normalizeEnabledPhases(['phase1', 'invalid', 'phase1']), ['phase1']);
  assert.equal(ALL_OIC_PHASES.length, 5);
  assert.equal(OIC_PHASE_SPECS.length, 5);
  assert.equal(OIC_INTEGRATIONS_CATALOG.length, 7);

  assert.deepEqual(normalizeBackendPayload([{ department_id: 1 }]), {
    items: [{ department_id: 1 }],
  });
  assert.deepEqual(normalizeBackendPayload({ departments: [{ department_id: 2 }] }), {
    departments: [{ department_id: 2 }],
    items: [{ department_id: 2 }],
  });

  assert.equal(sanitizeEnvValue('  "https://example.com"  '), 'https://example.com');
  assert.equal(sanitizeEnvValue(" 'abc-123' "), 'abc-123');
  assert.equal(
    normalizeOicBaseUrl(
      ` "${OIC_URL}/CAREPULS_BOOK_APPOINTM_MAIN/1.0/metadata/swagger" `,
    ),
    OIC_URL,
  );

  const leavePost = normalizeOicMutationPayload('POST', 'leaves', {
    doctor_id: 2,
    start_date: '2026-12-01',
    end_date: '2026-12-02',
    leave_reason: 'Conference',
  });
  assert.equal(leavePost.requested_by, 1);

  const payConfirmPost = normalizeOicMutationPayload('POST', 'appointments/181/pay-and-confirm', {
    payment_method: 'UPI',
    amount: 500,
  });
  assert.equal(payConfirmPost.payment_method, 'UPI');
  assert.equal(payConfirmPost.amount, 500);

  const safeFallback = resolveRoutingDecision({
    mode: 'OIC',
    method: 'POST',
    endpoint: 'appointments/',
    oicConfigured: false,
    ordsBaseUrl: ORDS_URL,
    oicBaseUrl: OIC_URL,
  });
  assert.equal(safeFallback.servedBy, 'ORDS');
  assert.equal(safeFallback.url, `${ORDS_URL}/appointments/`);
});

