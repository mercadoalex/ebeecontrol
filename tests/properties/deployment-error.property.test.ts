import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createKoneyDeployer, HoneytokenSpec, HoneytokenType } from '../../src/koney/deployer';

/**
 * Feature: ebeecontrol, Property 5: Deployment Error Response Completeness
 *
 * For any failed honeytoken deployment, the error response SHALL contain a non-empty
 * pod identifier, a non-empty failure reason string, and at least one remediation action
 * from the set {retry_deployment, select_alternative_pod, escalate_to_operator}.
 *
 * Validates: Requirements 2.4
 */
describe('Feature: ebeecontrol, Property 5: Deployment Error Response Completeness', () => {
  const honeytokenTypes: HoneytokenType[] = ['decoy_secret', 'decoy_file', 'decoy_credential'];
  const validRemediationActions = new Set([
    'retry_deployment',
    'select_alternative_pod',
    'escalate_to_operator',
  ]);

  // Generate non-whitespace-only strings to pass validation
  const nonEmptyStringArb = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_\-./]{0,49}$/);

  const honeytokenSpecArb: fc.Arbitrary<HoneytokenSpec> = fc.record({
    type: fc.constantFrom(...honeytokenTypes),
    name: nonEmptyStringArb,
    placement: nonEmptyStringArb,
    content: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  });

  const failureReasonArb = fc.constantFrom(
    'permission denied',
    'access denied to pod',
    'network timeout',
    'connection refused',
    'resource quota exceeded',
    'capacity limit reached',
    'forbidden by policy',
    'unknown deployment error'
  );

  it('error response has non-empty podId, non-empty failureReason, and valid remediation actions', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb,
        nonEmptyStringArb,
        fc.array(honeytokenSpecArb, { minLength: 1, maxLength: 5 }),
        failureReasonArb,
        async (podId, namespace, honeytokens, failureReason) => {
          const deployer = createKoneyDeployer();

          // Set failure simulation to force deployment failure
          deployer.setFailureSimulation(() => failureReason);

          const response = await deployer.deploy({
            podId,
            namespace,
            honeytokens,
          });

          expect(response.success).toBe(false);
          expect(response.errors.length).toBeGreaterThan(0);

          for (const error of response.errors) {
            // Non-empty pod identifier
            expect(error.podId).toBeTruthy();
            expect(error.podId.trim().length).toBeGreaterThan(0);

            // Non-empty failure reason string
            expect(error.failureReason).toBeTruthy();
            expect(error.failureReason.trim().length).toBeGreaterThan(0);

            // At least one valid remediation action
            expect(error.remediationActions.length).toBeGreaterThanOrEqual(1);
            for (const action of error.remediationActions) {
              expect(validRemediationActions.has(action)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
