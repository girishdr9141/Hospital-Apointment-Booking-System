import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_OIC_PHASES,
  OIC_PHASE_SPECS,
  buildUpstreamUrl,
  classifyEndpointPhase,
  normalizeBackendPayload,
  normalizeEnabledPhases,
  shouldUseOicForEndpoint,
} from './backendRouter';

test('classifyEndpointPhase assigns every OPD resource to phases 1 through 5', () => {
  assert.equal(classifyEndpointPhase('departments/'), 'phase1');
  assert.equal(classifyEndpointPhase('/consultation-types?limit=500'), 'phase1');
  assert.equal(classifyEndpointPhase('cancellation-rules'), 'phase1');

  assert.equal(classifyEndpointPhase('auth/login'), 'phase2');
  assert.equal(classifyEndpointPhase('auth/register'), 'phase2');
  assert.equal(classifyEndpointPhase('doctors/3'), 'phase2');
  assert.equal(classifyEndpointPhase('patients?email=test@example.com'), 'phase2');

  assert.equal(classifyEndpointPhase('slot_templates'), 'phase3');
  assert.equal(classifyEndpointPhase('slots/25082'), 'phase3');
  assert.equal(classifyEndpointPhase('doctor-shifts'), 'phase3');
  assert.equal(classifyEndpointPhase('shift-change-requests/SCR-101/decide'), 'phase3');

  assert.equal(classifyEndpointPhase('appointments/181/outcome'), 'phase4');
  assert.equal(classifyEndpointPhase('appointments/expire-holds'), 'phase4');
  assert.equal(classifyEndpointPhase('leaves/12/decide'), 'phase4');
  assert.equal(classifyEndpointPhase('payments'), 'phase4');
  assert.equal(classifyEndpointPhase('token_queue/5'), 'phase4');
  assert.equal(classifyEndpointPhase('medical-records/MR-1001'), 'phase4');
  assert.equal(classifyEndpointPhase('prescriptions/RX-2001'), 'phase4');

  assert.equal(classifyEndpointPhase('users'), 'phase5');
  assert.equal(classifyEndpointPhase('roles'), 'phase5');
  assert.equal(classifyEndpointPhase('reports/utilisation'), 'phase5');
  assert.equal(classifyEndpointPhase('audit-logs'), 'phase5');
});

test('shouldUseOicForEndpoint respects mode, configuration, and enabled phase scope', () => {
  assert.equal(shouldUseOicForEndpoint('ords', ALL_OIC_PHASES, 'departments/', true), false);
  assert.equal(shouldUseOicForEndpoint('oic', ALL_OIC_PHASES, 'departments/', false), false);
  assert.equal(shouldUseOicForEndpoint('oic', ALL_OIC_PHASES, 'appointments/181/confirm', true), true);
  assert.equal(shouldUseOicForEndpoint('oic', ['phase1'], 'departments/', true), true);
  assert.equal(shouldUseOicForEndpoint('oic', ['phase1'], 'appointments', true), false);
  assert.deepEqual(normalizeEnabledPhases(['phase1', 'invalid', 'phase1']), ['phase1']);
});

test('buildUpstreamUrl preserves ORDS trailing slashes and normalizes OIC resource paths', () => {
  const ords = 'https://example.oraclecloudapps.com/ords/opd/v1/';
  const oic = 'https://oic.example.com/ic/api/integration/v1/flows/rest/OPD/1.0/';

  assert.equal(
    buildUpstreamUrl(ords, oic, 'departments/?limit=500', 'ords'),
    'https://example.oraclecloudapps.com/ords/opd/v1/departments/?limit=500',
  );
  assert.equal(
    buildUpstreamUrl(ords, oic, 'departments/?limit=500', 'oic'),
    'https://oic.example.com/ic/api/integration/v1/flows/rest/OPD/1.0/departments?limit=500',
  );
  assert.equal(
    buildUpstreamUrl(ords, oic, 'appointments/101/confirm', 'oic'),
    'https://oic.example.com/ic/api/integration/v1/flows/rest/OPD/1.0/appointments/101/confirm',
  );
});

test('normalizeBackendPayload wraps raw arrays and named collections into ORDS { items } shape', () => {
  assert.deepEqual(normalizeBackendPayload([{ department_id: 1 }]), {
    items: [{ department_id: 1 }],
  });
  assert.deepEqual(normalizeBackendPayload({ departments: [{ department_id: 2 }] }), {
    departments: [{ department_id: 2 }],
    items: [{ department_id: 2 }],
  });
  assert.deepEqual(normalizeBackendPayload({ status: 'success', expired_count: 1 }), {
    status: 'success',
    expired_count: 1,
  });
  assert.equal(OIC_PHASE_SPECS.length, 5);
});
