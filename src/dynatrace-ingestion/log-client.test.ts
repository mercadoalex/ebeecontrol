/**
 * Unit tests for the Dynatrace Log Ingestion client.
 * Tests batching, flush, retry with exponential backoff, and discard behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynatraceLogIngestionClient } from './log-client';
import { DynatraceIngestionConfig } from '../config';
import { FetchFn, FetchResponse } from '../dynatrace/client';
import {
  AccessEventLogPayload,
  ResponseActionLogPayload,
  ForensicReportLogPayload,
  IncidentTimelineLogPayload,
} from '../types/dynatrace-ingestion';

describe('DynatraceLogIngestionClient', () => {
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

  function createAccessEventPayload(): AccessEventLogPayload {
    return {
      timestamp: '2024-01-15T10:00:00.000Z',
      podId: 'pod-abc',
      namespace: 'production',
      processBinaryPath: '/usr/bin/cat',
      accessType: 'read',
      threatClassification: 'high',
    };
  }

  function createResponseActionPayload(): ResponseActionLogPayload {
    return {
      actionId: 'action-001',
      actionType: 'pod_isolation',
      target: 'pod-abc',
      triggeringClassification: 'high',
      timestamp: '2024-01-15T10:00:02.000Z',
      outcome: 'success',
    };
  }

  function createForensicReportPayload(): ForensicReportLogPayload {
    return {
      reportId: 'report-001',
      generationTimestamp: '2024-01-15T10:05:00.000Z',
      threatClassification: 'critical',
      affectedPodId: 'pod-abc',
      namespace: 'production',
      reportContent: JSON.stringify({ summary: 'Intrusion detected' }),
    };
  }

  function createIncidentTimelinePayload(): IncidentTimelineLogPayload {
    return {
      incidentId: 'incident-001',
      timestamp: '2024-01-15T10:00:00.000Z',
      threatClassification: 'high',
      affectedPodId: 'pod-abc',
      namespace: 'production',
      responseActions: [
        { actionType: 'pod_isolation', outcome: 'success' },
        { actionType: 'ip_block', outcome: 'success' },
      ],
      finalOutcome: 'contained',
    };
  }

  describe('pushAccessEventLog', () => {
    it('should enqueue a log without immediately sending', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());

      expect(mockFetch).not.toHaveBeenCalled();
      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
    });

    it('should auto-flush when batch size is reached', async () => {
      const smallBatchConfig = { ...config, batchConfig: { maxBatchSize: 2, flushIntervalSeconds: 5 } };
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceLogIngestionClient(smallBatchConfig, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
      expect(mockFetch).not.toHaveBeenCalled();

      await client.pushAccessEventLog(createAccessEventPayload());
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('pushResponseActionLog', () => {
    it('should enqueue a response action log', async () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushResponseActionLog(createResponseActionPayload());

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
    });
  });

  describe('pushForensicReportLog', () => {
    it('should enqueue a forensic report log', async () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushForensicReportLog(createForensicReportPayload());

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
    });
  });

  describe('pushIncidentTimelineLog', () => {
    it('should enqueue an incident timeline log', async () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushIncidentTimelineLog(createIncidentTimelinePayload());

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
    });
  });

  describe('flush', () => {
    it('should send all pending items to the Dynatrace Log Ingestion API', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
      await client.pushResponseActionLog(createResponseActionPayload());
      await client.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dynatrace.example.com/api/v2/logs/ingest',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': 'Api-Token dt0c01.test-token',
          },
        })
      );

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(0);
    });

    it('should do nothing when buffer is empty', async () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should buffer items for retry on API failure', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(false, 500));
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
      await client.flush();

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(1);
      expect(status.retryInProgressCount).toBe(1);
      expect(status.totalDiscardedCount).toBe(0);
    });

    it('should buffer items for retry on network error', async () => {
      const mockFetch: FetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
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

      let currentTime = new Date('2024-01-15T10:00:00.000Z');
      const client = new DynatraceLogIngestionClient(lowRetryConfig, mockFetch, {
        getNow: () => currentTime.toISOString(),
      });

      await client.pushAccessEventLog(createAccessEventPayload());

      // First flush: attempt 0 → fails → attemptCount becomes 1
      await client.flush();
      expect(client.getBufferStatus().retryInProgressCount).toBe(1);

      // Advance time past the backoff delay
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
      const client = new DynatraceLogIngestionClient(config, mockFetch, {
        getNow: () => currentTime.toISOString(),
      });

      await client.pushAccessEventLog(createAccessEventPayload());
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
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
      await client.flush(); // Fails, moves to retry buffer with future nextRetryTimestamp

      // Flush again immediately — retry item should NOT be sent
      await client.flush();

      // Only 1 call total
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should send mixed log types in a single batch', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
      await client.pushResponseActionLog(createResponseActionPayload());
      await client.pushForensicReportLog(createForensicReportPayload());
      await client.pushIncidentTimelineLog(createIncidentTimelinePayload());
      await client.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toHaveLength(4);
    });

    it('should include Authorization header with API token', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(createMockResponse(true, 200));
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
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
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => fixedNow });

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(0);
      expect(status.oldestBufferedTimestamp).toBeUndefined();
      expect(status.retryInProgressCount).toBe(0);
      expect(status.totalDiscardedCount).toBe(0);
    });

    it('should track oldest buffered timestamp', async () => {
      const mockFetch: FetchFn = vi.fn();
      let time = '2024-01-15T10:00:00.000Z';
      const client = new DynatraceLogIngestionClient(config, mockFetch, { getNow: () => time });

      await client.pushAccessEventLog(createAccessEventPayload());
      time = '2024-01-15T10:01:00.000Z';
      await client.pushResponseActionLog(createResponseActionPayload());

      const status = client.getBufferStatus();
      expect(status.bufferedItemCount).toBe(2);
      expect(status.oldestBufferedTimestamp).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('timeout handling', () => {
    it('should buffer items on timeout', async () => {
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
      const client = new DynatraceLogIngestionClient(shortTimeoutConfig, mockFetch, { getNow: () => fixedNow });

      await client.pushAccessEventLog(createAccessEventPayload());
      await client.flush();

      const status = client.getBufferStatus();
      expect(status.retryInProgressCount).toBe(1);
    });
  });
});
