/**
 * Unit tests for the Vertex AI Trainer - model retraining and publishing logic.
 *
 * Covers:
 * - Model publish guard (Property 15): new model published only if accuracy >= current
 * - Retraining conditions (minimum records, interval)
 * - Outcome data ingestion and validation
 * - Failure handling (retain existing model, log failure)
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VertexAiTrainer, ModelVersion, TrainerConfig, ValidationError } from './trainer';
import { OutcomeData } from '../types/index';

/**
 * Helper to create a valid OutcomeData object for testing.
 */
function createValidOutcomeData(overrides?: Partial<OutcomeData>): OutcomeData {
  return {
    incidentId: `incident-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    accessEvent: {
      eventId: 'evt-001',
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
        actionId: 'action-001',
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
    ...overrides,
  };
}

/**
 * Subclass that allows controlling the simulated training accuracy for testing.
 */
class TestableTrainer extends VertexAiTrainer {
  private nextAccuracy: number | null = null;
  private shouldThrow: boolean = false;

  setNextAccuracy(accuracy: number): void {
    this.nextAccuracy = accuracy;
  }

  setTrainingFailure(shouldFail: boolean): void {
    this.shouldThrow = shouldFail;
  }

  protected simulateTraining(): number {
    if (this.shouldThrow) {
      throw new Error('Simulated training infrastructure failure');
    }
    if (this.nextAccuracy !== null) {
      const acc = this.nextAccuracy;
      this.nextAccuracy = null;
      return acc;
    }
    return super.simulateTraining();
  }
}

describe('VertexAiTrainer', () => {
  let trainer: TestableTrainer;
  const initialModel: ModelVersion = {
    versionId: 'v1.0.0',
    trainingDatasetSize: 100,
    validationAccuracy: 80,
    publishedTimestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
  };

  beforeEach(() => {
    trainer = new TestableTrainer(
      { retrainingIntervalHours: 24, minimumOutcomeRecords: 50 },
      initialModel
    );
  });

  describe('Configuration', () => {
    it('should use default config values when none provided', () => {
      const defaultTrainer = new VertexAiTrainer();
      const status = defaultTrainer.getTrainingStatus();
      expect(status.retrainingIntervalHours).toBe(24);
      expect(status.minimumRecordsRequired).toBe(50);
    });

    it('should accept custom config values within valid range', () => {
      const customTrainer = new VertexAiTrainer({ retrainingIntervalHours: 48, minimumOutcomeRecords: 100 });
      const status = customTrainer.getTrainingStatus();
      expect(status.retrainingIntervalHours).toBe(48);
    });

    it('should throw on retraining interval below 1 hour', () => {
      expect(() => new VertexAiTrainer({ retrainingIntervalHours: 0 })).toThrow();
    });

    it('should throw on retraining interval above 168 hours', () => {
      expect(() => new VertexAiTrainer({ retrainingIntervalHours: 169 })).toThrow();
    });

    it('should accept boundary values (1 and 168 hours)', () => {
      expect(() => new VertexAiTrainer({ retrainingIntervalHours: 1 })).not.toThrow();
      expect(() => new VertexAiTrainer({ retrainingIntervalHours: 168 })).not.toThrow();
    });
  });

  describe('Outcome Data Ingestion', () => {
    it('should ingest valid outcome data and increment dataset count', () => {
      const data = createValidOutcomeData();
      const confirmation = trainer.ingestOutcomeData(data);

      expect(confirmation.datasetEntryCount).toBe(1);
      expect(confirmation.ingestionTimestamp).toBeTruthy();
    });

    it('should increment dataset count for each ingestion', () => {
      for (let i = 0; i < 5; i++) {
        const confirmation = trainer.ingestOutcomeData(createValidOutcomeData());
        expect(confirmation.datasetEntryCount).toBe(i + 1);
      }
    });

    it('should reject outcome data missing incidentId', () => {
      const data = createValidOutcomeData({ incidentId: '' });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('incidentId');
    });

    it('should reject outcome data with whitespace-only incidentId', () => {
      const data = createValidOutcomeData({ incidentId: '   ' });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data missing accessEvent', () => {
      const data = createValidOutcomeData();
      (data as any).accessEvent = null;
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('accessEvent');
    });

    it('should reject outcome data missing honeytokenType', () => {
      const data = createValidOutcomeData({ honeytokenType: '' as any });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('honeytokenType');
    });

    it('should reject outcome data with invalid honeytokenType', () => {
      const data = createValidOutcomeData({ honeytokenType: 'invalid_type' as any });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('honeytokenType');
    });

    it('should reject outcome data with empty actionsTaken', () => {
      const data = createValidOutcomeData({ actionsTaken: [] });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('actionsTaken');
    });

    it('should reject outcome data with null actionsTaken', () => {
      const data = createValidOutcomeData();
      (data as any).actionsTaken = null;
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data missing effectiveness', () => {
      const data = createValidOutcomeData();
      (data as any).effectiveness = null;
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('effectiveness');
    });

    it('should reject outcome data with non-boolean threatContained', () => {
      const data = createValidOutcomeData();
      (data as any).effectiveness.threatContained = 'yes';
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with non-boolean falsePositive', () => {
      const data = createValidOutcomeData();
      (data as any).effectiveness.falsePositive = 1;
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with negative detectionToResponseLatencySeconds', () => {
      const data = createValidOutcomeData();
      data.effectiveness.detectionToResponseLatencySeconds = -1;
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with empty placementLocation', () => {
      const data = createValidOutcomeData({ placementLocation: '' });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('placementLocation');
    });

    it('should reject outcome data with whitespace-only placementLocation', () => {
      const data = createValidOutcomeData({ placementLocation: '   ' });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with invalid timestamp', () => {
      const data = createValidOutcomeData({ timestamp: 'not-a-date' });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
      expect(() => trainer.ingestOutcomeData(data)).toThrow('timestamp');
    });

    it('should reject outcome data with empty timestamp', () => {
      const data = createValidOutcomeData({ timestamp: '' });
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with empty accessEvent.eventId', () => {
      const data = createValidOutcomeData();
      data.accessEvent.eventId = '';
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with empty accessEvent.podId', () => {
      const data = createValidOutcomeData();
      data.accessEvent.podId = '';
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with empty accessEvent.namespace', () => {
      const data = createValidOutcomeData();
      data.accessEvent.namespace = '';
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with empty accessEvent.honeytokenPath', () => {
      const data = createValidOutcomeData();
      data.accessEvent.honeytokenPath = '';
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should reject outcome data with empty accessEvent.processBinaryPath', () => {
      const data = createValidOutcomeData();
      data.accessEvent.processBinaryPath = '';
      expect(() => trainer.ingestOutcomeData(data)).toThrow(ValidationError);
    });

    it('should not increment dataset on validation failure', () => {
      const invalidData = createValidOutcomeData({ incidentId: '' });
      try { trainer.ingestOutcomeData(invalidData); } catch {}
      expect(trainer.getDatasetSize()).toBe(0);
    });
  });

  describe('Training Status', () => {
    it('should return correct training status', () => {
      const status = trainer.getTrainingStatus();

      expect(status.lastRetrainingTimestamp).toBe(initialModel.publishedTimestamp);
      expect(status.datasetSizeSinceLastTraining).toBe(0);
      expect(status.minimumRecordsRequired).toBe(50);
      expect(status.retrainingIntervalHours).toBe(24);
      expect(status.nextScheduledRetraining).toBeTruthy();
    });

    it('should calculate next scheduled retraining correctly', () => {
      const status = trainer.getTrainingStatus();
      const lastTime = new Date(status.lastRetrainingTimestamp).getTime();
      const nextTime = new Date(status.nextScheduledRetraining).getTime();
      const expectedInterval = 24 * 60 * 60 * 1000; // 24 hours in ms

      expect(nextTime - lastTime).toBe(expectedInterval);
    });

    it('should track dataset size since last training', () => {
      for (let i = 0; i < 10; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }

      const status = trainer.getTrainingStatus();
      expect(status.datasetSizeSinceLastTraining).toBe(10);
    });
  });

  describe('shouldRetrain()', () => {
    it('should return true when interval elapsed and minimum records met', () => {
      // Initial model was set 25 hours ago, interval is 24 hours
      for (let i = 0; i < 50; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }

      expect(trainer.shouldRetrain()).toBe(true);
    });

    it('should return false when interval not elapsed', () => {
      // Create trainer with recent model
      const recentModel: ModelVersion = {
        versionId: 'v1.0.0',
        trainingDatasetSize: 100,
        validationAccuracy: 80,
        publishedTimestamp: new Date().toISOString(), // just now
      };
      const recentTrainer = new TestableTrainer(
        { retrainingIntervalHours: 24, minimumOutcomeRecords: 50 },
        recentModel
      );

      for (let i = 0; i < 50; i++) {
        recentTrainer.ingestOutcomeData(createValidOutcomeData());
      }

      expect(recentTrainer.shouldRetrain()).toBe(false);
    });

    it('should return false when minimum records not met', () => {
      // Interval elapsed (25 hours ago) but only 49 records
      for (let i = 0; i < 49; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }

      expect(trainer.shouldRetrain()).toBe(false);
    });

    it('should return false when neither condition is met', () => {
      const recentModel: ModelVersion = {
        versionId: 'v1.0.0',
        trainingDatasetSize: 100,
        validationAccuracy: 80,
        publishedTimestamp: new Date().toISOString(),
      };
      const recentTrainer = new TestableTrainer(
        { retrainingIntervalHours: 24, minimumOutcomeRecords: 50 },
        recentModel
      );

      // Only 10 records and interval not elapsed
      for (let i = 0; i < 10; i++) {
        recentTrainer.ingestOutcomeData(createValidOutcomeData());
      }

      expect(recentTrainer.shouldRetrain()).toBe(false);
    });
  });

  describe('Model Publish Guard (Property 15)', () => {
    beforeEach(() => {
      // Ingest 50 records to meet minimum requirement
      for (let i = 0; i < 50; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }
    });

    it('should publish new model when accuracy is higher than current', () => {
      // Current model accuracy is 80%
      trainer.setNextAccuracy(90);

      const result = trainer.triggerRetraining();

      expect(result.success).toBe(true);
      expect(result.newModel).toBeDefined();
      expect(result.newModel!.validationAccuracy).toBe(90);

      const currentModel = trainer.getCurrentModelVersion();
      expect(currentModel.validationAccuracy).toBe(90);
    });

    it('should publish new model when accuracy equals current', () => {
      // Current model accuracy is 80%
      trainer.setNextAccuracy(80);

      const result = trainer.triggerRetraining();

      expect(result.success).toBe(true);
      expect(result.newModel).toBeDefined();
      expect(result.newModel!.validationAccuracy).toBe(80);
    });

    it('should NOT publish new model when accuracy is lower than current', () => {
      // Current model accuracy is 80%
      trainer.setNextAccuracy(70);

      const result = trainer.triggerRetraining();

      expect(result.success).toBe(false);
      expect(result.newModel).toBeUndefined();
      expect(result.reason).toContain('70%');
      expect(result.reason).toContain('80%');

      // Current model should remain unchanged
      const currentModel = trainer.getCurrentModelVersion();
      expect(currentModel.validationAccuracy).toBe(80);
      expect(currentModel.versionId).toBe('v1.0.0');
    });

    it('should retain existing model on training failure', () => {
      trainer.setTrainingFailure(true);

      const result = trainer.triggerRetraining();

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Training failed');

      // Current model should remain unchanged
      const currentModel = trainer.getCurrentModelVersion();
      expect(currentModel.validationAccuracy).toBe(80);
      expect(currentModel.versionId).toBe('v1.0.0');
    });

    it('should reset dataset counter after successful retraining', () => {
      trainer.setNextAccuracy(90);
      trainer.triggerRetraining();

      const status = trainer.getTrainingStatus();
      expect(status.datasetSizeSinceLastTraining).toBe(0);
    });

    it('should NOT reset dataset counter after failed retraining', () => {
      trainer.setNextAccuracy(70); // lower than current 80%
      trainer.triggerRetraining();

      const status = trainer.getTrainingStatus();
      expect(status.datasetSizeSinceLastTraining).toBe(50);
    });

    it('should update lastRetrainingTimestamp after successful publish', () => {
      const beforeTimestamp = trainer.getTrainingStatus().lastRetrainingTimestamp;
      trainer.setNextAccuracy(90);

      trainer.triggerRetraining();

      const afterTimestamp = trainer.getTrainingStatus().lastRetrainingTimestamp;
      expect(new Date(afterTimestamp).getTime()).toBeGreaterThan(new Date(beforeTimestamp).getTime());
    });

    it('should NOT update lastRetrainingTimestamp after failed publish', () => {
      const beforeTimestamp = trainer.getTrainingStatus().lastRetrainingTimestamp;
      trainer.setNextAccuracy(70);

      trainer.triggerRetraining();

      const afterTimestamp = trainer.getTrainingStatus().lastRetrainingTimestamp;
      expect(afterTimestamp).toBe(beforeTimestamp);
    });
  });

  describe('triggerRetraining() - insufficient records', () => {
    it('should fail when fewer than 50 records since last training', () => {
      // Only ingest 30 records
      for (let i = 0; i < 30; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }

      const result = trainer.triggerRetraining();

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Insufficient outcome records');
      expect(result.reason).toContain('30');
      expect(result.reason).toContain('50');
    });

    it('should succeed with exactly 50 records', () => {
      for (let i = 0; i < 50; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }
      trainer.setNextAccuracy(90);

      const result = trainer.triggerRetraining();
      expect(result.success).toBe(true);
    });
  });

  describe('Logging', () => {
    it('should log ingestion events', () => {
      trainer.ingestOutcomeData(createValidOutcomeData());

      const logs = trainer.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].event).toBe('ingestion');
    });

    it('should log retraining failure due to insufficient records', () => {
      trainer.triggerRetraining();

      const logs = trainer.getLogs();
      expect(logs.some(l => l.event === 'retraining_failed')).toBe(true);
    });

    it('should log successful model publish', () => {
      for (let i = 0; i < 50; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }
      trainer.setNextAccuracy(90);
      trainer.triggerRetraining();

      const logs = trainer.getLogs();
      expect(logs.some(l => l.event === 'retraining_started')).toBe(true);
      expect(logs.some(l => l.event === 'model_published')).toBe(true);
    });

    it('should log model rejection when accuracy is lower', () => {
      for (let i = 0; i < 50; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }
      trainer.setNextAccuracy(70);
      trainer.triggerRetraining();

      const logs = trainer.getLogs();
      expect(logs.some(l => l.event === 'model_rejected')).toBe(true);
    });

    it('should log training infrastructure failure', () => {
      for (let i = 0; i < 50; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }
      trainer.setTrainingFailure(true);
      trainer.triggerRetraining();

      const logs = trainer.getLogs();
      expect(logs.some(l => l.event === 'retraining_failed' && l.details.includes('infrastructure failure'))).toBe(true);
    });
  });

  describe('getCurrentModelVersion()', () => {
    it('should return a copy of the current model', () => {
      const model = trainer.getCurrentModelVersion();
      model.validationAccuracy = 999; // mutate the copy

      // Original should be unchanged
      const original = trainer.getCurrentModelVersion();
      expect(original.validationAccuracy).toBe(80);
    });

    it('should reflect updated model after successful retraining', () => {
      for (let i = 0; i < 50; i++) {
        trainer.ingestOutcomeData(createValidOutcomeData());
      }
      trainer.setNextAccuracy(95);
      trainer.triggerRetraining();

      const model = trainer.getCurrentModelVersion();
      expect(model.validationAccuracy).toBe(95);
      expect(model.versionId).not.toBe('v1.0.0');
      expect(model.trainingDatasetSize).toBe(50);
    });
  });
});
