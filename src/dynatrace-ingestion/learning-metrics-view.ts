/**
 * Learning Metrics View Model.
 *
 * Formats adaptive learning metrics (from LearningMetricPayload) for display
 * on the Dynatrace dashboard. Provides human-readable labels and formatted values.
 *
 * Validates: Requirements 9.11
 */

import { LearningMetricPayload } from '../types/dynatrace-ingestion';

/**
 * View model for displaying adaptive learning metrics.
 */
export interface LearningMetricsViewModel {
  modelVersionId: string;
  validationAccuracy: number;
  validationAccuracyFormatted: string;
  trainingDatasetSize: number;
  trainingDatasetSizeFormatted: string;
  trainingStatus: 'idle' | 'training' | 'failed';
  trainingStatusLabel: string;
  trainingStatusIcon: string;
}

/**
 * Maps a training status to a human-readable label.
 */
function getTrainingStatusLabel(status: LearningMetricPayload['trainingStatus']): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'training':
      return 'Training in Progress';
    case 'failed':
      return 'Training Failed';
  }
}

/**
 * Maps a training status to a display icon.
 */
function getTrainingStatusIcon(status: LearningMetricPayload['trainingStatus']): string {
  switch (status) {
    case 'idle':
      return '⏸️';
    case 'training':
      return '🔄';
    case 'failed':
      return '❌';
  }
}

/**
 * Formats a validation accuracy percentage for display.
 * Rounds to 2 decimal places and appends a percent sign.
 */
function formatAccuracy(accuracy: number): string {
  return `${accuracy.toFixed(2)}%`;
}

/**
 * Formats a dataset size with thousands separators for readability.
 */
function formatDatasetSize(size: number): string {
  return `${size.toLocaleString('en-US')} records`;
}

/**
 * Transforms a LearningMetricPayload into a LearningMetricsViewModel
 * with formatted values suitable for dashboard display.
 */
export function toLearningMetricsViewModel(
  payload: LearningMetricPayload
): LearningMetricsViewModel {
  return {
    modelVersionId: payload.modelVersionId,
    validationAccuracy: payload.validationAccuracy,
    validationAccuracyFormatted: formatAccuracy(payload.validationAccuracy),
    trainingDatasetSize: payload.trainingDatasetSize,
    trainingDatasetSizeFormatted: formatDatasetSize(payload.trainingDatasetSize),
    trainingStatus: payload.trainingStatus,
    trainingStatusLabel: getTrainingStatusLabel(payload.trainingStatus),
    trainingStatusIcon: getTrainingStatusIcon(payload.trainingStatus),
  };
}
