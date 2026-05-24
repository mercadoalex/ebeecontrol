import { describe, it, expect } from 'vitest';
import { createLearningFeedbackLoop, IncidentData, ResponseResult } from './learning-feedback';
import { VertexAiTrainer } from '../vertex/trainer';
import { createAuditLog } from './audit-log';
import { AccessEvent, ResponseAction } from '../types/index';

describe('LearningFeedbackLoop', () => {
  function createTestAccessEvent(): AccessEvent {
    return {
      eventId: 'evt-001',
      processId: 1234,
      processBinaryPath: '/usr/bin/curl',
      userId: 1000,
      podId: 'pod-abc123',
      namespace: 'production',
      honeytokenPath: '/secrets/api-key.txt',
      accessType: 'read',
      timestamp: new Date().toISOString(),
    };
  }

  function createTestIncident(): IncidentData {
    return {
      incidentId: 'inc-001',
      accessEvent: createTestAccessEvent(),
      honeytokenType: 'decoy_secret',
      placementLocation: '/secrets/api-key.txt',
    };
  }

  function createTestResponseResult(): ResponseResult {
    const action: ResponseAction = {
      actionId: 'act-001',
      actionType: 'pod_isolation',
      target: 'pod-abc123',
      timestamp: new Date().toISOString(),
      threatClassification: 'high',
      result: 'success',
      retryCount: 0,
    };

    return {
      actionsTaken: [action],
      effectiveness: {
        detectionToResponseLatencySeconds: 3.5,
        threatContained: true,
        falsePositive: false,
      },
    };
  }

  describe('submitOutcome', () => {
    it('should submit outcome data to the trainer and log to audit log', async () => {
      const trainer = new VertexAiTrainer();
      const auditLog = createAuditLog();
      const feedbackLoop = createLearningFeedbackLoop(trainer, auditLog);

      const incident = createTestIncident();
      const responseResult = createTestResponseResult();

      await feedbackLoop.submitOutcome(incident, responseResult);

      // Verify data was ingested into the trainer
      expect(trainer.getDatasetSize()).toBe(1);

      // Verify audit log entry was created
      const entries = auditLog.getByType('learning');
      expect(entries).toHaveLength(1);
      expect(entries[0].decisionRationale).toContain('inc-001');
      expect(entries[0].inputDataSummary).toContain('incidentId=inc-001');
      expect(entries[0].inputDataSummary).toContain('honeytokenType=decoy_secret');
      expect(entries[0].outcome).toContain('Dataset entry count: 1');
    });

    it('should build OutcomeData correctly from incident and response result', async () => {
      const trainer = new VertexAiTrainer();
      const auditLog = createAuditLog();
      const feedbackLoop = createLearningFeedbackLoop(trainer, auditLog);

      const incident = createTestIncident();
      const responseResult = createTestResponseResult();

      await feedbackLoop.submitOutcome(incident, responseResult);

      // The trainer should have received the data (dataset size = 1)
      expect(trainer.getDatasetSize()).toBe(1);
    });

    it('should handle multiple outcome submissions', async () => {
      const trainer = new VertexAiTrainer();
      const auditLog = createAuditLog();
      const feedbackLoop = createLearningFeedbackLoop(trainer, auditLog);

      const incident1 = createTestIncident();
      const incident2: IncidentData = {
        ...createTestIncident(),
        incidentId: 'inc-002',
        honeytokenType: 'decoy_file',
      };
      const responseResult = createTestResponseResult();

      await feedbackLoop.submitOutcome(incident1, responseResult);
      await feedbackLoop.submitOutcome(incident2, responseResult);

      expect(trainer.getDatasetSize()).toBe(2);

      const entries = auditLog.getByType('learning');
      expect(entries).toHaveLength(2);
    });
  });

  describe('applyModelUpdate', () => {
    it('should log model update when a new model version is available', async () => {
      const trainer = new VertexAiTrainer(
        { retrainingIntervalHours: 1, minimumOutcomeRecords: 1 },
        {
          versionId: 'v1.0.0',
          trainingDatasetSize: 100,
          validationAccuracy: 80,
          publishedTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        }
      );
      const auditLog = createAuditLog();
      const feedbackLoop = createLearningFeedbackLoop(trainer, auditLog);

      // Ingest enough data and trigger retraining to get a new model
      const incident = createTestIncident();
      const responseResult = createTestResponseResult();
      await feedbackLoop.submitOutcome(incident, responseResult);

      // Force a retraining that produces a better model
      // We need to override simulateTraining to guarantee a higher accuracy
      class TestTrainer extends VertexAiTrainer {
        protected simulateTraining(): number {
          return 95; // Always produce a better model
        }
      }

      const testTrainer = new TestTrainer(
        { retrainingIntervalHours: 1, minimumOutcomeRecords: 1 },
        {
          versionId: 'v1.0.0',
          trainingDatasetSize: 100,
          validationAccuracy: 80,
          publishedTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        }
      );
      const testAuditLog = createAuditLog();
      const testFeedbackLoop = createLearningFeedbackLoop(testTrainer, testAuditLog);

      // Submit outcome data
      await testFeedbackLoop.submitOutcome(incident, responseResult);

      // Trigger retraining (will produce a new model with accuracy 95 >= 80)
      testTrainer.triggerRetraining();

      // Apply model update
      await testFeedbackLoop.applyModelUpdate();

      // Verify audit log entry for model update
      const modelUpdateEntries = testAuditLog.getByType('model_update');
      expect(modelUpdateEntries).toHaveLength(1);
      expect(modelUpdateEntries[0].decisionRationale).toContain('Applied updated placement model');
      expect(modelUpdateEntries[0].inputDataSummary).toContain('version=');
      expect(modelUpdateEntries[0].inputDataSummary).toContain('datasetSize=');
      expect(modelUpdateEntries[0].inputDataSummary).toContain('accuracy=');
      expect(modelUpdateEntries[0].outcome).toContain('Validation accuracy: 95%');
    });

    it('should not log when model version has not changed', async () => {
      const trainer = new VertexAiTrainer();
      const auditLog = createAuditLog();
      const feedbackLoop = createLearningFeedbackLoop(trainer, auditLog);

      // Apply model update without any retraining
      await feedbackLoop.applyModelUpdate();

      // No model_update entries should exist
      const modelUpdateEntries = auditLog.getByType('model_update');
      expect(modelUpdateEntries).toHaveLength(0);
    });

    it('should detect model version change on subsequent calls', async () => {
      class TestTrainer extends VertexAiTrainer {
        protected simulateTraining(): number {
          return 99;
        }
      }

      const testTrainer = new TestTrainer(
        { retrainingIntervalHours: 1, minimumOutcomeRecords: 1 },
        {
          versionId: 'v1.0.0',
          trainingDatasetSize: 0,
          validationAccuracy: 70,
          publishedTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        }
      );
      const auditLog = createAuditLog();
      const feedbackLoop = createLearningFeedbackLoop(testTrainer, auditLog);

      // First call - no change
      await feedbackLoop.applyModelUpdate();
      expect(auditLog.getByType('model_update')).toHaveLength(0);

      // Submit data and retrain
      const incident = createTestIncident();
      const responseResult = createTestResponseResult();
      await feedbackLoop.submitOutcome(incident, responseResult);
      testTrainer.triggerRetraining();

      // Second call - model changed
      await feedbackLoop.applyModelUpdate();
      expect(auditLog.getByType('model_update')).toHaveLength(1);

      // Third call - no change (same model)
      await feedbackLoop.applyModelUpdate();
      expect(auditLog.getByType('model_update')).toHaveLength(1);
    });
  });
});
