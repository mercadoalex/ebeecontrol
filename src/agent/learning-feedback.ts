/**
 * Learning Feedback Loop for the Ebeecontrol Agent.
 *
 * Submits outcome data to Vertex AI within 60 seconds of response completion.
 * Applies updated placement models when received from the trainer.
 * Logs model updates with version, dataset size, and accuracy to audit log.
 *
 * Validates: Requirements 7.1, 7.5, 8.1
 */

import { OutcomeData, AccessEvent, ResponseAction } from '../types/index';
import { VertexAiTrainer, ModelVersion } from '../vertex/trainer';
import { AuditLog } from './audit-log';

/**
 * Incident data used to build outcome data for the learning feedback loop.
 */
export interface IncidentData {
  incidentId: string;
  accessEvent: AccessEvent;
  honeytokenType: 'decoy_secret' | 'decoy_file' | 'decoy_credential';
  placementLocation: string;
}

/**
 * Response result data used to build outcome data for the learning feedback loop.
 */
export interface ResponseResult {
  actionsTaken: ResponseAction[];
  effectiveness: {
    detectionToResponseLatencySeconds: number;
    threatContained: boolean;
    falsePositive: boolean;
  };
}

/**
 * Interface for the learning feedback loop.
 */
export interface LearningFeedbackLoop {
  submitOutcome(incident: IncidentData, responseResult: ResponseResult): Promise<void>;
  applyModelUpdate(): Promise<void>;
}

/**
 * Creates a LearningFeedbackLoop instance that manages outcome submission
 * and model update application.
 *
 * The feedback loop:
 * 1. Accepts VertexAiTrainer and AuditLog as dependencies
 * 2. Builds OutcomeData from incident + response result
 * 3. Submits outcome data to the trainer within 60s
 * 4. Checks if the trainer has a new model and logs the update
 */
export function createLearningFeedbackLoop(
  trainer: VertexAiTrainer,
  auditLog: AuditLog
): LearningFeedbackLoop {
  let lastKnownModelVersion: string = trainer.getCurrentModelVersion().versionId;

  async function submitOutcome(
    incident: IncidentData,
    responseResult: ResponseResult
  ): Promise<void> {
    const outcomeData: OutcomeData = {
      incidentId: incident.incidentId,
      accessEvent: incident.accessEvent,
      honeytokenType: incident.honeytokenType,
      placementLocation: incident.placementLocation,
      actionsTaken: responseResult.actionsTaken,
      effectiveness: responseResult.effectiveness,
      timestamp: new Date().toISOString(),
    };

    // Submit within 60 seconds (the call itself is synchronous in our implementation)
    const confirmation = trainer.ingestOutcomeData(outcomeData);

    auditLog.log({
      decisionType: 'learning',
      decisionRationale: `Submitted outcome data for incident ${incident.incidentId} to Vertex AI Trainer`,
      inputDataSummary: `incidentId=${incident.incidentId}, honeytokenType=${incident.honeytokenType}, actionsTaken=${responseResult.actionsTaken.length}, threatContained=${responseResult.effectiveness.threatContained}`,
      outcome: `Ingested successfully. Dataset entry count: ${confirmation.datasetEntryCount}`,
    });
  }

  async function applyModelUpdate(): Promise<void> {
    const currentModel: ModelVersion = trainer.getCurrentModelVersion();

    if (currentModel.versionId !== lastKnownModelVersion) {
      // A new model has been published
      lastKnownModelVersion = currentModel.versionId;

      auditLog.log({
        decisionType: 'model_update',
        decisionRationale: `Applied updated placement model from Vertex AI Trainer`,
        inputDataSummary: `version=${currentModel.versionId}, datasetSize=${currentModel.trainingDatasetSize}, accuracy=${currentModel.validationAccuracy}%`,
        outcome: `Model ${currentModel.versionId} applied. Training dataset size: ${currentModel.trainingDatasetSize}, Validation accuracy: ${currentModel.validationAccuracy}%`,
      });
    }
  }

  return {
    submitOutcome,
    applyModelUpdate,
  };
}
