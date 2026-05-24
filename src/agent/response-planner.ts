/**
 * Response plan generator for the Ebeecontrol Agent.
 *
 * Generates response plans based on threat classification:
 * - low: no response actions (empty actions array)
 * - medium: deploy at least 2 additional honeytokens in same namespace
 * - high: pod isolation + IP block + deploy at least 2 additional honeytokens
 * - critical: pod isolation + IP block + deploy at least 2 additional honeytokens
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */

import { ThreatAssessment } from "../types/index";
import { ThreatClassification } from "./threat-classifier";

/**
 * A planned response action to be executed by the agent.
 */
export interface PlannedAction {
  actionType: "pod_isolation" | "ip_block" | "additional_honeytokens";
  target: string;
  priority: number; // lower = higher priority
}

/**
 * A complete response plan generated from a threat assessment.
 */
export interface ResponsePlan {
  assessmentId: string;
  classification: ThreatClassification;
  namespace: string;
  podId: string;
  actions: PlannedAction[];
}

/**
 * Context needed to generate a response plan that isn't in the ThreatAssessment itself.
 */
export interface ResponseContext {
  namespace: string;
  podId: string;
}

/**
 * Generates a response plan based on the given threat assessment.
 *
 * Rules:
 * - low: no response actions (empty actions array)
 * - medium: deploy at least 2 additional honeytokens in same namespace
 * - high: pod isolation + IP block + deploy at least 2 additional honeytokens
 * - critical: pod isolation + IP block + deploy at least 2 additional honeytokens
 *
 * Priority ordering (lower number = higher priority):
 * 1. Pod isolation (most urgent containment)
 * 2. IP block (prevent further access)
 * 3. Additional honeytokens (expand detection surface)
 */
export function generateResponsePlan(
  assessment: ThreatAssessment,
  context?: ResponseContext
): ResponsePlan {
  const { assessmentId, classification } = assessment;
  const namespace = context?.namespace ?? "";
  const podId = context?.podId ?? "";

  const actions = buildActions(classification, namespace, podId);

  return {
    assessmentId,
    classification,
    namespace,
    podId,
    actions,
  };
}

/**
 * Builds the list of planned actions based on threat classification.
 */
function buildActions(
  classification: ThreatClassification,
  namespace: string,
  podId: string
): PlannedAction[] {
  if (classification === "low") {
    return [];
  }

  const actions: PlannedAction[] = [];

  // For high and critical: include pod isolation and IP block
  if (classification === "high" || classification === "critical") {
    actions.push({
      actionType: "pod_isolation",
      target: podId,
      priority: 1,
    });

    actions.push({
      actionType: "ip_block",
      target: podId,
      priority: 2,
    });
  }

  // For medium, high, and critical: deploy at least 2 additional honeytokens
  actions.push({
    actionType: "additional_honeytokens",
    target: namespace,
    priority: classification === "medium" ? 1 : 3,
  });

  return actions;
}
