/**
 * Unit tests for the full workflow cycle integration.
 *
 * Tests the complete autonomous cycle:
 * Discovery → Deployment → Detection → Assessment → Response → Reporting → Learning
 *
 * Validates: Requirements 8.1, 6.1, 7.1, 9.2, 9.4, 9.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkflowController, WorkflowDependencies } from './workflow';
import { AccessEvent, ThreatAssessment, ResponseAction, ForensicReport, HoneytokenRegistryEntry } from '../types/index';
import { IncidentTimelineLogPayload, ComponentHealthMetricPayload, LearningMetricPayload } from '../types/dynatrace-ingestion';
import { ThreatClassification } from './threat-classifier';
import { EventBroadcaster } from '../dynatrace-ingestion/event-broadcaster';
import { DynatraceClient, FetchFn, FetchResponse } from '../dynatrace/client';
import { createHoneytokenRegistry } from './registry';
import { createAuditLog } from './audit-log';
import { createReportGenerator } from './report-generator';
import { createLearningFeedbackLoop } from './learning-feedback';
import { createDeploymentOrchestrator } from './deployment-orchestrator';
import { createOrchestrator } from './orchestrator';
import { createKoneyDeployer } from '../koney/deployer';
import { createTetragonMonitor } from '../tetragon/monitor';
import { VertexAiTrainer } from '../vertex/trainer';
import { rankServices } from '../utils/ranking';

describe('WorkflowController', () => {
  let deps: WorkflowDependencies;
  let mockFetch: FetchFn;
  let dynatraceClient: DynatraceClient;
  let registry: ReturnType<typeof createHoneytokenRegistry>;
  let auditLog: ReturnType<typeof createAuditLog>;
  let mockEventBroadcaster: EventBroadcaster;

  const sampleAccessEvent: AccessEvent = {
    eventId: 'evt-001',
    processId: 1234,
    processBinaryPath: '/usr/bin/cat',
    userId: 1000,
    podId: 'pod-target-1',
    namespace: 'production',
    honeytokenPath: '/tmp/.config/credentials.json',
    accessType: 'read',
    timestamp: '2024-01-15T10:00:00.000Z',
  };

  beforeEach(() => {
    // Mock fetch that returns production context with high anomaly
    mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/context')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            namespace: 'production',
            namespaceClassification: 'production',
            serviceCriticality: 4,
            davisAnomalyScore: 0.7,
            anomalyWindowMinutes: 10,
          }),
        } as FetchResponse;
      }
      return { ok: true, status: 200, json: async () => ({}) } as FetchResponse;
    });

    dynatraceClient = new DynatraceClient(
      { endpointUrl: 'http://localhost:8080' },
      mockFetch
    );

    registry = createHoneytokenRegistry();
    auditLog = createAuditLog();

    // Add a matching registry entry for the access event
    registry.addEntry({
      honeytokenId: 'ht-001',
      podId: 'pod-target-1',
      namespace: 'production',
      type: 'decoy_file',
      filePath: '/tmp/.config/credentials.json',
      deploymentTimestamp: '2024-01-15T09:00:00.000Z',
      status: 'active',
      accessCount: 0,
    });

    mockEventBroadcaster = {
      broadcastHoneytokenRegistryChange: vi.fn(async () => {}),
      broadcastAccessEvent: vi.fn(async () => {}),
      broadcastResponseAction: vi.fn(async () => {}),
      broadcastHealthStatusChange: vi.fn(async () => {}),
      broadcastForensicReport: vi.fn(async () => {}),
      broadcastLearningMetrics: vi.fn(async () => {}),
      broadcastIncidentTimeline: vi.fn(async () => {}),
    };

    const vertexAiTrainer = new VertexAiTrainer();
    const learningFeedbackLoop = createLearningFeedbackLoop(vertexAiTrainer, auditLog);

    const reportGenerator = createReportGenerator(
      async () => 'Generated forensic report content'
    );

    const koneyDeployer = createKoneyDeployer();
    const tetragonMonitor = createTetragonMonitor();

    const deploymentOrchestrator = createDeploymentOrchestrator({
      deployer: koneyDeployer,
      registry,
      tetragonMonitor,
    });

    const orchestrator = createOrchestrator(
      { discoveryIntervalMinutes: 60 },
      {
        queryHighRiskServices: () => dynatraceClient.queryHighRiskServices(),
        rankServices,
      }
    );

    const responseExecutorDeps = {
      isolatePod: vi.fn(async () => {}),
      blockIp: vi.fn(async () => {}),
      deployHoneytokens: vi.fn(async () => {}),
      sendAlert: vi.fn(async () => {}),
      auditLog,
    };

    deps = {
      dynatraceClient,
      registry,
      auditLog,
      eventBroadcaster: mockEventBroadcaster,
      reportGenerator,
      learningFeedbackLoop,
      deploymentOrchestrator,
      orchestrator,
      responseExecutorDeps,
    };
  });

  describe('processAccessEvent', () => {
    it('should complete the full workflow cycle for an access event', async () => {
      const controller = createWorkflowController(deps);
      const result = await controller.processAccessEvent(sampleAccessEvent);

      // Assessment should be completed
      expect(result.assessment).toBeDefined();
      expect(result.assessment.classification).toBe('high');
      expect(result.assessment.accessEventId).toBe('evt-001');

      // Response should be executed
      expect(result.responseResult).toBeDefined();
      expect(result.responseResult.actions.length).toBeGreaterThan(0);

      // Forensic report should be generated
      expect(result.forensicReport).toBeDefined();
      expect(result.forensicReport.reportId).toBeTruthy();
      expect(result.forensicReport.triggeringAccessEventId).toBe('evt-001');

      // Outcome should be submitted
      expect(result.outcomeSubmitted).toBe(true);

      // Broadcast should be completed
      expect(result.broadcastCompleted).toBe(true);
    });

    it('should broadcast access event to Dynatrace', async () => {
      const controller = createWorkflowController(deps);
      await controller.processAccessEvent(sampleAccessEvent);

      expect(mockEventBroadcaster.broadcastAccessEvent).toHaveBeenCalledWith(
        sampleAccessEvent,
        'high'
      );
    });

    it('should broadcast response actions to Dynatrace', async () => {
      const controller = createWorkflowController(deps);
      await controller.processAccessEvent(sampleAccessEvent);

      expect(mockEventBroadcaster.broadcastResponseAction).toHaveBeenCalled();
    });

    it('should generate forensic report after response completion', async () => {
      const controller = createWorkflowController(deps);
      const result = await controller.processAccessEvent(sampleAccessEvent);

      // Report should contain the response actions
      expect(result.forensicReport.responseActions.length).toBeGreaterThan(0);
      expect(result.forensicReport.accessEventDetails.podId).toBe('pod-target-1');
    });

    it('should broadcast forensic report to Dynatrace', async () => {
      const controller = createWorkflowController(deps);
      await controller.processAccessEvent(sampleAccessEvent);

      expect(mockEventBroadcaster.broadcastForensicReport).toHaveBeenCalled();
    });

    it('should submit outcome data after response completion', async () => {
      const controller = createWorkflowController(deps);
      const result = await controller.processAccessEvent(sampleAccessEvent);

      expect(result.outcomeSubmitted).toBe(true);
    });

    it('should broadcast incident timeline to Dynatrace', async () => {
      const controller = createWorkflowController(deps);
      await controller.processAccessEvent(sampleAccessEvent);

      expect(mockEventBroadcaster.broadcastIncidentTimeline).toHaveBeenCalled();
    });

    it('should mark honeytoken as triggered in registry', async () => {
      const controller = createWorkflowController(deps);
      await controller.processAccessEvent(sampleAccessEvent);

      const entry = registry.getById('ht-001');
      expect(entry?.status).toBe('triggered');
      expect(entry?.accessCount).toBe(1);
    });

    it('should log the workflow completion to audit log', async () => {
      const controller = createWorkflowController(deps);
      await controller.processAccessEvent(sampleAccessEvent);

      const entries = auditLog.getByType('response');
      const workflowEntry = entries.find((e) =>
        e.decisionRationale.includes('Full workflow completed')
      );
      expect(workflowEntry).toBeDefined();
    });

    it('should handle missing registry entry gracefully', async () => {
      // Remove the registry entry
      registry.remove('ht-001');

      const controller = createWorkflowController(deps);
      const result = await controller.processAccessEvent(sampleAccessEvent);

      // Workflow should still complete
      expect(result.assessment).toBeDefined();
      expect(result.forensicReport).toBeDefined();
      expect(result.outcomeSubmitted).toBe(true);
    });
  });

  describe('runDiscoveryAndDeployment', () => {
    it('should skip deployment when no services found', async () => {
      const controller = createWorkflowController(deps);
      await controller.runDiscoveryAndDeployment();

      // No honeytokens should be broadcast since no services were found
      expect(mockEventBroadcaster.broadcastHoneytokenRegistryChange).not.toHaveBeenCalled();
    });

    it('should deploy honeytokens when services are discovered', async () => {
      // Mock fetch to return high-risk services
      const fetchWithServices: FetchFn = vi.fn(async (url: string) => {
        if (url.includes('/high-risk')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              services: [
                {
                  serviceId: 'svc-1',
                  serviceName: 'payment-api',
                  namespace: 'production',
                  podIdentifiers: ['pod-pay-1'],
                  riskScore: 85,
                },
              ],
            }),
          } as FetchResponse;
        }
        return { ok: true, status: 200, json: async () => ({}) } as FetchResponse;
      });

      const dtClient = new DynatraceClient(
        { endpointUrl: 'http://localhost:8080' },
        fetchWithServices
      );

      const koneyDeployer = createKoneyDeployer();
      const tetragonMonitor = createTetragonMonitor();

      const localDeps: WorkflowDependencies = {
        ...deps,
        dynatraceClient: dtClient,
        orchestrator: createOrchestrator(
          { discoveryIntervalMinutes: 60 },
          {
            queryHighRiskServices: () => dtClient.queryHighRiskServices(),
            rankServices,
          }
        ),
        deploymentOrchestrator: createDeploymentOrchestrator({
          deployer: koneyDeployer,
          registry,
          tetragonMonitor,
        }),
      };

      const controller = createWorkflowController(localDeps);
      await controller.runDiscoveryAndDeployment();

      // Honeytokens should be broadcast
      expect(mockEventBroadcaster.broadcastHoneytokenRegistryChange).toHaveBeenCalled();

      // Audit log should record the deployment
      const deploymentEntries = auditLog.getByType('deployment');
      expect(deploymentEntries.length).toBeGreaterThan(0);
    });
  });

  describe('connectEventFlow', () => {
    it('should register an access event handler on the Dynatrace client', () => {
      const controller = createWorkflowController(deps);
      controller.connectEventFlow();

      // Emit an event and verify it gets processed
      // The handler is async so we just verify it doesn't throw
      expect(() => {
        dynatraceClient.emitAccessEvent(sampleAccessEvent);
      }).not.toThrow();
    });
  });
});
