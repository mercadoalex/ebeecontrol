import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { VertexAiTrainer } from '../../src/vertex/trainer';
import { OutcomeData, AccessEvent, ResponseAction } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 14: Outcome Data Validation and Ingestion
 *
 * For any valid outcome data submitted to the Vertex_AI_Trainer, the training
 * dataset entry count SHALL increment by exactly 1 after successful ingestion.
 *
 * Validates: Requirements 7.2
 */
describe('Feature: ebeecontrol, Property 14: Outcome Data Validation and Ingestion', () => {
  const accessTypeArb = fc.constantFrom('open' as const, 'read' as const, 'write' as const, 'stat' as const);
  const classificationArb = fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const);
  const honeytokenTypeArb = fc.constantFrom('decoy_secret' as const, 'decoy_file' as const, 'decoy_credential' as const);
  const resultArb = fc.constantFrom('success' as const, 'failure' as const);
  const actionTypeArb = fc.constantFrom(
    'pod_isolation' as const,
    'ip_block' as const,
    'additional_honeytokens' as const,
    'alert' as const
  );

  const accessEventArb: fc.Arbitrary<AccessEvent> = fc.record({
    eventId: fc.uuid(),
    processId: fc.integer({ min: 1, max: 65535 }),
    processBinaryPath: fc.stringMatching(/^\/[a-z][a-z0-9/]{1,30}$/),
    userId: fc.integer({ min: 0, max: 65535 }),
    podId: fc.stringMatching(/^pod-[a-z0-9]{3,10}$/),
    namespace: fc.stringMatching(/^[a-z][a-z0-9-]{2,15}$/),
    honeytokenPath: fc.stringMatching(/^\/[a-z][a-z0-9/.]{2,30}$/),
    accessType: accessTypeArb,
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
  });

  const responseActionArb: fc.Arbitrary<ResponseAction> = fc.record({
    actionId: fc.uuid(),
    actionType: actionTypeArb,
    target: fc.stringMatching(/^[a-z][a-z0-9-]{2,15}$/),
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
    threatClassification: classificationArb,
    result: resultArb,
    retryCount: fc.integer({ min: 0, max: 5 }),
  });

  const outcomeDataArb: fc.Arbitrary<OutcomeData> = fc.record({
    incidentId: fc.uuid(),
    accessEvent: accessEventArb,
    honeytokenType: honeytokenTypeArb,
    placementLocation: fc.stringMatching(/^\/[a-z][a-z0-9/.]{2,30}$/),
    actionsTaken: fc.array(responseActionArb, { minLength: 1, maxLength: 5 }),
    effectiveness: fc.record({
      detectionToResponseLatencySeconds: fc.double({ min: 0.1, max: 300, noNaN: true }),
      threatContained: fc.boolean(),
      falsePositive: fc.boolean(),
    }),
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
  });

  it('dataset entry count increments by exactly 1 after each successful ingestion', () => {
    fc.assert(
      fc.property(
        fc.array(outcomeDataArb, { minLength: 1, maxLength: 10 }),
        (outcomeDataList) => {
          const trainer = new VertexAiTrainer();

          for (let i = 0; i < outcomeDataList.length; i++) {
            const countBefore = trainer.getDatasetSize();
            const confirmation = trainer.ingestOutcomeData(outcomeDataList[i]);

            // Dataset count increments by exactly 1
            expect(confirmation.datasetEntryCount).toBe(countBefore + 1);
            expect(trainer.getDatasetSize()).toBe(countBefore + 1);

            // Confirmation includes a valid ingestion timestamp
            expect(confirmation.ingestionTimestamp).toBeTruthy();
            expect(new Date(confirmation.ingestionTimestamp).getTime()).not.toBeNaN();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
