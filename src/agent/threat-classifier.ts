/**
 * Threat classification engine for the Ebeecontrol Agent.
 *
 * Classifies threats based on namespace classification, service criticality,
 * and Davis AI anomaly scores. Missing fields are substituted with highest-risk
 * defaults to ensure conservative classification.
 *
 * Validates: Requirements 4.3, 4.5, 4.6
 */

import { PodContext } from "../types/index";

/**
 * The threat classification level assigned to an access event.
 */
export type ThreatClassification = "low" | "medium" | "high" | "critical";

/**
 * A partial pod context where classification-relevant fields may be missing.
 * Missing fields are substituted with highest-risk defaults:
 * - namespaceClassification: "production"
 * - serviceCriticality: 5
 * - davisAnomalyScore: 1.0
 *
 * Validates: Requirements 4.6
 */
export type PartialPodContext = Partial<
  Pick<PodContext, "namespaceClassification" | "serviceCriticality" | "davisAnomalyScore">
>;

/**
 * Applies highest-risk defaults to any missing fields in a partial pod context.
 *
 * Default values (highest risk):
 * - namespaceClassification: "production"
 * - serviceCriticality: 5
 * - davisAnomalyScore: 1.0
 */
function applyDefaults(context: PartialPodContext): {
  namespaceClassification: "production" | "non-production";
  serviceCriticality: number;
  davisAnomalyScore: number;
} {
  return {
    namespaceClassification: context.namespaceClassification ?? "production",
    serviceCriticality: context.serviceCriticality ?? 5,
    davisAnomalyScore: context.davisAnomalyScore ?? 1.0,
  };
}

/**
 * Classifies the threat level based on a full PodContext.
 *
 * Classification rules (evaluated from highest to lowest severity):
 * - critical: production AND (anomaly > 0.8 OR criticality 5)
 * - high: production AND (anomaly 0.6-0.8 OR criticality 4)
 * - medium: production OR anomaly 0.3-0.6 OR criticality 3
 * - low: non-production AND anomaly < 0.3 AND criticality 1-2
 *
 * Validates: Requirements 4.3
 */
export function classifyThreat(context: PodContext): ThreatClassification {
  const { namespaceClassification, serviceCriticality, davisAnomalyScore } = context;
  return classifyFromInputs(namespaceClassification, serviceCriticality, davisAnomalyScore);
}

/**
 * Classifies the threat level from a partial context, substituting highest-risk
 * defaults for any missing fields.
 *
 * Validates: Requirements 4.5, 4.6
 */
export function classifyThreatWithDefaults(context: PartialPodContext): ThreatClassification {
  const resolved = applyDefaults(context);
  return classifyFromInputs(
    resolved.namespaceClassification,
    resolved.serviceCriticality,
    resolved.davisAnomalyScore
  );
}

/**
 * Core classification logic operating on resolved input values.
 *
 * The rules are evaluated from highest severity to lowest:
 * 1. critical: production AND (anomaly > 0.8 OR criticality 5)
 * 2. high: production AND (anomaly 0.6-0.8 OR criticality 4)
 * 3. medium: production OR anomaly 0.3-0.6 OR criticality 3
 * 4. low: non-production AND anomaly < 0.3 AND criticality 1-2
 *
 * If none of the above match exactly, the function still returns a valid
 * classification by falling through to the most appropriate level.
 */
function classifyFromInputs(
  namespaceClassification: "production" | "non-production",
  serviceCriticality: number,
  davisAnomalyScore: number
): ThreatClassification {
  const isProduction = namespaceClassification === "production";

  // Critical: production AND (anomaly > 0.8 OR criticality 5)
  if (isProduction && (davisAnomalyScore > 0.8 || serviceCriticality === 5)) {
    return "critical";
  }

  // High: production AND (anomaly 0.6-0.8 OR criticality 4)
  if (isProduction && (
    (davisAnomalyScore >= 0.6 && davisAnomalyScore <= 0.8) || serviceCriticality === 4
  )) {
    return "high";
  }

  // Medium: production OR anomaly 0.3-0.6 OR criticality 3
  if (
    isProduction ||
    (davisAnomalyScore >= 0.3 && davisAnomalyScore <= 0.6) ||
    serviceCriticality === 3
  ) {
    return "medium";
  }

  // Low: non-production AND anomaly < 0.3 AND criticality 1-2
  if (!isProduction && davisAnomalyScore < 0.3 && serviceCriticality <= 2) {
    return "low";
  }

  // Fallback for edge cases not explicitly covered by the rules
  // (e.g., non-production with anomaly > 0.6 and criticality 4-5)
  // These are conservatively classified as medium
  return "medium";
}
