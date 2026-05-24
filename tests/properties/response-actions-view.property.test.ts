import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toResponseActionViewModel } from '../../src/dynatrace-ingestion/view-models';
import { ResponseActionLogPayload } from '../../src/types/dynatrace-ingestion';

/**
 * Feature: ebeecontrol, Property 24: Response Actions View Completeness
 *
 * For any response action displayed, the view model SHALL contain: an action type
 * from {pod_isolation, ip_block, additional_honeytokens}, a non-empty target,
 * a triggering classification from {low, medium, high, critical}, a valid ISO 8601
 * timestamp, and an outcome from {success, failure, pending}.
 *
 * Validates: Requirements 9.5
 */
describe('Feature: ebeecontrol, Property 24: Response Actions View Completeness', () => {
  const actionTypeArb = fc.constantFrom(
    'pod_isolation' as const,
    'ip_block' as const,
    'additional_honeytokens' as const
  );

  const classificationArb = fc.constantFrom(
    'low' as const,
    'medium' as const,
    'high' as const,
    'critical' as const
  );

  const outcomeArb = fc.constantFrom(
    'success' as const,
    'failure' as const,
    'pending' as const
  );

  const timestampArb = fc
    .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString());

  const responseActionPayloadArb: fc.Arbitrary<ResponseActionLogPayload> = fc.record({
    actionId: fc.uuid(),
    actionType: actionTypeArb,
    target: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
    triggeringClassification: classificationArb,
    timestamp: timestampArb,
    outcome: outcomeArb,
  });

  it('view model contains all required fields with valid values', () => {
    fc.assert(
      fc.property(responseActionPayloadArb, (payload) => {
        const vm = toResponseActionViewModel(payload);

        // actionType must be from the valid set
        expect(['pod_isolation', 'ip_block', 'additional_honeytokens']).toContain(
          vm.actionType
        );

        // target must be non-empty
        expect(vm.target).toBeTruthy();
        expect(vm.target.trim().length).toBeGreaterThan(0);

        // triggeringClassification must be from the valid set
        expect(['low', 'medium', 'high', 'critical']).toContain(
          vm.triggeringClassification
        );

        // timestamp must be a valid ISO 8601 string
        expect(vm.timestamp).toBeTruthy();
        const parsedDate = new Date(vm.timestamp);
        expect(parsedDate.getTime()).not.toBeNaN();

        // outcome must be from the valid set
        expect(['success', 'failure', 'pending']).toContain(vm.outcome);
      }),
      { numRuns: 100 }
    );
  });

  it('view model preserves the original payload values', () => {
    fc.assert(
      fc.property(responseActionPayloadArb, (payload) => {
        const vm = toResponseActionViewModel(payload);

        expect(vm.actionId).toBe(payload.actionId);
        expect(vm.actionType).toBe(payload.actionType);
        expect(vm.target).toBe(payload.target);
        expect(vm.triggeringClassification).toBe(payload.triggeringClassification);
        expect(vm.timestamp).toBe(payload.timestamp);
        expect(vm.outcome).toBe(payload.outcome);
      }),
      { numRuns: 100 }
    );
  });

  it('view model includes human-readable labels for all enum fields', () => {
    fc.assert(
      fc.property(responseActionPayloadArb, (payload) => {
        const vm = toResponseActionViewModel(payload);

        // actionTypeLabel must be non-empty
        expect(vm.actionTypeLabel).toBeTruthy();
        expect(vm.actionTypeLabel.trim().length).toBeGreaterThan(0);

        // classificationLabel must be non-empty
        expect(vm.classificationLabel).toBeTruthy();
        expect(vm.classificationLabel.trim().length).toBeGreaterThan(0);

        // outcomeLabel must be non-empty
        expect(vm.outcomeLabel).toBeTruthy();
        expect(vm.outcomeLabel.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
