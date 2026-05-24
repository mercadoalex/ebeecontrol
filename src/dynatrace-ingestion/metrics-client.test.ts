/**
 * Unit tests for the Dynatrace Metrics Ingestion client.
 * Tests batching, flush, retry with exponential backoff, and discard behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynatraceMetricsIngestionClient } from './metrics-client';
import { DynatraceIngestionConfig } from '../config';
import { FetchFn, FetchResponse } from '../dynatrace/client';
import {
  HoneytokenRegistryMetricPayload,
  ComponentHealthMetricPayload,
  LearningMetricPayload,
} from '../types/dynatrace-ingestion';

describe('DynatraceMetricsIngestionClient', () => {
  let config: DynatraceIngestionConfig;
  const fixedNow = '2024-01-15T10:00:00.000Z';

  beforeEach(() => {
    config = {
      metricsEndpoint: 'https://dynatrace.example.com/api/v2/metrics/ingest',
      logEndpoint: 'https://dynatrace.example.com/api/v2/logs/ingest',
      apiToken: 'dt0c01.test-token',
      requestTimeoutSeconds: 10,
      retryConfig: {
        maxRetries: 5,
        initialBackoffSeconds: 2,
        backoffMultiplier: 2,
        maxBackoffSeconds: 32,
      },
      batchConfig: {
        maxBatchSize: 100,
        flushIntervalSeconds: 5,
      },
    };
  });

  function createMockResponse(ok: boolean, status: number): FetchResponse {
    return { ok, status, json: async () => ({}) };
  }

  function createRegistryPayload(): HoneytokenRegistryMetricPayload {
    return {
      honeytokenId: 'ht-001',
      podId: 'pod-abc',
      namespace: 'production',
      type: 'decoy_secret',
      deploymentTimestamp: '2024-01-15T09:00:00.000Z',
      status: 'active',
    };
  }

  function createHealthPayload(): ComponentHealthMetricPayload {
    return {
      componentName: 'Tetragon_Monitor',
      status: 'healthy',
      lastSuccessfulCheckTimestamp: '2024-01-15T09:59:30.000Z',
    };
  }

  function createLearningPayload(): LearningMetricPayload {
    return {
      modelVersionId: 'model-v2',
      validationAccuracy: 92.5,
      trainingDatasetSize: 150,
      trainingStatus: 'idle',
    };
  }

  describe('pushHoneytokenRegistryMetric', () => {
    it('should enqueue a metric without immediately sending', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());

      expect(mockFetch).not.toHaveBeenCalled();
      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
    });

    it('should auto-flush when batch size is reached', async () => {
      const smallBatchConfig = { ...config, batchConfig: { maxBatchSize: 2, flushIntervalSeconds: 5 } };
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceMetricsIngestionClient(smallBatchConfig, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      expect(mockFetch).not.toHaveBeenCalled();

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('pushComponentHealthMetric', () => {
    it('should enqueue a health metric', async () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushComponentHealthMetric(createHealthPayload());

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
    });
  });

  describe('pushLearningMetrics', () => {
    it('should enqueue a learning metric', async () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushLearningMetrics(createLearningPayload());

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
    });
  });

  describe('flush', () => {
    it('should send all pending items to the Dynatrace Metrics API', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      await client.pushComponentHealthMetric(createHealthPayload());
      await client.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dynatrace.example.com/api/v2/metrics/ingest',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Api-Token dt0c01.test-token',
          },
        })
      );

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(0);
    });

    it('should do nothing when buffer is empty', async () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should buffer items for retry on API failure', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(false, 500));
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      await client.flush();

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
      expect(status.retryInProgressCount).toBe(1);
      expect(status.totalDiscardedCount).toBe(0);
    });

    it('should buffer items for retry on network error', async () => {
      const mockFetch: FetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      await client.flush();

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
      expect(status.retryInProgressCount).toBe(1);
    });

    it('should discard items after maxRetries exhausted', async () => {
      const lowRetryConfig = {
        ...config,
        retryConfig: { ...config.retryConfig, maxRetries: 2 },
      };
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(false, 500));

      // Use a time that advances to allow retries to be eligible
      let currentTime = new Date('2024-01-15T10:00:00.000Z');
      const client = new DynatraceMetricsIngestionClient(lowRetryConfig, mockFetch, {
        getNow: () => currentTime.toISOString(),
      });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());

      // First flush: attempt 0 → fails → attemptCount becomes 1
      await client.flush();
      expect(client.getBufferStatus().retryInProgressCount).toBe(1);

      // Advance time past the backoff delay to make retry eligible
      currentTime = new Date('2024-01-15T10:01:00.000Z');

      // Second flush: attempt 1 → fails → attemptCount becomes 2 (== maxRetries) → discard
      await client.flush();
      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(0);
      expect(status.retryInProgressCount).toBe(0);
      expect(status.totalDiscardedCount).toBe(1);
    });

    it('should successfully deliver retry-buffered items on subsequent flush', async () => {
      let callCount = 0;
      const mockFetch: FetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(createMockResponse(false, 503));
        }
        return Promise.resolve(createMockResponse(true, 200));
      });

      let currentTime = new Date('2024-01-15T10:00:00.000Z');
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, {
        getNow: () => currentTime.toISOString(),
      });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      await client.flush(); // Fails, moves to retry buffer

      expect(client.getBufferStatus().retryInProgressCount).toBe(1);

      // Advance time past backoff
      currentTime = new Date('2024-01-15T10:01:00.000Z');
      await client.flush(); // Succeeds

      expect(client.getBufferStatus().bufferedItemCount).toBe(0);
      expect(client.getBufferStatus().retryInProgressCount).toBe(0);
    });

    it('should not retry items whose nextRetryTimestamp has not passed', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(false, 500));
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      await client.flush(); // Fails, moves to retry buffer with future nextRetryTimestamp

      // Flush again immediately — retry item should NOT be sent (time hasn't advanced)
      await client.flush();

      // Only 1 call total (the initial flush), not 2
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should include Authorization header with API token', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      await client.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Api-Token dt0c01.test-token',
          }),
        })
      );
    });
  });

  describe('getBufferStatus', () => {
    it('should return zero counts when empty', () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(0);
      expect(status.oldestBufferedTimestamp).toBeUndefined();
      expect(status.retryInProgressCount).toBe(0);
      expect(status.totalDiscardedCount).toBe(0);
    });

    it('should track oldest buffered timestamp', async () => {
      const mockFetch: FetchFn = vi.fn();
      let time = '2024-01-15T10:00:00.000Z';
      const client = new DynatraceMetricsIngestionClient(config, mockFetch, { getNow: () => time });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      time = '2024-01-15T10:01:00.000Z';
      await client.pushComponentHealthMetric(createHealthPayload());

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(2);
      expect(status.oldestBufferedTimestamp).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('timeout handling', () => {
    it('should throw timeout error when request exceeds configured timeout', async () => {
      const mockFetch: FetchFn = vi.fn().mockImplementation(
        (_url: string, options: { signal?: AbortSignal }) => {
          return new Promise<FetchResponse>((_, reject) => {
            const checkAbort = () => {
              if (options.signal?.aborted) {
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                reject(error);
                return;
              }
              setTimeout(checkAbort, 5);
            };
            checkAbort();
          });
        }
      );

      const shortTimeoutConfig = { ...config, requestTimeoutSeconds: 0.05 };
      const client = new DynatraceMetricsIngestionClient(shortTimeoutConfig, mockFetch, { getNow: () => fixedNow });

      await client.pushHoneytokenRegistryMetric(createRegistryPayload());
      await client.flush();

      // Item should be in retry buffer after timeout
      const status = client.getBufferStatus();
      expect(status.retryInProgressCount).toBe(1);
    });
  });
});
