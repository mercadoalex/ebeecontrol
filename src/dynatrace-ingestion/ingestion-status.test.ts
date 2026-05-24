/**
 * Unit tests for the Ingestion Status module.
 *
 * Validates: Requirements 9.16, 9.17
 */

import { describe, it, expect } from 'vitest';
import {
  computeIngestionHealth,
  getIngestionStatus,
} from './ingestion-status';
import { IngestionBufferStatus } from '../types/dynatrace-ingestion';

describe('computeIngestionHealth', () => {
  it('should return healthy when no retries and no discards', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };

    expect(computeIngestionHealth(metrics, logs)).toBe('healthy');
  });

  it('should return degraded when retries in progress but no discards', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 5,
      retryInProgressCount: 3,
      totalDiscardedCount: 0,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };

    expect(computeIngestionHealth(metrics, logs)).toBe('degraded');
  });

  it('should return degraded when logs have retries', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 2,
      retryInProgressCount: 2,
      totalDiscardedCount: 0,
    };

    expect(computeIngestionHealth(metrics, logs)).toBe('degraded');
  });

  it('should return unhealthy when discards are occurring in metrics', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 5,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };

    expect(computeIngestionHealth(metrics, logs)).toBe('unhealthy');
  });

  it('should return unhealthy when discards are occurring in logs', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 3,
    };

    expect(computeIngestionHealth(metrics, logs)).toBe('unhealthy');
  });

  it('should return unhealthy when both retries and discards are present', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 10,
      retryInProgressCount: 5,
      totalDiscardedCount: 2,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 3,
      retryInProgressCount: 3,
      totalDiscardedCount: 1,
    };

    expect(computeIngestionHealth(metrics, logs)).toBe('unhealthy');
  });
});

describe('getIngestionStatus', () => {
  it('should return healthy summary when all clear', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };

    const status = getIngestionStatus(metrics, logs);

    expect(status.health).toBe('healthy');
    expect(status.healthIcon).toBe('✅');
    expect(status.healthLabel).toContain('normally');
    expect(status.totalBufferedItems).toBe(0);
    expect(status.totalRetryInProgress).toBe(0);
    expect(status.totalDiscarded).toBe(0);
    expect(status.summary).toContain('healthy');
  });

  it('should return degraded summary with retry details', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 5,
      retryInProgressCount: 3,
      totalDiscardedCount: 0,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 2,
      retryInProgressCount: 1,
      totalDiscardedCount: 0,
    };

    const status = getIngestionStatus(metrics, logs);

    expect(status.health).toBe('degraded');
    expect(status.healthIcon).toBe('⚠️');
    expect(status.healthLabel).toContain('retries');
    expect(status.totalBufferedItems).toBe(7);
    expect(status.totalRetryInProgress).toBe(4);
    expect(status.totalDiscarded).toBe(0);
    expect(status.summary).toContain('7 items buffered');
    expect(status.summary).toContain('4 retries');
  });

  it('should return unhealthy summary with discard details', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 3,
      oldestBufferedTimestamp: '2024-01-15T09:00:00.000Z',
      retryInProgressCount: 2,
      totalDiscardedCount: 10,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 1,
      retryInProgressCount: 1,
      totalDiscardedCount: 5,
    };

    const status = getIngestionStatus(metrics, logs);

    expect(status.health).toBe('unhealthy');
    expect(status.healthIcon).toBe('❌');
    expect(status.healthLabel).toContain('Data loss');
    expect(status.totalBufferedItems).toBe(4);
    expect(status.totalRetryInProgress).toBe(3);
    expect(status.totalDiscarded).toBe(15);
    expect(status.summary).toContain('15 items discarded');
    expect(status.metricsBufferStatus).toEqual(metrics);
    expect(status.logsBufferStatus).toEqual(logs);
  });

  it('should include both buffer statuses in the result', () => {
    const metrics: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };
    const logs: IngestionBufferStatus = {
      bufferedItemCount: 0,
      retryInProgressCount: 0,
      totalDiscardedCount: 0,
    };

    const status = getIngestionStatus(metrics, logs);

    expect(status.metricsBufferStatus).toBe(metrics);
    expect(status.logsBufferStatus).toBe(logs);
  });
});
