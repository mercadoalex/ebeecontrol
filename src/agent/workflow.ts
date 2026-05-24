/**
 * Full Workflow Cycle Integration for the Ebeecontrol Agent.
 *
 * Wires the complete autonomous cycle:
 * Discovery → Deployment → Detection → Assessment → Response → Reporting → Learning
 *
 * On access event:
 * 1. Assess threat (query Dynatrace for context, classify)
 * 2. Execute response (pod isolation, IP block, additional honeytokens)
 * 3. Generate forensic report
 * 4. Submit outcome data to Vertex AI
 * 5. Broadcast all events to Dynatrace ingestion
 *
 * Validates: Requirements 8.1, 6.1, 7.1, 9.2, 9.4, 9.6
 */

import { v4 as uuidv4 } from 'uuid';
import { AccessEvent, ThreatAssessment, ForensicReport } from '../types/index';
import { IncidentTimelineLogPayload } from '../types/dynatrace-ingestion';
import { DynatraceClient } from '../dynatrace/client';
import { HoneytokenRegistry } from './registry';
import { AuditLog } from './audit-log';
import { EventBroadcaster } from '../dynatrace-ingestion/event-broadcaster';
import { createThreatAssessmentWorkflow } from './threat-assessment-workflow';
import { classifyThreat, classifyThreatWithDefaults } from './threat-classifier';
import { generateResponsePlan } from './response-planner';
import { executeResponse, ResponseExecutorDependencies, ResponseExecutionResult } from './response-executor';
import { ReportGenerator, IncidentData } from './report-generator';
import { LearningFeedbackLoop } from './learning-feedback';
import { DeploymentOrchestrator } from './deployment-orchestrator';
import { Orchestrator } from './orchestrator';

/**
 * Dependencies required by the workflow.
 */
export interface WorkflowDependencies {
  dynatraceClient: DynatraceClient;
  registry: HoneytokenRegistry;
  auditLog: AuditLog;
  eventBroadcaster: EventBroadcaster;
  reportGenerator: ReportGenerator;
  learningFeedbackLoop: LearningFeedbackLoop;
  deploymentOrchestrator: DeploymentOrchestrator;
  orchestrator: Orchestrator;
  responseExecutorDeps: ResponseExecutorDependencies;
}

/**
 * Result of processing a single access event through the full workflow.
 */
export interface WorkflowResult {
  accessEvent: AccessEvent;
  assessment: ThreatAssessment;
  responseResult: ResponseExecutionResult;
  forensicReport: ForensicReport;
  outcomeSubmitted: boolean;
  broadcastCompleted: boolean;
}

/**
 * The workflow controller that manages the full autonomous cycle.
 */
export interface WorkflowController {
  /**
   * Processes a single access event through the full workflow cycle:
   * Assessment → Response → Reporting → Learning → Dynatrace Ingestion
   */
  processAccessEvent(event: AccessEvent): Promise<WorkflowResult>;

  /**
   * Runs a full discovery and deployment cycle:
   * Discovery → Deployment
   */
  runDiscoveryAndDeployment(): Promise<void>;

  /**
   * Connects the Dynatrace client's access event subscription to the workflow.
   * When an access event is received from Tetragon via Dynatrace, it triggers
   * the full workflow automatically.
   */
  connectEventFlow(): void;
}

/**
 * Creates a WorkflowController that wires the full autonomous cycle.
 *
 * The workflow connects:
 * - Tetragon → Dynatrace → Agent (via onAccessEvent subscription)
 * - Agent → Response (via response planner + executor)
 * - Agent → Reporting (via report generator)
 * - Agent → Learning (via learning feedback loop)
 * - Agent → Dynatrace Ingestion (via event broadcaster)
 */
export function createWorkflowController(
  deps: WorkflowDependencies
): WorkflowController {
  const {
    dynatraceClient,
    registry,
    auditLog,
    eventBroadcaster,
    reportGenerator,
    learningFeedbackLoop,
    deploymentOrchestrator,
    orchestrator,
    responseExecutorDeps,
  } = deps;

  // Create the threat assessment workflow
  const threatAssessment = createThreatAssessmentWorkflow({
    podContextProvider: dynatraceClient,
    classifyThreat,
    classifyThreatWithDefaults,
  });

  /**
   * Processes a single access event through the full workflow cycle.
   */
  async function processAccessEvent(event: AccessEvent): Promise<WorkflowResult> {
    // 1. Assess threat
    const assessment = await threatAssessment.assessThreat(event);

    // Broadcast access event to Dynatrace
    await eventBroadcaster.broadcastAccessEvent(event, assessment.classification);

    // Mark honeytoken as triggered in registry
    const registryEntries = registry.getAll();
    const matchingEntry = registryEntries.find(
      (e) => e.podId === event.podId && e.filePath === event.honeytokenPath
    );
    if (matchingEntry) {
      registry.updateStatus(matchingEntry.honeytokenId, 'triggered');
      registry.recordAccess(matchingEntry.honeytokenId, event.timestamp);
    }

    // 2. Execute response based on classification
    const responsePlan = generateResponsePlan(assessment, {
      namespace: event.namespace,
      podId: event.podId,
    });

    const responseResult = await executeResponse(
      responsePlan,
      assessment,
      responseExecutorDeps
    );

    // Broadcast response actions to Dynatrace
    for (const action of responseResult.actions) {
      await eventBroadcaster.broadcastResponseAction(action);
    }

    // 3. Generate forensic report (triggers after response completion)
    const incidentData: IncidentData = {
      accessEvent: event,
      threatAssessment: assessment,
      responseActions: responseResult.actions,
    };

    const forensicReport = await reportGenerator.generate(incidentData);

    // Broadcast forensic report to Dynatrace
    await eventBroadcaster.broadcastForensicReport(forensicReport);

    // 4. Submit outcome data to Vertex AI (triggers after response completion)
    let outcomeSubmitted = false;
    try {
      const honeytokenType = matchingEntry?.type ?? 'decoy_file';
      const placementLocation = matchingEntry?.filePath ?? event.honeytokenPath;

      await learningFeedbackLoop.submitOutcome(
        {
          incidentId: uuidv4(),
          accessEvent: event,
          honeytokenType,
          placementLocation,
        },
        {
          actionsTaken: responseResult.actions,
          effectiveness: {
            detectionToResponseLatencySeconds: assessment.assessmentLatencyMs / 1000,
            threatContained: responseResult.allSucceeded,
            falsePositive: false,
          },
        }
      );
      outcomeSubmitted = true;
    } catch {
      outcomeSubmitted = false;
    }

    // 5. Broadcast incident timeline to Dynatrace
    let broadcastCompleted = false;
    try {
      const incidentTimeline: IncidentTimelineLogPayload = {
        incidentId: uuidv4(),
        timestamp: event.timestamp,
        threatClassification: assessment.classification,
        affectedPodId: event.podId,
        namespace: event.namespace,
        responseActions: responseResult.actions.map((a) => ({
          actionType: a.actionType,
          outcome: a.result,
        })),
        finalOutcome: responseResult.allSucceeded ? 'contained' : 'escalated',
      };

      await eventBroadcaster.broadcastIncidentTimeline(incidentTimeline);
      broadcastCompleted = true;
    } catch {
      broadcastCompleted = false;
    }

    // Log the full workflow completion to audit log
    auditLog.log({
      decisionType: 'response',
      decisionRationale: `Full workflow completed for access event ${event.eventId}: ${assessment.classification} threat`,
      inputDataSummary: `eventId=${event.eventId}, podId=${event.podId}, namespace=${event.namespace}, classification=${assessment.classification}`,
      outcome: `Response: ${responseResult.allSucceeded ? 'all succeeded' : 'some failures'}. Report: ${forensicReport.reportId}. Learning: ${outcomeSubmitted ? 'submitted' : 'failed'}`,
    });

    return {
      accessEvent: event,
      assessment,
      responseResult,
      forensicReport,
      outcomeSubmitted,
      broadcastCompleted,
    };
  }

  /**
   * Runs a full discovery and deployment cycle.
   */
  async function runDiscoveryAndDeployment(): Promise<void> {
    const discoveryResult = await orchestrator.initiateDiscoveryCycle();

    if (discoveryResult.skipped || discoveryResult.servicesFound === 0) {
      return;
    }

    // Deploy honeytokens to discovered high-risk services
    const deploymentResult = await deploymentOrchestrator.deployToTargets(
      discoveryResult.rankedServices
    );

    // Broadcast registry changes for newly deployed honeytokens
    for (const entry of deploymentResult.deployedHoneytokens) {
      await eventBroadcaster.broadcastHoneytokenRegistryChange(entry);
    }

    auditLog.log({
      decisionType: 'deployment',
      decisionRationale: `Deployed honeytokens to ${deploymentResult.successfulDeployments} targets after discovery cycle`,
      inputDataSummary: `targets=${deploymentResult.totalTargets}, successful=${deploymentResult.successfulDeployments}, failed=${deploymentResult.failedDeployments}`,
      outcome: `Deployed ${deploymentResult.deployedHoneytokens.length} honeytokens total`,
    });
  }

  /**
   * Connects the Dynatrace client's access event subscription to the workflow.
   */
  function connectEventFlow(): void {
    dynatraceClient.onAccessEvent((event: AccessEvent) => {
      // Process the event asynchronously through the full workflow
      processAccessEvent(event).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        auditLog.log({
          decisionType: 'assessment',
          decisionRationale: `Failed to process access event ${event.eventId}`,
          inputDataSummary: `eventId=${event.eventId}, podId=${event.podId}`,
          outcome: `Error: ${errorMessage}`,
        });
      });
    });
  }

  return {
    processAccessEvent,
    runDiscoveryAndDeployment,
    connectEventFlow,
  };
}
