/**
 * Threat Assessment Workflow for the Ebeecontrol Agent.
 *
 * Orchestrates the threat assessment process:
 * 1. Receives an access event
 * 2. Queries Dynatrace for pod context (3s timeout, returns null on timeout)
 * 3. Classifies threat using context or defaults to high on timeout
 * 4. Returns a ThreatAssessment with UUID, classification, inputs, timestamp, and latency
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5
 */

import { v4 as uuidv4 } from "uuid";
import { AccessEvent, PodContext, ThreatAssessment } from "../types/index";
import { ThreatClassification } from "./threat-classifier";

/**
 * Interface for the Dynatrace pod context query dependency.
 */
export interface PodContextProvider {
  getPodContext(podId: string, namespace: string): Promise<PodContext | null>;
}

/**
 * Dependencies injected into the threat assessment workflow.
 */
export interface ThreatAssessmentDependencies {
  podContextProvider: PodContextProvider;
  classifyThreat: (context: PodContext) => ThreatClassification;
  classifyThreatWithDefaults: (context: Partial<Pick<PodContext, "namespaceClassification" | "serviceCriticality" | "davisAnomalyScore">>) => ThreatClassification;
  generateId?: () => string;
  now?: () => Date;
}

/**
 * Default inputs used when pod context is unavailable (timeout or error).
 * These represent the highest-risk defaults per requirement 4.5.
 */
const HIGH_RISK_DEFAULTS = {
  namespaceClassification: "production" as const,
  serviceCriticality: 5,
  davisAnomalyScore: 1.0,
};

/**
 * Creates a threat assessment workflow function.
 *
 * The workflow:
 * 1. Records the start time for latency tracking
 * 2. Queries Dynatrace for pod context (3s timeout built into the client)
 * 3. If context is null (timeout/error): classifies using highest-risk defaults
 * 4. If context is present: classifies using the actual context
 * 5. Returns a ThreatAssessment with UUID, classification, inputs, timestamp, and latency
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5
 */
export function createThreatAssessmentWorkflow(
  dependencies: ThreatAssessmentDependencies
) {
  const {
    podContextProvider,
    classifyThreat,
    classifyThreatWithDefaults,
    generateId = uuidv4,
    now = () => new Date(),
  } = dependencies;

  /**
   * Assesses the threat level of an access event.
   *
   * - Queries Dynatrace for pod context (3s timeout, returns null on timeout)
   * - If context is null: uses classifyThreatWithDefaults({}) which defaults to high
   * - If context is present: uses classifyThreat(context)
   * - Tracks assessment latency (time from event receipt to classification complete)
   * - Must complete within 5 seconds of receiving the event (requirement 4.4)
   */
  async function assessThreat(event: AccessEvent): Promise<ThreatAssessment> {
    const startTime = now();

    // Query Dynatrace for pod context (3s timeout built into the client, returns null on timeout)
    const podContext = await podContextProvider.getPodContext(
      event.podId,
      event.namespace
    );

    let classification: ThreatClassification;
    let inputs: ThreatAssessment["inputs"];

    if (podContext === null) {
      // Context unavailable (timeout or error): default to high classification
      classification = classifyThreatWithDefaults({});
      inputs = HIGH_RISK_DEFAULTS;
    } else {
      // Context available: classify using actual pod context
      classification = classifyThreat(podContext);
      inputs = {
        namespaceClassification: podContext.namespaceClassification,
        serviceCriticality: podContext.serviceCriticality,
        davisAnomalyScore: podContext.davisAnomalyScore,
      };
    }

    const endTime = now();
    const assessmentLatencyMs = endTime.getTime() - startTime.getTime();

    return {
      assessmentId: generateId(),
      accessEventId: event.eventId,
      classification,
      inputs,
      assessmentTimestamp: endTime.toISOString(),
      assessmentLatencyMs,
    };
  }

  return { assessThreat };
}
