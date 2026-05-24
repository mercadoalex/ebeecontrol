/**
 * Vertex AI Trainer client for the Ebeecontrol autonomous deception engine.
 *
 * Handles outcome data ingestion, model retraining scheduling, and model
 * publishing with the publish guard (new model published only if accuracy >= current).
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6
 */

import { OutcomeData, PlacementModel } from '../types/index';

/**
 * Error thrown when outcome data fails validation.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const VALID_HONEYTOKEN_TYPES = ['decoy_secret', 'decoy_file', 'decoy_credential'] as const;

/**
 * Represents a trained model version with its metadata.
 */
export interface ModelVersion {
  versionId: string;
  trainingDatasetSize: number;
  validationAccuracy: number; // percentage (0-100)
  publishedTimestamp: string; // ISO 8601
}

/**
 * Training status including scheduling and dataset information.
 */
export interface TrainingStatus {
  lastRetrainingTimestamp: string;
  nextScheduledRetraining: string;
  datasetSizeSinceLastTraining: number;
  minimumRecordsRequired: 50;
  retrainingIntervalHours: number; // 1-168, default 24
}

/**
 * Confirmation returned after successful outcome data ingestion.
 */
export interface IngestionConfirmation {
  datasetEntryCount: number;
  ingestionTimestamp: string;
}

/**
 * Result of a retraining attempt.
 */
export interface RetrainingResult {
  success: boolean;
  newModel?: ModelVersion;
  reason: string;
}

/**
 * Log entry for training events.
 */
export interface TrainingLogEntry {
  timestamp: string;
  event: 'ingestion' | 'retraining_started' | 'retraining_success' | 'retraining_failed' | 'model_published' | 'model_rejected';
  details: string;
}

/**
 * Configuration for the Vertex AI Trainer.
 */
export interface TrainerConfig {
  retrainingIntervalHours: number; // 1-168, default 24
  minimumOutcomeRecords: number; // default 50
}

/**
 * Vertex AI Trainer implementation.
 *
 * Manages outcome data ingestion, model retraining scheduling, and model
 * publishing with the publish guard property.
 */
export class VertexAiTrainer {
  private currentModel: ModelVersion;
  private outcomeDataset: OutcomeData[] = [];
  private datasetSinceLastTraining: number = 0;
  private lastRetrainingTimestamp: string;
  private config: TrainerConfig;
  private logs: TrainingLogEntry[] = [];

  constructor(config?: Partial<TrainerConfig>, initialModel?: ModelVersion) {
    this.config = {
      retrainingIntervalHours: config?.retrainingIntervalHours ?? 24,
      minimumOutcomeRecords: config?.minimumOutcomeRecords ?? 50,
    };

    // Validate retraining interval
    if (this.config.retrainingIntervalHours < 1 || this.config.retrainingIntervalHours > 168) {
      throw new Error(
        `retrainingIntervalHours must be between 1 and 168, got ${this.config.retrainingIntervalHours}`
      );
    }

    this.currentModel = initialModel ?? {
      versionId: 'v1.0.0',
      trainingDatasetSize: 0,
      validationAccuracy: 75, // baseline accuracy
      publishedTimestamp: new Date().toISOString(),
    };

    this.lastRetrainingTimestamp = this.currentModel.publishedTimestamp;
  }

  /**
   * Ingests outcome data into the training dataset.
   * Validates data for completeness before appending.
   *
   * Validates: Requirements 7.1, 7.2
   */
  ingestOutcomeData(data: OutcomeData): IngestionConfirmation {
    this.validateOutcomeData(data);

    this.outcomeDataset.push(data);
    this.datasetSinceLastTraining++;

    const confirmation: IngestionConfirmation = {
      datasetEntryCount: this.outcomeDataset.length,
      ingestionTimestamp: new Date().toISOString(),
    };

    this.addLog('ingestion', `Ingested outcome data for incident ${data.incidentId}. Dataset size: ${this.outcomeDataset.length}`);

    return confirmation;
  }

  /**
   * Returns the currently deployed model version.
   */
  getCurrentModelVersion(): ModelVersion {
    return { ...this.currentModel };
  }

  /**
   * Returns the current training status including next scheduled retraining.
   */
  getTrainingStatus(): TrainingStatus {
    const lastTimestamp = new Date(this.lastRetrainingTimestamp);
    const nextRetraining = new Date(
      lastTimestamp.getTime() + this.config.retrainingIntervalHours * 60 * 60 * 1000
    );

    return {
      lastRetrainingTimestamp: this.lastRetrainingTimestamp,
      nextScheduledRetraining: nextRetraining.toISOString(),
      datasetSizeSinceLastTraining: this.datasetSinceLastTraining,
      minimumRecordsRequired: 50,
      retrainingIntervalHours: this.config.retrainingIntervalHours,
    };
  }

  /**
   * Checks if retraining conditions are met:
   * 1. Retraining interval has elapsed since last training
   * 2. At least 50 outcome records exist since last training
   */
  shouldRetrain(): boolean {
    const now = new Date();
    const lastTimestamp = new Date(this.lastRetrainingTimestamp);
    const intervalMs = this.config.retrainingIntervalHours * 60 * 60 * 1000;
    const intervalElapsed = now.getTime() - lastTimestamp.getTime() >= intervalMs;

    const hasMinimumRecords = this.datasetSinceLastTraining >= this.config.minimumOutcomeRecords;

    return intervalElapsed && hasMinimumRecords;
  }

  /**
   * Manually triggers retraining if conditions are met (50+ records).
   * Returns the result of the retraining attempt.
   *
   * The retraining logic:
   * 1. Checks if minimum 50 outcome records exist since last training
   * 2. Simulates model training (generates accuracy between 70-99%)
   * 3. Compares new accuracy with current model accuracy
   * 4. Publishes only if new >= current (Property 15: Model Publish Guard)
   * 5. On failure or lower accuracy: retains existing model, logs failure
   *
   * Validates: Requirements 7.3, 7.4, 7.6
   */
  triggerRetraining(): RetrainingResult {
    // Check minimum records requirement
    if (this.datasetSinceLastTraining < this.config.minimumOutcomeRecords) {
      const reason = `Insufficient outcome records: ${this.datasetSinceLastTraining} < ${this.config.minimumOutcomeRecords} required`;
      this.addLog('retraining_failed', reason);
      return { success: false, reason };
    }

    this.addLog('retraining_started', `Starting retraining with ${this.datasetSinceLastTraining} new records`);

    try {
      // Simulate model training - generate accuracy between 70-99%
      const newAccuracy = this.simulateTraining();
      const currentAccuracy = this.currentModel.validationAccuracy;

      // Property 15: Model Publish Guard
      // Publish only if new accuracy >= current accuracy
      if (newAccuracy >= currentAccuracy) {
        const newModel: ModelVersion = {
          versionId: this.generateVersionId(),
          trainingDatasetSize: this.outcomeDataset.length,
          validationAccuracy: newAccuracy,
          publishedTimestamp: new Date().toISOString(),
        };

        this.currentModel = newModel;
        this.lastRetrainingTimestamp = newModel.publishedTimestamp;
        this.datasetSinceLastTraining = 0;

        this.addLog(
          'model_published',
          `New model ${newModel.versionId} published. Accuracy: ${newAccuracy}% (was ${currentAccuracy}%)`
        );

        return {
          success: true,
          newModel: { ...newModel },
          reason: `New model accuracy ${newAccuracy}% >= current ${currentAccuracy}%`,
        };
      } else {
        // New model is worse - retain existing model
        const reason = `New model accuracy ${newAccuracy}% < current ${currentAccuracy}%. Retaining existing model.`;
        this.addLog('model_rejected', reason);

        return { success: false, reason };
      }
    } catch (error) {
      // On training failure: retain existing model, log failure
      const reason = `Training failed: ${error instanceof Error ? error.message : String(error)}`;
      this.addLog('retraining_failed', reason);

      return { success: false, reason };
    }
  }

  /**
   * Returns the training log entries.
   */
  getLogs(): TrainingLogEntry[] {
    return [...this.logs];
  }

  /**
   * Returns the total dataset size.
   */
  getDatasetSize(): number {
    return this.outcomeDataset.length;
  }

  /**
   * Simulates model training by generating a random accuracy between 70-99%.
   * In a real implementation, this would call Vertex AI APIs.
   */
  protected simulateTraining(): number {
    return Math.floor(Math.random() * 30) + 70; // 70-99
  }

  /**
   * Generates a new version ID based on current timestamp.
   */
  private generateVersionId(): string {
    const now = new Date();
    const major = Math.floor(this.outcomeDataset.length / 100) + 1;
    const minor = this.outcomeDataset.length % 100;
    return `v${major}.${minor}.${now.getTime() % 10000}`;
  }

  /**
   * Validates outcome data for completeness.
   * Throws ValidationError if required fields are missing or invalid.
   *
   * Validates: Requirements 7.1, 7.2
   */
  private validateOutcomeData(data: OutcomeData): void {
    if (!data.incidentId || data.incidentId.trim() === '') {
      throw new ValidationError('OutcomeData missing required field: incidentId');
    }
    if (!data.accessEvent) {
      throw new ValidationError('OutcomeData missing required field: accessEvent');
    }
    // Validate accessEvent fields
    if (!data.accessEvent.eventId || data.accessEvent.eventId.trim() === '') {
      throw new ValidationError('OutcomeData.accessEvent missing required field: eventId');
    }
    if (typeof data.accessEvent.processId !== 'number' || data.accessEvent.processId < 0) {
      throw new ValidationError('OutcomeData.accessEvent missing required field: processId');
    }
    if (!data.accessEvent.processBinaryPath || data.accessEvent.processBinaryPath.trim() === '') {
      throw new ValidationError('OutcomeData.accessEvent missing required field: processBinaryPath');
    }
    if (typeof data.accessEvent.userId !== 'number' || data.accessEvent.userId < 0) {
      throw new ValidationError('OutcomeData.accessEvent missing required field: userId');
    }
    if (!data.accessEvent.podId || data.accessEvent.podId.trim() === '') {
      throw new ValidationError('OutcomeData.accessEvent missing required field: podId');
    }
    if (!data.accessEvent.namespace || data.accessEvent.namespace.trim() === '') {
      throw new ValidationError('OutcomeData.accessEvent missing required field: namespace');
    }
    if (!data.accessEvent.honeytokenPath || data.accessEvent.honeytokenPath.trim() === '') {
      throw new ValidationError('OutcomeData.accessEvent missing required field: honeytokenPath');
    }
    const validAccessTypes = ['open', 'read', 'write', 'stat'];
    if (!validAccessTypes.includes(data.accessEvent.accessType)) {
      throw new ValidationError('OutcomeData.accessEvent missing required field: accessType');
    }
    if (!data.accessEvent.timestamp || !this.isValidTimestamp(data.accessEvent.timestamp)) {
      throw new ValidationError('OutcomeData.accessEvent missing required field: timestamp (must be valid ISO 8601)');
    }

    if (!data.honeytokenType || !VALID_HONEYTOKEN_TYPES.includes(data.honeytokenType as any)) {
      throw new ValidationError('OutcomeData missing required field: honeytokenType (must be decoy_secret, decoy_file, or decoy_credential)');
    }
    if (!data.placementLocation || data.placementLocation.trim() === '') {
      throw new ValidationError('OutcomeData missing required field: placementLocation');
    }
    if (!data.actionsTaken || !Array.isArray(data.actionsTaken) || data.actionsTaken.length === 0) {
      throw new ValidationError('OutcomeData missing required field: actionsTaken (must have at least one action)');
    }
    if (!data.effectiveness) {
      throw new ValidationError('OutcomeData missing required field: effectiveness');
    }
    if (typeof data.effectiveness.detectionToResponseLatencySeconds !== 'number' || data.effectiveness.detectionToResponseLatencySeconds < 0) {
      throw new ValidationError('OutcomeData.effectiveness missing required field: detectionToResponseLatencySeconds');
    }
    if (typeof data.effectiveness.threatContained !== 'boolean') {
      throw new ValidationError('OutcomeData.effectiveness missing required field: threatContained');
    }
    if (typeof data.effectiveness.falsePositive !== 'boolean') {
      throw new ValidationError('OutcomeData.effectiveness missing required field: falsePositive');
    }
    if (!data.timestamp || !this.isValidTimestamp(data.timestamp)) {
      throw new ValidationError('OutcomeData missing required field: timestamp (must be valid ISO 8601)');
    }
  }

  /**
   * Validates that a string is a valid ISO 8601 timestamp.
   */
  private isValidTimestamp(value: string): boolean {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  /**
   * Adds a log entry.
   */
  private addLog(event: TrainingLogEntry['event'], details: string): void {
    this.logs.push({
      timestamp: new Date().toISOString(),
      event,
      details,
    });
  }
}
