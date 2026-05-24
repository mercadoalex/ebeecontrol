import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { VertexAiTrainer, ModelVersion } from '../../src/vertex/trainer';
import { OutcomeData, AccessEvent, ResponseAction } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 15: Model Publish Guard
 *
 * For any completed retraining cycle producing a new model with validation accuracy
 * A_new and a currently deployed model with accuracy A_current, the new model SHALL
 * be published if and only if A_new >= A_current.
 *
 * Validates: Requirements 7.4
 */

/**
 * Subclass that allows controlling the simulated training accuracy for testing.
 */
class TestableTrainer extends VertexAiTrainer {
  private nextAccuracy: number | null = null;

  setNextAccuracy(accuracy: number): void {
    this.nextAccuracy = accuracy;
  }

  protected simulateTraining(): number {
    if (this.nextAccuracy !== null) {
      const acc = this.nextAccuracy;
      this.nextAccuracy = null;
      return acc;
    }
    return super.simulateTraining();
  }
}

/**
 * Helper to create a valid OutcomeData object for populating the trainer.
 */
function createValidOutcomeData(): OutcomeData {
  return {
    incidentId: `incident-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    accessEvent: {
      eventId: `evt-${Math.random().toString(36).slice(2)}`,
      processId: 1234,
      processBinaryPath: '/usr/bin/cat',
      userId: 1000,
      podId: 'pod-abc',
      namespace: 'production',
      honeytokenPath: '/etc/secrets/decoy.key',
      accessType: 'read',
      timestamp: new Date().toISOString(),
    },
    honeytokenType: 'decoy_secret',
    placementLocation: '/etc/secrets/decoy.key',
    actionsTaken: [
      {
        actionId: `action-${Math.random().toString(36).slice(2)}`,
        actionType: 'pod_isolation',
        target: 'pod-abc',
        timestamp: new Date().toISOString(),
        threatClassification: 'high',
        result: 'success',
        retryCount: 0,
      },
    ],
    effectiveness: {
      detectionToResponseLatencySeconds: 3.5,
      threatContained: true,
      falsePositive: false,
    },
    timestamp: new Date().toISOString(),
  };
}

describe('Feature: ebeecontrol, Property 15: Model Publish Guard', () => {
  it('new model is published if and only if A_new >= A_current', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 70, max: 99 }), // A_current
        fc.integer({ min: 70, max: 99 }), // A_new
        (aCurrent, aNew) => {
          const initialModel: ModelVersion = {
            versionId: 'v1.0.0',
            trainingDatasetSize: 100,
            validationAccuracy: aCurrent,
            publishedTimestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
          };

          const trainer = new TestableTrainer(
            { retrainingIntervalHours: 24, minimumOutcomeRecords: 50 },
            initialModel
          );

          // Ingest 50 records to meet minimum requirement
          for (let i = 0; i < 50; i++) {
            trainer.ingestOutcomeData(createValidOutcomeData());
          }

          // Set the accuracy the training will produce
          trainer.setNextAccuracy(aNew);

          const modelBefore = trainer.getCurrentModelVersion();
          const result = trainer.triggerRetraining();

          const modelAfter = trainer.getCurrentModelVersion();

          if (aNew >= aCurrent) {
            // New model should be published
            expect(result.success).toBe(true);
            expect(result.newModel).toBeDefined();
            expect(result.newModel!.validationAccuracy).toBe(aNew);
            expect(modelAfter.validationAccuracy).toBe(aNew);
            expect(modelAfter.versionId).not.toBe(modelBefore.versionId);
          } else {
            // Existing model should remain deployed unchanged
            expect(result.success).toBe(false);
            expect(result.newModel).toBeUndefined();
            expect(modelAfter.validationAccuracy).toBe(aCurrent);
            expect(modelAfter.versionId).toBe(modelBefore.versionId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
