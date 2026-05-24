/**
 * End-to-end integration tests for the ebeecontrol workflow.
 *
 * Tests the full autonomous cycle:
 * Discovery → Deployment → Detection → Assessment → Response → Reporting → Learning → Broadcast
 *
 * Uses createComponents() and createWorkflowController() to wire the full system
 * and verifies the complete pipeline executes correctly.
 *
 * Validates: Requirements 8.1, 9.2, 9.4, 8.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createComponents, AgentComponents } from '../../src/index';
import { createWorkflowController, WorkflowController, WorkflowDependencies } from '../../src/agent/workflow';
import { AccessEvent } from '../../src/types/index';
import { FetchFn, FetchResponse } from '../../src/dynatrace/client';
import { EventBroadcaster } from '../../src/dynatrace-ingestion/event-broadcaster';

describe('End-to-End Integration', () => {
  let components: AgentComponents;
  let mockFetch: FetchFn;
  let mockEventBroadcaster: EventBroadcaster;

  const sampleAccessEvent: AccessEvent = {
    eventId: 'e2e-evt-001',
    processId: 5678,
    processBinaryPath: '/usr/bin/curl',
    userId: 1001,
    podId: 'pod-payment-1',
    namespace: 'production',
    honeytokenPath: '/tmp/.config/credentials-pod-payment-1.json',
    accessType: 'read',
    timestamp: '2024-01-20T14:30:00.000Z',
  };

  /**
   * Mock fetch that simulates Dynatrace MCP Server responses:
   * - /high-risk returns a list of high-risk services
   * - /context returns production pod context with high anomaly
   * - All other requests succeed with empty response
   */
  function createMockFetch(): FetchFn {
    return vi.fn(async (url: string) => {
      if (url.includes('/high-risk')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            services: [
              {
                serviceId: 'svc-payment',
                serviceName: 'payment-api',
                namespace: 'production',
                podIdentifiers: ['pod-payment-1'],
                riskScore: 92,
              },
              {
                serviceId: 'svc-auth',
                serviceName: 'auth-service',
                namespace: 'production',
                podIdentifiers: ['pod-auth-1'],
                riskScore: 85,
              },
            ],
          }),
        } as FetchResponse;
      }

      if (url.includes('/context')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            namespace: 'production',
            namespaceClassification: 'production',
            serviceCriticality: 4,
            davisAnomalyScore: 0.75,
            anomalyWindowMinutes: 10,
          }),
        } as FetchResponse;
      }

      // Default: success for all other requests (metrics, logs, etc.)
      return { ok: true, status: 200, json: async () => ({}) } as FetchResponse;
    });
  }

  beforeEach(() => {
    mockFetch = createMockFetch();
    components = createComponents(undefined, mockFetch);

    mockEventBroadcaster = {
      broadcastHoneytokenRegistryChange: vi.fn(async () => {}),
      broadcastAccessEvent: vi.fn(async () => {}),
      broadcastResponseAction: vi.fn(async () => {}),
      broadcastHealthStatusChange: vi.fn(async () => {}),
      broadcastForensicReport: vi.fn(async () => {}),
      broadcastLearningMetrics: vi.fn(async () => {}),
      broadcastIncidentTimeline: vi.fn(async () => {}),
    };
  });

  describe('Full discovery → deployment → detection → response cycle', () => {
    it('should complete the full workflow cycle using createComponents and createWorkflowController', async () => {
      const workflowDeps: WorkflowDependencies = {
        dynatraceClient: components.dynatraceClient,
        registry: components.registry,
        auditLog: components.auditLog,
        eventBroadcaster: mockEventBroadcaster,
        reportGenerator: components.reportGenerator,
        learningFeedbackLoop: components.learningFeedbackLoop,
        deploymentOrchestrator: components.deploymentOrchestrator,
        orchestrator: components.orchestrator,
        responseExecutorDeps: {
          isolatePod: vi.fn(async () => {}),
          blockIp: vi.fn(async () => {}),
          deployHoneytokens: vi.fn(async () => {}),
          sendAlert: vi.fn(async () => {}),
          auditLog: components.auditLog,
        },
      };

      const controller: WorkflowController = createWorkflowController(workflowDeps);

      // Phase 1: Discovery and Deployment
      await controller.runDiscoveryAndDeployment();

      // Verify registry has entries after discovery and deployment
      const registryEntries = components.registry.getAll();
      expect(registryEntries.length).toBeGreaterThan(0);

      // Verify honeytokens were broadcast to Dynatrace
      expect(mockEventBroadcaster.broadcastHoneytokenRegistryChange).toHaveBeenCalled();

      // Phase 2: Detection and Response
      // Add a matching registry entry for the access event (simulating detection)
      components.registry.addEntry({
        honeytokenId: 'ht-e2e-001',
        podId: 'pod-payment-1',
        namespace: 'production',
        type: 'decoy_file',
        filePath: '/tmp/.config/credentials-pod-payment-1.json',
        deploymentTimestamp: '2024-01-20T14:00:00.000Z',
        status: 'active',
        accessCount: 0,
      });

      // Process the access event through the full pipeline
      const result = await controller.processAccessEvent(sampleAccessEvent);

      // Verify assessment was completed
      expect(result.assessment).toBeDefined();
      expect(result.assessment.classification).toBe('high');
      expect(result.assessment.accessEventId).toBe('e2e-evt-001');

      // Verify response was executed
      expect(result.responseResult).toBeDefined();
      expect(result.responseResult.actions.length).toBeGreaterThan(0);

      // Verify forensic report was generated
      expect(result.forensicReport).toBeDefined();
      expect(result.forensicReport.reportId).toBeTruthy();
      expect(result.forensicReport.triggeringAccessEventId).toBe('e2e-evt-001');

      // Verify learning outcome was submitted
      expect(result.outcomeSubmitted).toBe(true);

      // Verify broadcast was completed
      expect(result.broadcastCompleted).toBe(true);
    });
  });

  describe('Discovery and deployment populates registry', () => {
    it('should populate the registry with entries after runDiscoveryAndDeployment', async () => {
      const workflowDeps: WorkflowDependencies = {
        dynatraceClient: components.dynatraceClient,
        registry: components.registry,
        auditLog: components.auditLog,
        eventBroadcaster: mockEventBroadcaster,
        reportGenerator: components.reportGenerator,
        learningFeedbackLoop: components.learningFeedbackLoop,
        deploymentOrchestrator: components.deploymentOrchestrator,
        orchestrator: components.orchestrator,
        responseExecutorDeps: {
          isolatePod: vi.fn(async () => {}),
          blockIp: vi.fn(async () => {}),
          deployHoneytokens: vi.fn(async () => {}),
          sendAlert: vi.fn(async () => {}),
          auditLog: components.auditLog,
        },
      };

      const controller = createWorkflowController(workflowDeps);

      // Registry should be empty before discovery
      expect(components.registry.getAll().length).toBe(0);

      // Run discovery and deployment
      await controller.runDiscoveryAndDeployment();

      // Registry should now have entries
      const entries = components.registry.getAll();
      expect(entries.length).toBeGreaterThan(0);

      // All entries should be active
      for (const entry of entries) {
        expect(entry.status).toBe('active');
        expect(entry.honeytokenId).toBeTruthy();
        expect(entry.podId).toBeTruthy();
        expect(entry.namespace).toBeTruthy();
        expect(entry.filePath).toBeTruthy();
        expect(entry.deploymentTimestamp).toBeTruthy();
      }

      // Audit log should record the deployment decision
      const deploymentLogs = components.auditLog.getByType('deployment');
      expect(deploymentLogs.length).toBeGreaterThan(0);
    });
  });

  describe('processAccessEvent executes full pipeline', () => {
    it('should execute assessment, response, report, learning, and broadcast', async () => {
      const mockIsolatePod = vi.fn(async () => {});
      const mockBlockIp = vi.fn(async () => {});
      const mockDeployHoneytokens = vi.fn(async () => {});
      const mockSendAlert = vi.fn(async () => {});

      const workflowDeps: WorkflowDependencies = {
        dynatraceClient: components.dynatraceClient,
        registry: components.registry,
        auditLog: components.auditLog,
        eventBroadcaster: mockEventBroadcaster,
        reportGenerator: components.reportGenerator,
        learningFeedbackLoop: components.learningFeedbackLoop,
        deploymentOrchestrator: components.deploymentOrchestrator,
        orchestrator: components.orchestrator,
        responseExecutorDeps: {
          isolatePod: mockIsolatePod,
          blockIp: mockBlockIp,
          deployHoneytokens: mockDeployHoneytokens,
          sendAlert: mockSendAlert,
          auditLog: components.auditLog,
        },
      };

      const controller = createWorkflowController(workflowDeps);

      // Add a matching registry entry
      components.registry.addEntry({
        honeytokenId: 'ht-pipeline-001',
        podId: 'pod-payment-1',
        namespace: 'production',
        type: 'decoy_file',
        filePath: '/tmp/.config/credentials-pod-payment-1.json',
        deploymentTimestamp: '2024-01-20T14:00:00.000Z',
        status: 'active',
        accessCount: 0,
      });

      const result = await controller.processAccessEvent(sampleAccessEvent);

      // 1. Assessment was performed
      expect(result.assessment.classification).toBe('high');
      expect(result.assessment.inputs.namespaceClassification).toBe('production');
      expect(result.assessment.inputs.serviceCriticality).toBe(4);
      expect(result.assessment.inputs.davisAnomalyScore).toBe(0.75);

      // 2. Response was executed (high threat = pod isolation + ip block + honeytokens)
      expect(mockIsolatePod).toHaveBeenCalled();
      expect(mockBlockIp).toHaveBeenCalled();
      expect(mockDeployHoneytokens).toHaveBeenCalled();

      // 3. Forensic report was generated
      expect(result.forensicReport.reportId).toBeTruthy();
      expect(result.forensicReport.accessEventDetails.podId).toBe('pod-payment-1');
      expect(result.forensicReport.contextualAssessment.threatClassification).toBe('high');
      expect(result.forensicReport.recommendedFollowUpActions.length).toBeGreaterThanOrEqual(1);

      // 4. Learning outcome was submitted
      expect(result.outcomeSubmitted).toBe(true);

      // 5. Broadcasts were made
      expect(mockEventBroadcaster.broadcastAccessEvent).toHaveBeenCalledWith(
        sampleAccessEvent,
        'high'
      );
      expect(mockEventBroadcaster.broadcastResponseAction).toHaveBeenCalled();
      expect(mockEventBroadcaster.broadcastForensicReport).toHaveBeenCalled();
      expect(mockEventBroadcaster.broadcastIncidentTimeline).toHaveBeenCalled();

      // 6. Registry entry was updated to triggered
      const entry = components.registry.getById('ht-pipeline-001');
      expect(entry?.status).toBe('triggered');
      expect(entry?.accessCount).toBe(1);

      // 7. Audit log recorded the workflow completion
      const responseLogs = components.auditLog.getByType('response');
      const workflowLog = responseLogs.find((e) =>
        e.decisionRationale.includes('Full workflow completed')
      );
      expect(workflowLog).toBeDefined();
    });
  });

  describe('Health endpoint returns correct format', () => {
    it('should return health status with correct structure and all components', () => {
      const healthStatus = components.healthMonitor.getHealthStatus();

      // Verify overall status field
      expect(['healthy', 'degraded', 'unhealthy']).toContain(healthStatus.overall);

      // Verify timestamp is present and valid ISO 8601
      expect(healthStatus.timestamp).toBeTruthy();
      expect(new Date(healthStatus.timestamp).toISOString()).toBe(healthStatus.timestamp);

      // Verify components object has the expected structure
      expect(healthStatus.components).toBeDefined();

      // Verify each registered component has the correct fields
      const componentNames = Object.keys(healthStatus.components);
      expect(componentNames.length).toBeGreaterThan(0);

      for (const name of componentNames) {
        const component = healthStatus.components[name as keyof typeof healthStatus.components];
        expect(['healthy', 'unhealthy', 'degraded']).toContain(component.status);
        expect(component.lastCheckTimestamp).toBeTruthy();
        expect(new Date(component.lastCheckTimestamp).toISOString()).toBe(
          component.lastCheckTimestamp
        );
      }
    });

    it('should report all four system components in health status', () => {
      const healthStatus = components.healthMonitor.getHealthStatus();
      const componentNames = Object.keys(healthStatus.components);

      // The four system components should be registered
      expect(componentNames).toContain('Tetragon_Monitor');
      expect(componentNames).toContain('Koney_Deployer');
      expect(componentNames).toContain('Dynatrace_MCP_Server');
      expect(componentNames).toContain('Vertex_AI_Trainer');
    });

    it('should return healthy status when all components pass their checks', async () => {
      const healthStatus = await components.healthMonitor.checkNow();

      // With the mock fetch, all components should be healthy
      expect(healthStatus.overall).toBe('healthy');

      for (const name of Object.keys(healthStatus.components)) {
        const component = healthStatus.components[name as keyof typeof healthStatus.components];
        expect(component.status).toBe('healthy');
      }
    });
  });
});
