/**
 * Dynatrace ingestion types for pushing metrics and structured logs
 * to Dynatrace APIs (Metrics API v2 and Log Ingestion API).
 *
 * These types define the payloads sent by the Ebeecontrol Agent to Dynatrace,
 * enabling the native Dynatrace Dashboard to visualize system state, threat
 * detections, response outcomes, and operational health.
 */

// --- Metric Payloads (Dynatrace Metrics API v2) ---

/**
 * Metric payload for honeytoken registry state.
 * Pushed when a honeytoken status changes in the registry.
 *
 * Validates: Requirements 9.1
 */
export interface HoneytokenRegistryMetricPayload {
  honeytokenId: string;
  podId: string;
  namespace: string;
  type: "decoy_secret" | "decoy_file" | "decoy_credential";
  deploymentTimestamp: string; // ISO 8601
  status: "active" | "triggered" | "expired";
}

/**
 * Metric payload for component health status.
 * Pushed when a component health status changes.
 *
 * Validates: Requirements 9.7
 */
export interface ComponentHealthMetricPayload {
  componentName: "Tetragon_Monitor" | "Koney_Deployer" | "Dynatrace_MCP_Server" | "Vertex_AI_Trainer";
  status: "healthy" | "unhealthy" | "degraded";
  lastSuccessfulCheckTimestamp: string; // ISO 8601
}

/**
 * Metric payload for adaptive learning metrics.
 * Pushed when the Vertex AI Trainer completes a retraining cycle or updates the model.
 *
 * Validates: Requirements 9.11
 */
export interface LearningMetricPayload {
  modelVersionId: string;
  validationAccuracy: number; // percentage
  trainingDatasetSize: number;
  trainingStatus: "idle" | "training" | "failed";
}

// --- Log Payloads (Dynatrace Log Ingestion API) ---

/**
 * Log payload for honeytoken access events.
 * Pushed when the Tetragon Monitor generates a new access event.
 *
 * Validates: Requirements 9.3
 */
export interface AccessEventLogPayload {
  timestamp: string; // ISO 8601
  podId: string;
  namespace: string;
  processBinaryPath: string;
  accessType: "open" | "read" | "write" | "stat";
  threatClassification: "low" | "medium" | "high" | "critical";
}

/**
 * Log payload for threat response actions.
 * Pushed when the agent initiates a response action and updated upon completion.
 *
 * Validates: Requirements 9.5
 */
export interface ResponseActionLogPayload {
  actionId: string;
  actionType: "pod_isolation" | "ip_block" | "additional_honeytokens";
  target: string;
  triggeringClassification: "low" | "medium" | "high" | "critical";
  timestamp: string; // ISO 8601
  outcome: "success" | "failure" | "pending";
}

/**
 * Log payload for forensic report metadata.
 * Pushed when a new forensic report is generated.
 *
 * Validates: Requirements 9.9
 */
export interface ForensicReportLogPayload {
  reportId: string;
  generationTimestamp: string; // ISO 8601
  threatClassification: "low" | "medium" | "high" | "critical";
  affectedPodId: string;
  namespace: string;
  reportContent: string; // full report serialized as JSON
  gistUrl?: string; // URL to the full Gemini report published as a GitHub Gist
}

/**
 * Log payload for incident timeline entries.
 * Pushed for each threat detection and response sequence.
 *
 * Validates: Requirements 9.13
 */
export interface IncidentTimelineLogPayload {
  incidentId: string;
  timestamp: string; // ISO 8601
  threatClassification: "low" | "medium" | "high" | "critical";
  affectedPodId: string;
  namespace: string;
  responseActions: {
    actionType: string;
    outcome: "success" | "failure";
  }[];
  finalOutcome: "contained" | "escalated" | "false_positive";
}

// --- Ingestion Infrastructure Types ---

/**
 * Status of the local ingestion buffer used when Dynatrace APIs are unavailable.
 * Data is buffered locally and retried with exponential backoff.
 *
 * Validates: Requirements 9.16
 */
export interface IngestionBufferStatus {
  bufferedItemCount: number;
  oldestBufferedTimestamp?: string; // ISO 8601
  retryInProgressCount: number;
  totalDiscardedCount: number;
}

/**
 * Tracks the retry state for a single buffered ingestion item.
 * After 5 failed retries, the item is discarded.
 *
 * Validates: Requirements 9.16, 9.17
 */
export interface IngestionRetryState {
  itemId: string;
  payload:
    | HoneytokenRegistryMetricPayload
    | ComponentHealthMetricPayload
    | LearningMetricPayload
    | AccessEventLogPayload
    | ResponseActionLogPayload
    | ForensicReportLogPayload
    | IncidentTimelineLogPayload;
  targetApi: "metrics" | "logs";
  firstAttemptTimestamp: string; // ISO 8601
  attemptCount: number; // 0-5
  nextRetryTimestamp: string; // ISO 8601
  lastErrorMessage?: string;
}
