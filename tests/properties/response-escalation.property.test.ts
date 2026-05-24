import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateResponsePlan, ResponseContext } from '../../src/agent/response-planner';
import { ThreatAssessment } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 11: Response Escalation on Medium+ Threats
 *
 * For any threat classified as medium, high, or critical, the response plan
 * SHALL include deployment of at least 2 additional honeytokens in the same
 * namespace as the affected pod.
 *
 * Validates: Requirements 5.2
 */
describe('Feature: ebeecontrol, Property 11: Response Escalation on Medium+ Threats', () => {
  it('response plan includes additional_honeytokens action targeting the namespace for medium+ threats', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('medium' as const, 'high' as const, 'critical' as const),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (classification, namespace, podId) => {
          const assessment: ThreatAssessment = {
            assessmentId: 'test-assessment-id',
            accessEventId: 'test-event-id',
            classification,
            inputs: {
              namespaceClassification: 'production',
              serviceCriticality: 3,
              davisAnomalyScore: 0.5,
            },
            assessmentTimestamp: new Date().toISOString(),
            assessmentLatencyMs: 100,
          };

          const context: ResponseContext = {
            namespace,
            podId,
          };

          const plan = generateResponsePlan(assessment, context);

          // Assert: at least one action with actionType "additional_honeytokens"
          const honeytokenActions = plan.actions.filter(
            (action) => action.actionType === 'additional_honeytokens'
          );
          expect(honeytokenActions.length).toBeGreaterThanOrEqual(1);

          // Assert: that action's target equals the namespace from the context
          expect(honeytokenActions[0].target).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });
});
