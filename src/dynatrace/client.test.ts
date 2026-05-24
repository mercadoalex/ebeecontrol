/**
 * Unit tests for the Dynatrace MCP Server client.
 * Tests high-risk service discovery with timeout, retry, and empty results handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DynatraceClient,
  DynatraceClientConfig,
  FetchFn,
  FetchResponse,
} from './client';
import { HighRiskService, PodContext, AccessEvent, ForensicReport } from '../types/index';

describe('DynatraceClient', () => {
  let config: DynatraceClientConfig;

  beforeEach(() => {
    config = {
      endpointUrl: 'https://dynatrace.example.com',
      discoveryTimeoutMs: 30_000,
      maxRetries: 5,
    };
  });

  function createMockResponse(
    ok: boolean,
    status: number,
    data: unknown
  ): FetchResponse {
    return {
      ok,
      status,
      json: async () => data,
    };
  }

  describe('queryHighRiskServices', () => {
    it('should return high-risk services on successful response', async () => {
      const services: HighRiskService[] = [
        {
          serviceId: 'svc-1',
          serviceName: 'payment-api',
          namespace: 'production',
          podIdentifiers: ['pod-1', 'pod-2'],
          riskScore: 85,
        },
        {
          serviceId: 'svc-2',
          serviceName: 'auth-service',
          namespace: 'production',
          podIdentifiers: ['pod-3'],
          riskScore: 72,
        },
      ];

      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, { services })
      );

      const client = new DynatraceClient(config, mockFetch);
      const result = await client.queryHighRiskServices();

      expect(result).toEqual(services);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dynatrace.example.com/api/v1/services/high-risk',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should return empty array when no services found', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, { services: [] })
      );

      const client = new DynatraceClient(config, mockFetch);
      const result = await client.queryHighRiskServices();

      expect(result).toEqual([]);
    });

    it('should return empty array when services field is missing', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, {})
      );

      const client = new DynatraceClient(config, mockFetch);
      const result = await client.queryHighRiskServices();

      expect(result).toEqual([]);
    });

    it('should return empty array when services field is null', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, { services: null })
      );

      const client = new DynatraceClient(config, mockFetch);
      const result = await client.queryHighRiskServices();

      expect(result).toEqual([]);
    });

    it('should throw on non-OK HTTP response when no retries configured', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(false, 500, { error: 'Internal Server Error' })
      );

      const client = new DynatraceClient(
        { ...config, maxRetries: 0 },
        mockFetch
      );

      await expect(client.queryHighRiskServices()).rejects.toThrow(
        'Dynatrace MCP Server returned status 500'
      );
    });

    it('should throw timeout error when request exceeds timeout', async () => {
      const mockFetch: FetchFn = vi.fn().mockImplementation(
        (_url: string, _options: { signal?: AbortSignal }) => {
          // Simulate a request that never resolves on its own,
          // but respects the abort signal
          return new Promise<FetchResponse>((_, reject) => {
            const checkAbort = () => {
              if (_options.signal?.aborted) {
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

      const client = new DynatraceClient(
        { ...config, discoveryTimeoutMs: 50, maxRetries: 0 },
        mockFetch
      );

      await expect(client.queryHighRiskServices()).rejects.toThrow(
        'Dynatrace MCP Server query timed out after 50ms'
      );
    });

    it('should retry on failure and succeed on subsequent attempt', async () => {
      let callCount = 0;
      const mockFetch: FetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve(
          createMockResponse(true, 200, {
            services: [
              {
                serviceId: 'svc-1',
                serviceName: 'api',
                namespace: 'default',
                podIdentifiers: ['pod-1'],
                riskScore: 50,
              },
            ],
          })
        );
      });

      // Use zero-delay for testing retries without fake timers
      const client = new DynatraceClient(config, mockFetch, () => 0);
      const result = await client.queryHighRiskServices();

      expect(result).toHaveLength(1);
      expect(result[0].serviceId).toBe('svc-1');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw after all retries are exhausted', async () => {
      const mockFetch: FetchFn = vi.fn().mockImplementation(
        () => Promise.reject(new Error('Connection refused'))
      );

      // Use zero-delay for testing retries without fake timers
      const client = new DynatraceClient(
        { ...config, maxRetries: 2 },
        mockFetch,
        () => 0
      );

      await expect(client.queryHighRiskServices()).rejects.toThrow(
        'Connection refused'
      );
      // Initial attempt + 2 retries = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should use default config values when not specified', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, { services: [] })
      );

      const client = new DynatraceClient(
        { endpointUrl: 'https://dt.example.com' },
        mockFetch
      );

      const result = await client.queryHighRiskServices();
      expect(result).toEqual([]);
    });

    it('should pass AbortSignal to fetch for timeout control', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, { services: [] })
      );

      const client = new DynatraceClient(config, mockFetch);
      await client.queryHighRiskServices();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should handle network errors and retry successfully', async () => {
      let callCount = 0;
      const mockFetch: FetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        return Promise.resolve(
          createMockResponse(true, 200, { services: [] })
        );
      });

      const client = new DynatraceClient(config, mockFetch, () => 0);
      const result = await client.queryHighRiskServices();

      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on HTTP 500 errors and recover', async () => {
      let callCount = 0;
      const mockFetch: FetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            createMockResponse(false, 500, { error: 'Server Error' })
          );
        }
        return Promise.resolve(
          createMockResponse(true, 200, {
            services: [
              {
                serviceId: 'svc-1',
                serviceName: 'recovered',
                namespace: 'default',
                podIdentifiers: [],
                riskScore: 30,
              },
            ],
          })
        );
      });

      const client = new DynatraceClient(config, mockFetch, () => 0);
      const result = await client.queryHighRiskServices();

      expect(result).toHaveLength(1);
      expect(result[0].serviceName).toBe('recovered');
    });

    it('should construct correct URL from endpoint config', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, { services: [] })
      );

      const client = new DynatraceClient(
        { endpointUrl: 'https://my-dynatrace.com/mcp' },
        mockFetch
      );
      await client.queryHighRiskServices();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://my-dynatrace.com/mcp/api/v1/services/high-risk',
        expect.any(Object)
      );
    });
  });

  describe('onAccessEvent', () => {
    function createSampleAccessEvent(): AccessEvent {
      return {
        eventId: 'evt-001',
        processId: 1234,
        processBinaryPath: '/usr/bin/cat',
        userId: 1000,
        podId: 'pod-abc',
        namespace: 'production',
        honeytokenPath: '/etc/secrets/decoy.key',
        accessType: 'read',
        timestamp: '2024-01-15T10:30:00.123Z',
      };
    }

    it('should invoke registered callback when event is emitted', () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceClient(config, mockFetch);

      const callback = vi.fn();
      client.onAccessEvent(callback);

      const event = createSampleAccessEvent();
      client.emitAccessEvent(event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should invoke multiple registered callbacks', () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceClient(config, mockFetch);

      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();
      client.onAccessEvent(callback1);
      client.onAccessEvent(callback2);
      client.onAccessEvent(callback3);

      const event = createSampleAccessEvent();
      client.emitAccessEvent(event);

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback1).toHaveBeenCalledWith(event);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledWith(event);
      expect(callback3).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledWith(event);
    });

    it('should not invoke callbacks when no event is emitted', () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceClient(config, mockFetch);

      const callback = vi.fn();
      client.onAccessEvent(callback);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should pass the correct event data to callbacks', () => {
      const mockFetch: FetchFn = vi.fn();
      const client = new DynatraceClient(config, mockFetch);

      let receivedEvent: AccessEvent | undefined;
      client.onAccessEvent((event) => {
        receivedEvent = event;
      });

      const event = createSampleAccessEvent();
      client.emitAccessEvent(event);

      expect(receivedEvent).toEqual(event);
    });
  });

  describe('submitForensicReport', () => {
    function createSampleReport(): ForensicReport {
      return {
        reportId: 'report-001',
        generationTimestamp: '2024-01-15T10:35:00.000Z',
        triggeringAccessEventId: 'evt-001',
        retentionDays: 90,
        accessEventDetails: {
          processId: 1234,
          userId: 1000,
          podId: 'pod-abc',
          namespace: 'production',
          honeytokenPath: '/etc/secrets/decoy.key',
          accessType: 'read',
          timestamp: '2024-01-15T10:30:00.123Z',
        },
        contextualAssessment: {
          threatClassification: 'high',
          podCriticality: 4,
          anomalyScore: 0.75,
        },
        responseActions: [
          {
            actionType: 'pod_isolation',
            target: 'pod-abc',
            timestamp: '2024-01-15T10:30:02.000Z',
            result: 'success',
          },
        ],
        timeline: [
          {
            eventDescription: 'Honeytoken access detected',
            timestamp: '2024-01-15T10:30:00.123Z',
          },
          {
            eventDescription: 'Pod isolated',
            timestamp: '2024-01-15T10:30:02.000Z',
          },
        ],
        recommendedFollowUpActions: ['Review pod access logs'],
      };
    }

    it('should submit forensic report successfully', async () => {
      const mockFetch: FetchFn = vi.fn().mockResolvedValue(
        createMockResponse(true, 200, { success: true })
      );

      const client = new DynatraceClient(config, mockFetch);
      const report = createSampleReport();

      await expect(client.submitForensicReport(report)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://dynatrace.example.com/api/v1/reports',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        })
      );
    });

    it('should retry on failure and succeed on subsequent attempt', async () => {
      let callCount = 0;
      const mockFetch: FetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve(createMockResponse(true, 200, { success: true }));
      });

      const client = new DynatraceClient(config, mockFetch, () => 0);
      const report = createSampleReport();

      await expect(client.submitForensicReport(report)).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw after all retries are exhausted', async () => {
      const mockFetch: FetchFn = vi.fn().mockImplementation(
        () => Promise.reject(new Error('Connection refused'))
      );

      const client = new DynatraceClient(
        { ...config, maxRetries: 2 },
        mockFetch,
        () => 0
      );
      const report = createSampleReport();

      await expect(client.submitForensicReport(report)).rejects.toThrow(
        'Connection refused'
      );
      // Initial attempt + 2 retries = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw timeout error when request exceeds 30 seconds', async () => {
      const mockFetch: FetchFn = vi.fn().mockImplementation(
        (_url: string, _options: { signal?: AbortSignal }) => {
          return new Promise<FetchResponse>((_, reject) => {
            const checkAbort = () => {
              if (_options.signal?.aborted) {
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

      const client = new DynatraceClient(
        { ...config, discoveryTimeoutMs: 50, maxRetries: 0 },
        mockFetch
      );
      const report = createSampleReport();

      await expect(client.submitForensicReport(report)).rejects.toThrow(
        'Forensic report submission timed out after 50ms'
      );
    });

    it('should retry on HTTP 500 errors', async () => {
      let callCount = 0;
      const mockFetch: FetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            createMockResponse(false, 500, { error: 'Server Error' })
          );
        }
        return Promise.resolve(createMockResponse(true, 200, { success: true }));
      });

      const client = new DynatraceClient(config, mockFetch, () => 0);
      const report = createSampleReport();

      await expect(client.submitForensicReport(report)).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
