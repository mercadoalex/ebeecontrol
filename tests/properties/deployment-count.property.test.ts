import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createKoneyDeployer, HoneytokenSpec, HoneytokenType } from '../../src/koney/deployer';

/**
 * Feature: ebeecontrol, Property 3: Deployment Count Invariant
 *
 * For any valid deployment request targeting a single pod, the number of honeytokens
 * deployed SHALL be between 1 and 5 inclusive.
 *
 * Validates: Requirements 2.1
 */
describe('Feature: ebeecontrol, Property 3: Deployment Count Invariant', () => {
  const honeytokenTypes: HoneytokenType[] = ['decoy_secret', 'decoy_file', 'decoy_credential'];

  // Generate non-whitespace-only strings to pass validation
  const nonEmptyStringArb = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_\-./]{0,49}$/);

  const honeytokenSpecArb: fc.Arbitrary<HoneytokenSpec> = fc.record({
    type: fc.constantFrom(...honeytokenTypes),
    name: nonEmptyStringArb,
    placement: nonEmptyStringArb,
    content: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  });

  it('deployment count is between 1 and 5 for any valid request', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb,
        nonEmptyStringArb,
        fc.array(honeytokenSpecArb, { minLength: 1, maxLength: 5 }),
        async (podId, namespace, honeytokens) => {
          const deployer = createKoneyDeployer();

          const response = await deployer.deploy({
            podId,
            namespace,
            honeytokens,
          });

          expect(response.success).toBe(true);
          expect(response.deployedHoneytokens.length).toBeGreaterThanOrEqual(1);
          expect(response.deployedHoneytokens.length).toBeLessThanOrEqual(5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects deployment requests with more than 5 honeytokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb,
        nonEmptyStringArb,
        fc.array(honeytokenSpecArb, { minLength: 6, maxLength: 10 }),
        async (podId, namespace, honeytokens) => {
          const deployer = createKoneyDeployer();

          const response = await deployer.deploy({
            podId,
            namespace,
            honeytokens,
          });

          expect(response.success).toBe(false);
          expect(response.deployedHoneytokens.length).toBe(0);
          expect(response.errors.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
