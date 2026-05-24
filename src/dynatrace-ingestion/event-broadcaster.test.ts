/**
 * Unit tests for the Event Broadcaster.
 * Tests transformation of internal types to Dynatrace payloads and delegation
 * to the appropriate ingestion client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBroadcaster, EventBroadcaster } from './event-broadcaster';
import { DynatraceMetricsClient } from './metrics-client';
import { DynatraceLogClient } from './log-client';
import {
  HoneytokenRegistryEntry,
  AccessEvent,
  ResponseAction,
  ForensicReport,
} from '../types/index';
import {
  ComponentHealthMetricPayload,
  LearningMetricPayload,
  IncidentTimelineLogPayload,
} from '../types/dynatrace-ingestion';
import { ThreatClassification } from '../agent/threat-classifier';

describe('EventBroadcaster', () => {
  let metricsClient: DynatraceMetricsClient;
  let logClient: DynatraceLogClient;
  let broadcaster: EventBroadcaster;

  beforeEach(() => {
    metricsClient = {
      pushHoneytokenRegistryMetric: vi.fn().mockResolvedValue(undefined),
      pushComponentHealthMetric: vi.fn().mockResolvedValue(undefined),
      pushLearningMetrics: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      getBufferStatus: vi.fn().mockReturnValue({
        bufferedItemCount: 0,
        retryInProgressCount: 0,
        totalDiscardedCount: 0,
      }),
    };

    logClient = {
      pushAccessEventLog: vi.fn().mockResolvedValue(undefined),
      pushResponseActionLog: vi.fn().mockResolvedValue(undefined),
      pushForensicReportLog: vi.fn().mockResolvedValue(undefined),
      pushIncidentTimelineLog: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      getBufferStatus: vi.fn().mockReturnValue({
        bufferedItemCount: 0,
        retryInProgressCount: 0,
        totalDiscardedCount: 0,
      }),
    };

    broadcaster = createEventBroadcaster(metricsClient, logClient);
  });

  describe('broadcastHoneytokenRegistryChange', () => {
    it('should transform registry entry and push as metric', async () => {
      const entry: HoneytokenRegistryEntry = {
        honeytokenId: 'ht-001',
        podId: 'pod-abc',
        namespace: 'production',
        type: 'decoy_secret',
        filePath: '/etc/secrets/api-key',
        deploymentTimestamp: '2024-01-15T09:00:00.000Z',
        status: 'active',
        accessCount: 0,
      };

      await broadcaster.broadcastHoneytokenRegistryChange(entry);

      expect(metricsClient.pushHoneytokenRegistryMetric).toHaveBeenCalledWith({
        honeytokenId: 'ht-001',
        podId: 'pod-abc',
        namespace: 'production',
        type: 'decoy_secret',
        deploymentTimestamp: '2024-01-15T09:00:00.000Z',
        status: 'active',
      });
    });

    it('should map "triggered" status correctly', async () => {
      const entry: HoneytokenRegistryEntry = {
        honeytokenId: 'ht-002',
        podId: 'pod-xyz',
        namespace: 'staging',
        type: 'decoy_file',
        filePath: '/tmp/credentials.json',
        deploymentTimestamp: '2024-01-14T08:00:00.000Z',
        status: 'triggered',
        lastAccessTimestamp: '2024-01-15T10:00:00.000Z',
        accessCount: 3,
      };

      await broadcaster.broadcastHoneytokenRegistryChange(entry);

      expect(metricsClient.pushHoneytokenRegistryMetric).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'triggered' })
      );
    });

    it('should map "decommissioned" status to "expired"', async () => {
      const entry: HoneytokenRegistryEntry = {
        honeytokenId: 'ht-003',
        podId: 'pod-old',
        namespace: 'production',
        type: 'decoy_credential',
        filePath: '/var/run/secrets/token',
        deploymentTimestamp: '2024-01-10T06:00:00.000Z',
        status: 'decommissioned',
        accessCount: 5,
      };

      await broadcaster.broadcastHoneytokenRegistryChange(entry);

      expect(metricsClient.pushHoneytokenRegistryMetric).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'expired' })
      );
    });

    it('should not include filePath or accessCount in the metric payload', async () => {
      const entry: HoneytokenRegistryEntry = {
        honeytokenId: 'ht-004',
        podId: 'pod-test',
        namespace: 'dev',
        type: 'decoy_file',
        filePath: '/opt/data/secret.txt',
        deploymentTimestamp: '2024-01-15T12:00:00.000Z',
        status: 'active',
        accessCount: 10,
      };

      await broadcaster.broadcastHoneytokenRegistryChange(entry);

      const call = (metricsClient.pushHoneytokenRegistryMetric as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call).not.toHaveProperty('filePath');
      expect(call).not.toHaveProperty('accessCount');
    });
  });

  describe('broadcastAccessEvent', () => {
    it('should transform access event with classification and push as log', async () => {
      const event: AccessEvent = {
        eventId: 'evt-001',
        processId: 1234,
        processBinaryPath: '/usr/bin/cat',
        userId: 1000,
        podId: 'pod-abc',
        namespace: 'production',
        honeytokenPath: '/etc/secrets/api-key',
        accessType: 'read',
        timestamp: '2024-01-15T10:00:00.123Z',
      };
      const classification: ThreatClassification = 'high';

      await broadcaster.broadcastAccessEvent(event, classification);

      expect(logClient.pushAccessEventLog).toHaveBeenCalledWith({
        timestamp: '2024-01-15T10:00:00.123Z',
        podId: 'pod-abc',
        namespace: 'production',
        processBinaryPath: '/usr/bin/cat',
        accessType: 'read',
        threatClassification: 'high',
      });
    });

    it('should handle all access types', async () => {
      const accessTypes: AccessEvent['accessType'][] = ['open', 'read', 'write', 'stat'];

      for (const accessType of accessTypes) {
        const event: AccessEvent = {
          eventId: `evt-${accessType}`,
          processId: 100,
          processBinaryPath: '/bin/test',
          userId: 0,
          podId: 'pod-test',
          namespace: 'ns',
          honeytokenPath: '/path',
          accessType,
          timestamp: '2024-01-15T10:00:00.000Z',
        };

        await broadcaster.broadcastAccessEvent(event, 'low');

        expect(logClient.pushAccessEventLog).toHaveBeenCalledWith(
          expect.objectContaining({ accessType })
        );
      }
    });

    it('should handle all classification levels', async () => {
      const classifications: ThreatClassification[] = ['low', 'medium', 'high', 'critical'];
      const event: AccessEvent = {
        eventId: 'evt-cls',
        processId: 100,
        processBinaryPath: '/bin/test',
        userId: 0,
        podId: 'pod-test',
        namespace: 'ns',
        honeytokenPath: '/path',
        accessType: 'read',
        timestamp: '2024-01-15T10:00:00.000Z',
      };

      for (const classification of classifications) {
        await broadcaster.broadcastAccessEvent(event, classification);

        expect(logClient.pushAccessEventLog).toHaveBeenCalledWith(
          expect.objectContaining({ threatClassification: classification })
        );
      }
    });

    it('should not include eventId, processId, userId, or honeytokenPath in the log payload', async () => {
      const event: AccessEvent = {
        eventId: 'evt-strip',
        processId: 9999,
        processBinaryPath: '/usr/bin/ls',
        userId: 500,
        podId: 'pod-strip',
        namespace: 'production',
        honeytokenPath: '/secret/path',
        accessType: 'open',
        timestamp: '2024-01-15T10:00:00.000Z',
      };

      await broadcaster.broadcastAccessEvent(event, 'medium');

      const call = (logClient.pushAccessEventLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call).not.toHaveProperty('eventId');
      expect(call).not.toHaveProperty('processId');
      expect(call).not.toHaveProperty('userId');
      expect(call).not.toHaveProperty('honeytokenPath');
    });
  });

  describe('broadcastResponseAction', () => {
    it('should transform response action and push as log', async () => {
      const action: ResponseAction = {
        actionId: 'act-001',
        actionType: 'pod_isolation',
        target: 'pod-abc',
        timestamp: '2024-01-15T10:00:02.000Z',
        threatClassification: 'high',
        result: 'success',
        retryCount: 0,
      };

      await broadcaster.broadcastResponseAction(action);

      expect(logClient.pushResponseActionLog).toHaveBeenCalledWith({
        actionId: 'act-001',
        actionType: 'pod_isolation',
        target: 'pod-abc',
        triggeringClassification: 'high',
        timestamp: '2024-01-15T10:00:02.000Z',
        outcome: 'success',
      });
    });

    it('should map "failure" result to "failure" outcome', async () => {
      const action: ResponseAction = {
        actionId: 'act-002',
        actionType: 'ip_block',
        target: '10.0.0.5',
        timestamp: '2024-01-15T10:00:03.000Z',
        threatClassification: 'critical',
        result: 'failure',
        retryCount: 3,
      };

      await broadcaster.broadcastResponseAction(action);

      expect(logClient.pushResponseActionLog).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failure' })
      );
    });

    it('should handle "additional_honeytokens" action type', async () => {
      const action: ResponseAction = {
        actionId: 'act-003',
        actionType: 'additional_honeytokens',
        target: 'namespace-prod',
        timestamp: '2024-01-15T10:00:04.000Z',
        threatClassification: 'medium',
        result: 'success',
        retryCount: 0,
      };

      await broadcaster.broadcastResponseAction(action);

      expect(logClient.pushResponseActionLog).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'additional_honeytokens' })
      );
    });

    it('should skip "alert" action type and not push to log client', async () => {
      const action: ResponseAction = {
        actionId: 'act-004',
        actionType: 'alert',
        target: 'ops-channel',
        timestamp: '2024-01-15T10:00:05.000Z',
        threatClassification: 'low',
        result: 'success',
        retryCount: 0,
      };

      await broadcaster.broadcastResponseAction(action);

      expect(logClient.pushResponseActionLog).not.toHaveBeenCalled();
    });

    it('should not include retryCount in the log payload', async () => {
      const action: ResponseAction = {
        actionId: 'act-005',
        actionType: 'pod_isolation',
        target: 'pod-xyz',
        timestamp: '2024-01-15T10:00:06.000Z',
        threatClassification: 'high',
        result: 'success',
        retryCount: 2,
      };

      await broadcaster.broadcastResponseAction(action);

      const call = (logClient.pushResponseActionLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call).not.toHaveProperty('retryCount');
    });
  });

  describe('broadcastHealthStatusChange', () => {
    it('should pass health status directly to metrics client', async () => {
      const status: ComponentHealthMetricPayload = {
        componentName: 'Tetragon_Monitor',
        status: 'healthy',
        lastSuccessfulCheckTimestamp: '2024-01-15T09:59:30.000Z',
      };

      await broadcaster.broadcastHealthStatusChange(status);

      expect(metricsClient.pushComponentHealthMetric).toHaveBeenCalledWith(status);
    });

    it('should handle unhealthy status', async () => {
      const status: ComponentHealthMetricPayload = {
        componentName: 'Koney_Deployer',
        status: 'unhealthy',
        lastSuccessfulCheckTimestamp: '2024-01-15T09:50:00.000Z',
      };

      await broadcaster.broadcastHealthStatusChange(status);

      expect(metricsClient.pushComponentHealthMetric).toHaveBeenCalledWith(status);
    });

    it('should handle degraded status', async () => {
      const status: ComponentHealthMetricPayload = {
        componentName: 'Vertex_AI_Trainer',
        status: 'degraded',
        lastSuccessfulCheckTimestamp: '2024-01-15T09:55:00.000Z',
      };

      await broadcaster.broadcastHealthStatusChange(status);

      expect(metricsClient.pushComponentHealthMetric).toHaveBeenCalledWith(status);
    });
  });

  describe('broadcastForensicReport', () => {
    function createTestReport(): ForensicReport {
      return {
        reportId: 'report-001',
        generationTimestamp: '2024-01-15T10:05:00.000Z',
        triggeringAccessEventId: 'evt-001',
        retentionDays: 90,
        accessEventDetails: {
          processId: 1234,
          userId: 1000,
          podId: 'pod-abc',
          namespace: 'production',
          honeytokenPath: '/etc/secrets/api-key',
          accessType: 'read',
          timestamp: '2024-01-15T10:00:00.123Z',
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
            timestamp: '2024-01-15T10:00:02.000Z',
            result: 'success',
          },
        ],
        timeline: [
          { eventDescription: 'Access detected', timestamp: '2024-01-15T10:00:00.123Z' },
          { eventDescription: 'Pod isolated', timestamp: '2024-01-15T10:00:02.000Z' },
        ],
        recommendedFollowUpActions: ['Review pod access patterns'],
      };
    }

    it('should transform forensic report and push as log', async () => {
      const report = createTestReport();

      await broadcaster.broadcastForensicReport(report);

      expect(logClient.pushForensicReportLog).toHaveBeenCalledWith({
        reportId: 'report-001',
        generationTimestamp: '2024-01-15T10:05:00.000Z',
        threatClassification: 'high',
        affectedPodId: 'pod-abc',
        namespace: 'production',
        reportContent: JSON.stringify(report),
      });
    });

    it('should extract threatClassification from contextualAssessment', async () => {
      const report = createTestReport();
      report.contextualAssessment.threatClassification = 'critical';

      await broadcaster.broadcastForensicReport(report);

      expect(logClient.pushForensicReportLog).toHaveBeenCalledWith(
        expect.objectContaining({ threatClassification: 'critical' })
      );
    });

    it('should extract podId and namespace from accessEventDetails', async () => {
      const report = createTestReport();
      report.accessEventDetails.podId = 'pod-custom';
      report.accessEventDetails.namespace = 'custom-ns';

      await broadcaster.broadcastForensicReport(report);

      expect(logClient.pushForensicReportLog).toHaveBeenCalledWith(
        expect.objectContaining({
          affectedPodId: 'pod-custom',
          namespace: 'custom-ns',
        })
      );
    });

    it('should serialize the full report as reportContent', async () => {
      const report = createTestReport();

      await broadcaster.broadcastForensicReport(report);

      const call = (logClient.pushForensicReportLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(call.reportContent);
      expect(parsed.reportId).toBe('report-001');
      expect(parsed.accessEventDetails.processId).toBe(1234);
      expect(parsed.responseActions).toHaveLength(1);
    });
  });

  describe('broadcastLearningMetrics', () => {
    it('should pass learning metrics directly to metrics client', async () => {
      const metrics: LearningMetricPayload = {
        modelVersionId: 'model-v3',
        validationAccuracy: 95.2,
        trainingDatasetSize: 200,
        trainingStatus: 'idle',
      };

      await broadcaster.broadcastLearningMetrics(metrics);

      expect(metricsClient.pushLearningMetrics).toHaveBeenCalledWith(metrics);
    });

    it('should handle training status', async () => {
      const metrics: LearningMetricPayload = {
        modelVersionId: 'model-v4',
        validationAccuracy: 0,
        trainingDatasetSize: 250,
        trainingStatus: 'training',
      };

      await broadcaster.broadcastLearningMetrics(metrics);

      expect(metricsClient.pushLearningMetrics).toHaveBeenCalledWith(metrics);
    });

    it('should handle failed training status', async () => {
      const metrics: LearningMetricPayload = {
        modelVersionId: 'model-v4',
        validationAccuracy: 88.0,
        trainingDatasetSize: 180,
        trainingStatus: 'failed',
      };

      await broadcaster.broadcastLearningMetrics(metrics);

      expect(metricsClient.pushLearningMetrics).toHaveBeenCalledWith(metrics);
    });
  });

  describe('broadcastIncidentTimeline', () => {
    it('should pass incident timeline directly to log client', async () => {
      const incident: IncidentTimelineLogPayload = {
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

      await broadcaster.broadcastIncidentTimeline(incident);

      expect(logClient.pushIncidentTimelineLog).toHaveBeenCalledWith(incident);
    });

    it('should handle escalated outcome', async () => {
      const incident: IncidentTimelineLogPayload = {
        incidentId: 'incident-002',
        timestamp: '2024-01-15T11:00:00.000Z',
        threatClassification: 'critical',
        affectedPodId: 'pod-xyz',
        namespace: 'production',
        responseActions: [
          { actionType: 'pod_isolation', outcome: 'failure' },
        ],
        finalOutcome: 'escalated',
      };

      await broadcaster.broadcastIncidentTimeline(incident);

      expect(logClient.pushIncidentTimelineLog).toHaveBeenCalledWith(incident);
    });

    it('should handle false_positive outcome', async () => {
      const incident: IncidentTimelineLogPayload = {
        incidentId: 'incident-003',
        timestamp: '2024-01-15T12:00:00.000Z',
        threatClassification: 'low',
        affectedPodId: 'pod-dev',
        namespace: 'development',
        responseActions: [],
        finalOutcome: 'false_positive',
      };

      await broadcaster.broadcastIncidentTimeline(incident);

      expect(logClient.pushIncidentTimelineLog).toHaveBeenCalledWith(incident);
    });
  });

  describe('error propagation', () => {
    it('should propagate errors from metrics client', async () => {
      (metricsClient.pushHoneytokenRegistryMetric as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Metrics API unavailable')
      );

      const entry: HoneytokenRegistryEntry = {
        honeytokenId: 'ht-err',
        podId: 'pod-err',
        namespace: 'ns',
        type: 'decoy_file',
        filePath: '/path',
        deploymentTimestamp: '2024-01-15T10:00:00.000Z',
        status: 'active',
        accessCount: 0,
      };

      await expect(broadcaster.broadcastHoneytokenRegistryChange(entry)).rejects.toThrow(
        'Metrics API unavailable'
      );
    });

    it('should propagate errors from log client', async () => {
      (logClient.pushAccessEventLog as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Log API unavailable')
      );

      const event: AccessEvent = {
        eventId: 'evt-err',
        processId: 1,
        processBinaryPath: '/bin/test',
        userId: 0,
        podId: 'pod-err',
        namespace: 'ns',
        honeytokenPath: '/path',
        accessType: 'read',
        timestamp: '2024-01-15T10:00:00.000Z',
      };

      await expect(broadcaster.broadcastAccessEvent(event, 'low')).rejects.toThrow(
        'Log API unavailable'
      );
    });
  });
});
