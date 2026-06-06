/**
 * Event Broadcaster - Pushes system events to Dynatrace ingestion clients.
 *
 * Transforms internal domain types (HoneytokenRegistryEntry, AccessEvent,
 * ResponseAction, ForensicReport, etc.) into Dynatrace payload types and
 * delegates to the appropriate ingestion client (metrics or logs).
 *
 * Validates: Requirements 9.2, 9.4, 9.6, 9.8, 9.10, 9.12
 */

import { DynatraceMetricsClient } from './metrics-client';
import { DynatraceLogClient } from './log-client';
import {
  HoneytokenRegistryMetricPayload,
  ComponentHealthMetricPayload,
  LearningMetricPayload,
  AccessEventLogPayload,
  ResponseActionLogPayload,
  ForensicReportLogPayload,
  IncidentTimelineLogPayload,
} from '../types/dynatrace-ingestion';
import {
  HoneytokenRegistryEntry,
  AccessEvent,
  ResponseAction,
  ForensicReport,
} from '../types/index';
import { ThreatClassification } from '../agent/threat-classifier';

/**
 * Interface for the event broadcaster.
 */
export interface EventBroadcaster {
  broadcastHoneytokenRegistryChange(entry: HoneytokenRegistryEntry): Promise<void>;
  broadcastAccessEvent(event: AccessEvent, classification: ThreatClassification): Promise<void>;
  broadcastResponseAction(action: ResponseAction): Promise<void>;
  broadcastHealthStatusChange(status: ComponentHealthMetricPayload): Promise<void>;
  broadcastForensicReport(report: ForensicReport, options?: { gistUrl?: string }): Promise<void>;
  broadcastLearningMetrics(metrics: LearningMetricPayload): Promise<void>;
  broadcastIncidentTimeline(incident: IncidentTimelineLogPayload): Promise<void>;
}

/**
 * Transforms a HoneytokenRegistryEntry status to the Dynatrace metric payload status.
 * Internal "decommissioned" maps to "expired" in the Dynatrace payload.
 */
function mapRegistryStatus(
  status: HoneytokenRegistryEntry['status']
): HoneytokenRegistryMetricPayload['status'] {
  if (status === 'decommissioned') return 'expired';
  return status as 'active' | 'triggered';
}

/**
 * Transforms a ResponseAction result to the Dynatrace log payload outcome.
 */
function mapResponseOutcome(
  result: ResponseAction['result']
): ResponseActionLogPayload['outcome'] {
  return result;
}

/**
 * Transforms a ResponseAction actionType to the Dynatrace log payload actionType.
 * Internal "alert" type is not pushed to Dynatrace logs (filtered out upstream).
 */
function mapResponseActionType(
  actionType: ResponseAction['actionType']
): ResponseActionLogPayload['actionType'] | null {
  if (actionType === 'alert') return null;
  return actionType;
}

/**
 * Creates an EventBroadcaster that pushes system events to Dynatrace.
 *
 * @param metricsClient - Dynatrace Metrics API client for pushing numeric metrics
 * @param logClient - Dynatrace Log Ingestion API client for pushing structured logs
 * @returns An EventBroadcaster instance
 */
export function createEventBroadcaster(
  metricsClient: DynatraceMetricsClient,
  logClient: DynatraceLogClient
): EventBroadcaster {
  return {
    /**
     * Broadcasts a honeytoken registry change as a metric to Dynatrace.
     * Transforms internal HoneytokenRegistryEntry to HoneytokenRegistryMetricPayload.
     *
     * Validates: Requirements 9.2
     */
    async broadcastHoneytokenRegistryChange(entry: HoneytokenRegistryEntry): Promise<void> {
      const payload: HoneytokenRegistryMetricPayload = {
        honeytokenId: entry.honeytokenId,
        podId: entry.podId,
        namespace: entry.namespace,
        type: entry.type,
        deploymentTimestamp: entry.deploymentTimestamp,
        status: mapRegistryStatus(entry.status),
      };
      await metricsClient.pushHoneytokenRegistryMetric(payload);
      // Also push as a log entry so dashboard DQL queries can find it
      await logClient.pushAccessEventLog(payload as any);
    },

    /**
     * Broadcasts an access event as a structured log to Dynatrace.
     * Transforms internal AccessEvent + ThreatClassification to AccessEventLogPayload.
     *
     * Validates: Requirements 9.4
     */
    async broadcastAccessEvent(event: AccessEvent, classification: ThreatClassification): Promise<void> {
      const payload: AccessEventLogPayload = {
        timestamp: event.timestamp,
        podId: event.podId,
        namespace: event.namespace,
        processBinaryPath: event.processBinaryPath,
        accessType: event.accessType,
        threatClassification: classification,
      };
      await logClient.pushAccessEventLog(payload);
    },

    /**
     * Broadcasts a response action as a structured log to Dynatrace.
     * Transforms internal ResponseAction to ResponseActionLogPayload.
     * Skips "alert" action types as they are not pushed to Dynatrace.
     *
     * Validates: Requirements 9.6
     */
    async broadcastResponseAction(action: ResponseAction): Promise<void> {
      const actionType = mapResponseActionType(action.actionType);
      if (actionType === null) return; // Skip alert-only actions

      const payload: ResponseActionLogPayload = {
        actionId: action.actionId,
        actionType,
        target: action.target,
        triggeringClassification: action.threatClassification,
        timestamp: action.timestamp,
        outcome: mapResponseOutcome(action.result),
      };
      await logClient.pushResponseActionLog(payload);
    },

    /**
     * Broadcasts a health status change as a metric to Dynatrace.
     * The payload is already in the correct format (ComponentHealthMetricPayload).
     *
     * Validates: Requirements 9.8
     */
    async broadcastHealthStatusChange(status: ComponentHealthMetricPayload): Promise<void> {
      await metricsClient.pushComponentHealthMetric(status);
      // Also push as log for dashboard queries
      await logClient.pushAccessEventLog(status as any);
    },

    /**
     * Broadcasts a forensic report as a structured log to Dynatrace.
     * Transforms internal ForensicReport to ForensicReportLogPayload.
     *
     * Validates: Requirements 9.10
     */
    async broadcastForensicReport(report: ForensicReport, options?: { gistUrl?: string }): Promise<void> {
      const payload: ForensicReportLogPayload = {
        reportId: report.reportId,
        generationTimestamp: report.generationTimestamp,
        threatClassification: report.contextualAssessment.threatClassification,
        affectedPodId: report.accessEventDetails.podId,
        namespace: report.accessEventDetails.namespace,
        reportContent: JSON.stringify(report),
        ...(options?.gistUrl ? { gistUrl: options.gistUrl } : {}),
      };
      await logClient.pushForensicReportLog(payload);
    },

    /**
     * Broadcasts adaptive learning metrics to Dynatrace.
     * The payload is already in the correct format (LearningMetricPayload).
     *
     * Validates: Requirements 9.12
     */
    async broadcastLearningMetrics(metrics: LearningMetricPayload): Promise<void> {
      await metricsClient.pushLearningMetrics(metrics);
      // Also push as log for dashboard queries
      await logClient.pushAccessEventLog(metrics as any);
    },

    /**
     * Broadcasts an incident timeline entry as a structured log to Dynatrace.
     * The payload is already in the correct format (IncidentTimelineLogPayload).
     *
     * Validates: Requirements 9.12
     */
    async broadcastIncidentTimeline(incident: IncidentTimelineLogPayload): Promise<void> {
      await logClient.pushIncidentTimelineLog(incident);
    },
  };
}
