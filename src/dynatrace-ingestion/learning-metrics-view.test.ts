/**
 * Unit tests for the Learning Metrics View Model.
 *
 * Validates: Requirements 9.11
 */

import { describe, it, expect } from 'vitest';
import { toLearningMetricsViewModel } from './learning-metrics-view';
import { LearningMetricPayload } from '../types/dynatrace-ingestion';

describe('LearningMetricsViewModel', () => {
  it('should format idle training status correctly', () => {
    const payload: LearningMetricPayload = {
      modelVersionId: 'v1.2.3',
      validationAccuracy: 95.5,
      trainingDatasetSize: 1500,
      trainingStatus: 'idle',
    };

    const vm = toLearningMetricsViewModel(payload);

    expect(vm.modelVersionId).toBe('v1.2.3');
    expect(vm.validationAccuracy).toBe(95.5);
    expect(vm.validationAccuracyFormatted).toBe('95.50%');
    expect(vm.trainingDatasetSize).toBe(1500);
    expect(vm.trainingDatasetSizeFormatted).toBe('1,500 records');
    expect(vm.trainingStatus).toBe('idle');
    expect(vm.trainingStatusLabel).toBe('Idle');
    expect(vm.trainingStatusIcon).toBe('⏸️');
  });

  it('should format training-in-progress status correctly', () => {
    const payload: LearningMetricPayload = {
      modelVersionId: 'v2.0.0',
      validationAccuracy: 88.123,
      trainingDatasetSize: 250,
      trainingStatus: 'training',
    };

    const vm = toLearningMetricsViewModel(payload);

    expect(vm.validationAccuracyFormatted).toBe('88.12%');
    expect(vm.trainingStatusLabel).toBe('Training in Progress');
    expect(vm.trainingStatusIcon).toBe('🔄');
  });

  it('should format failed training status correctly', () => {
    const payload: LearningMetricPayload = {
      modelVersionId: 'v1.9.0',
      validationAccuracy: 72.0,
      trainingDatasetSize: 50,
      trainingStatus: 'failed',
    };

    const vm = toLearningMetricsViewModel(payload);

    expect(vm.validationAccuracyFormatted).toBe('72.00%');
    expect(vm.trainingDatasetSizeFormatted).toBe('50 records');
    expect(vm.trainingStatusLabel).toBe('Training Failed');
    expect(vm.trainingStatusIcon).toBe('❌');
  });

  it('should handle zero accuracy', () => {
    const payload: LearningMetricPayload = {
      modelVersionId: 'v0.1.0',
      validationAccuracy: 0,
      trainingDatasetSize: 0,
      trainingStatus: 'idle',
    };

    const vm = toLearningMetricsViewModel(payload);

    expect(vm.validationAccuracyFormatted).toBe('0.00%');
    expect(vm.trainingDatasetSizeFormatted).toBe('0 records');
  });

  it('should handle 100% accuracy', () => {
    const payload: LearningMetricPayload = {
      modelVersionId: 'v3.0.0',
      validationAccuracy: 100,
      trainingDatasetSize: 10000,
      trainingStatus: 'idle',
    };

    const vm = toLearningMetricsViewModel(payload);

    expect(vm.validationAccuracyFormatted).toBe('100.00%');
    expect(vm.trainingDatasetSizeFormatted).toBe('10,000 records');
  });

  it('should produce distinct icons for each training status', () => {
    const statuses: LearningMetricPayload['trainingStatus'][] = ['idle', 'training', 'failed'];
    const icons = statuses.map(status =>
      toLearningMetricsViewModel({
        modelVersionId: 'v1.0.0',
        validationAccuracy: 90,
        trainingDatasetSize: 100,
        trainingStatus: status,
      }).trainingStatusIcon
    );

    const uniqueIcons = new Set(icons);
    expect(uniqueIcons.size).toBe(3);
  });

  it('should produce distinct labels for each training status', () => {
    const statuses: LearningMetricPayload['trainingStatus'][] = ['idle', 'training', 'failed'];
    const labels = statuses.map(status =>
      toLearningMetricsViewModel({
        modelVersionId: 'v1.0.0',
        validationAccuracy: 90,
        trainingDatasetSize: 100,
        trainingStatus: status,
      }).trainingStatusLabel
    );

    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(3);
  });
});
