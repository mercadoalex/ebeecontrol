/**
 * Forensic report generator for the Ebeecontrol Agent.
 *
 * Generates structured forensic reports after a threat response sequence.
 * Uses a Gemini function (injected) to produce report content, with retry logic
 * (3 retries at 10-second intervals) and a 60-second generation timeout.
 *
 * Reports are stored with a unique UUID, generation timestamp, and association
 * to the triggering access event. Default retention is 90 days.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.5
 */

import { v4 as uuidv4 } from "uuid";
import {
  AccessEvent,
  ThreatAssessment,
  ResponseAction,
  ForensicReport,
} from "../types/index";

/**
 * Configuration for the report generator.
 */
export interface ReportGeneratorConfig {
  retentionDays: number; // default 90
  generationTimeoutSeconds: number; // default 60
  maxRetries: number; // default 3
  retryIntervalSeconds: number; // default 10
}

/**
 * A function that calls the Gemini model with a prompt and returns a response string.
 */
export type GeminiGenerateFn = (prompt: string) => Promise<string>;

/**
 * Incident data needed to generate a forensic report.
 */
export interface IncidentData {
  accessEvent: AccessEvent;
  threatAssessment: ThreatAssessment;
  responseActions: ResponseAction[];
}

/**
 * Interface for the report generator.
 */
export interface ReportGenerator {
  generate(incident: IncidentData): Promise<ForensicReport>;
  getStoredReports(): ForensicReport[];
  getReportById(reportId: string): ForensicReport | undefined;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: ReportGeneratorConfig = {
  retentionDays: 90,
  generationTimeoutSeconds: 60,
  maxRetries: 3,
  retryIntervalSeconds: 10,
};

/**
 * Creates a report generator with the given Gemini function and optional configuration.
 */
export function createReportGenerator(
  geminiGenerate: GeminiGenerateFn,
  config: Partial<ReportGeneratorConfig> = {}
): ReportGenerator {
  const resolvedConfig: ReportGeneratorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const storedReports: ForensicReport[] = [];

  return {
    generate: (incident: IncidentData) =>
      generateReport(incident, geminiGenerate, resolvedConfig, storedReports),
    getStoredReports: () => [...storedReports],
    getReportById: (reportId: string) =>
      storedReports.find((r) => r.reportId === reportId),
  };
}

/**
 * Generates a forensic report for the given incident data.
 * Calls the Gemini function with retry logic (maxRetries at retryIntervalSeconds intervals).
 * Applies a generation timeout of generationTimeoutSeconds.
 */
async function generateReport(
  incident: IncidentData,
  geminiGenerate: GeminiGenerateFn,
  config: ReportGeneratorConfig,
  storedReports: ForensicReport[]
): Promise<ForensicReport> {
  const prompt = buildPrompt(incident);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await callWithTimeout(
        () => geminiGenerate(prompt),
        config.generationTimeoutSeconds * 1000
      );

      const report = parseResponseToReport(response, incident, config);
      storedReports.push(report);
      return report;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        await sleep(config.retryIntervalSeconds * 1000);
      }
    }
  }

  throw lastError!;
}

/**
 * Calls an async function with a timeout.
 * Rejects with a timeout error if the function does not resolve within the given time.
 */
function callWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Generation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Builds a prompt string from the incident data for the Gemini model.
 */
export function buildPrompt(incident: IncidentData): string {
  const { accessEvent, threatAssessment, responseActions } = incident;

  return [
    "Generate a forensic report for the following security incident:",
    "",
    "## Access Event",
    `- Event ID: ${accessEvent.eventId}`,
    `- Process ID: ${accessEvent.processId}`,
    `- Process Binary: ${accessEvent.processBinaryPath}`,
    `- User ID: ${accessEvent.userId}`,
    `- Pod ID: ${accessEvent.podId}`,
    `- Namespace: ${accessEvent.namespace}`,
    `- Honeytoken Path: ${accessEvent.honeytokenPath}`,
    `- Access Type: ${accessEvent.accessType}`,
    `- Timestamp: ${accessEvent.timestamp}`,
    "",
    "## Threat Assessment",
    `- Classification: ${threatAssessment.classification}`,
    `- Namespace Classification: ${threatAssessment.inputs.namespaceClassification}`,
    `- Service Criticality: ${threatAssessment.inputs.serviceCriticality}`,
    `- Anomaly Score: ${threatAssessment.inputs.davisAnomalyScore}`,
    `- Assessment Timestamp: ${threatAssessment.assessmentTimestamp}`,
    "",
    "## Response Actions",
    ...responseActions.map(
      (a) =>
        `- ${a.actionType} on ${a.target} at ${a.timestamp} → ${a.result}`
    ),
    "",
    "Provide: recommended follow-up actions, chronological timeline, and contextual assessment.",
  ].join("\n");
}

/**
 * Parses the Gemini response into a ForensicReport structure.
 * For now, generates a structured report directly from the incident data
 * (simulating Gemini output parsing).
 */
function parseResponseToReport(
  _response: string,
  incident: IncidentData,
  config: ReportGeneratorConfig
): ForensicReport {
  const { accessEvent, threatAssessment, responseActions } = incident;

  const timeline = buildTimeline(incident);
  const followUpActions = generateFollowUpActions(incident);

  return {
    reportId: uuidv4(),
    generationTimestamp: new Date().toISOString(),
    triggeringAccessEventId: accessEvent.eventId,
    retentionDays: config.retentionDays,

    accessEventDetails: {
      processId: accessEvent.processId,
      userId: accessEvent.userId,
      podId: accessEvent.podId,
      namespace: accessEvent.namespace,
      honeytokenPath: accessEvent.honeytokenPath,
      accessType: accessEvent.accessType,
      timestamp: accessEvent.timestamp,
    },

    contextualAssessment: {
      threatClassification: threatAssessment.classification,
      podCriticality: threatAssessment.inputs.serviceCriticality,
      anomalyScore: threatAssessment.inputs.davisAnomalyScore,
    },

    responseActions: responseActions.map((a) => ({
      actionType: a.actionType,
      target: a.target,
      timestamp: a.timestamp,
      result: a.result,
    })),

    timeline,
    recommendedFollowUpActions: followUpActions,
  };
}

/**
 * Builds a chronological timeline from the incident data.
 */
function buildTimeline(
  incident: IncidentData
): { eventDescription: string; timestamp: string }[] {
  const { accessEvent, threatAssessment, responseActions } = incident;

  const timeline: { eventDescription: string; timestamp: string }[] = [];

  // Initial access event
  timeline.push({
    eventDescription: `Honeytoken access detected: ${accessEvent.accessType} on ${accessEvent.honeytokenPath} by process ${accessEvent.processId}`,
    timestamp: accessEvent.timestamp,
  });

  // Threat assessment
  timeline.push({
    eventDescription: `Threat classified as ${threatAssessment.classification} (criticality: ${threatAssessment.inputs.serviceCriticality}, anomaly: ${threatAssessment.inputs.davisAnomalyScore})`,
    timestamp: threatAssessment.assessmentTimestamp,
  });

  // Response actions in chronological order
  const sortedActions = [...responseActions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const action of sortedActions) {
    timeline.push({
      eventDescription: `Response action: ${action.actionType} on ${action.target} - ${action.result}`,
      timestamp: action.timestamp,
    });
  }

  return timeline;
}

/**
 * Generates recommended follow-up actions based on the incident.
 * Always returns at least one recommendation.
 */
function generateFollowUpActions(incident: IncidentData): string[] {
  const { threatAssessment, responseActions } = incident;
  const actions: string[] = [];

  // Always recommend reviewing the incident
  actions.push(
    "Review incident details and validate threat classification accuracy"
  );

  if (
    threatAssessment.classification === "high" ||
    threatAssessment.classification === "critical"
  ) {
    actions.push(
      "Conduct full forensic analysis of the affected pod's filesystem and network connections"
    );
    actions.push(
      "Review access logs for lateral movement indicators in adjacent namespaces"
    );
  }

  if (threatAssessment.classification === "critical") {
    actions.push(
      "Initiate incident response team escalation for comprehensive investigation"
    );
  }

  // Check for failed response actions
  const failedActions = responseActions.filter((a) => a.result === "failure");
  if (failedActions.length > 0) {
    actions.push(
      `Investigate ${failedActions.length} failed response action(s) and apply manual remediation`
    );
  }

  return actions;
}

/**
 * Utility function to sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
