import { HighRiskService } from "../types/index";

/**
 * Ranks high-risk services by risk score in descending order.
 * Uses service name alphabetical order as a tiebreaker for equal risk scores.
 *
 * Validates: Requirements 1.4
 */
export function rankServices(services: HighRiskService[]): HighRiskService[] {
  return [...services].sort((a, b) => {
    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore;
    }
    return a.serviceName.localeCompare(b.serviceName);
  });
}
