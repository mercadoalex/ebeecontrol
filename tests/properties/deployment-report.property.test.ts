import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createKoneyDeployer, HoneytokenSpec, HoneytokenType } from '../../src/koney/deployer';

/**
 * Feature: ebeecontrol, Property 4: Deployment Report Completeness
 *
 * For any successful honeytoken deployment, the deployment report SHALL contain a
 * non-empty pod identifier, a non-empty namespace, a honeytoken type from the set
 * {decoy_secret, decoy_file, decoy_credential}, and a valid ISO 8601 deployment timestamp.
 *
 * Validates: Requirements 2.3
 */
describe('Feature: ebeecontrol, Property 4: Deployment Report Completeness', () => {
  const honeytokenTypes: HoneytokenType[] = ['decoy_secret', 'decoy_file', 'decoy_credential'];
  const validTypes = new Set(honeytokenTypes);

  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

  // Generate non-whitespace-only strings to pass validation
  const nonEmptyStringArb = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_\-./]{0,49}$/);

  const honeytokenSpecArb: fc.Arbitrary<HoneytokenSpec> = fc.record({
    type: fc.constantFrom(...honeytokenTypes),
    name: nonEmptyStringArb,
    placement: nonEmptyStringArb,
    content: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  });

  it('each deployed honeytoken has non-empty podId, non-empty namespace, valid type, and valid ISO 8601 timestamp', async () => {
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

          for (const deployed of response.deployedHoneytokens) {
            // Non-empty pod identifier
            expect(deployed.podId).toBeTruthy();
            expect(deployed.podId.trim().length).toBeGreaterThan(0);

            // Non-empty namespace
            expect(deployed.namespace).toBeTruthy();
            expect(deployed.namespace.trim().length).toBeGreaterThan(0);

            // Valid honeytoken type
            expect(validTypes.has(deployed.type)).toBe(true);

            // Valid ISO 8601 deployment timestamp
            expect(deployed.deploymentTimestamp).toMatch(iso8601Regex);
            const parsedDate = new Date(deployed.deploymentTimestamp);
            expect(parsedDate.getTime()).not.toBeNaN();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
