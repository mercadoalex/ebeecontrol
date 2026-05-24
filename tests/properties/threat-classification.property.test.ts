import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyThreat } from '../../src/agent/threat-classifier';
import { PodContext } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 10: Threat Classification Correctness
 *
 * For any valid combination of namespace classification (production/non-production),
 * service criticality (1-5), and anomaly score (0.0-1.0), the threat classification
 * function SHALL return exactly one of {low, medium, high, critical} according to
 * the defined rules:
 * - low: non-production AND anomaly < 0.3 AND criticality <= 2
 * - critical: production AND (anomaly > 0.8 OR criticality === 5)
 * - high: production AND (anomaly >= 0.6 && anomaly <= 0.8 OR criticality === 4)
 * - medium: everything else
 *
 * Validates: Requirements 4.3, 4.6
 */
describe('Feature: ebeecontrol, Property 10: Threat Classification Correctness', () => {
  const namespaceClassificationArb = fc.constantFrom("production" as const, "non-production" as const);
  const serviceCriticalityArb = fc.integer({ min: 1, max: 5 });
  const davisAnomalyScoreArb = fc.double({ min: 0, max: 1, noNaN: true });

  const podContextArb = fc.tuple(
    namespaceClassificationArb,
    serviceCriticalityArb,
    davisAnomalyScoreArb
  ).map(([namespaceClassification, serviceCriticality, davisAnomalyScore]) => ({
    namespace: "test-namespace",
    namespaceClassification,
    serviceCriticality,
    davisAnomalyScore,
    anomalyWindowMinutes: 10 as const,
  } satisfies PodContext));

  it('always returns exactly one of {low, medium, high, critical}', () => {
    fc.assert(
      fc.property(
        podContextArb,
        (context) => {
          const result = classifyThreat(context);
          expect(["low", "medium", "high", "critical"]).toContain(result);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "low" when non-production AND anomaly < 0.3 AND criticality <= 2', () => {
    const lowContextArb = fc.tuple(
      fc.constant("non-production" as const),
      fc.integer({ min: 1, max: 2 }),
      fc.double({ min: 0, max: 0.29999, noNaN: true })
    ).map(([namespaceClassification, serviceCriticality, davisAnomalyScore]) => ({
      namespace: "test-namespace",
      namespaceClassification,
      serviceCriticality,
      davisAnomalyScore,
      anomalyWindowMinutes: 10 as const,
    } satisfies PodContext));

    fc.assert(
      fc.property(
        lowContextArb,
        (context) => {
          const result = classifyThreat(context);
          expect(result).toBe("low");
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "critical" when production AND (anomaly > 0.8 OR criticality === 5)', () => {
    const criticalContextArb = fc.tuple(
      fc.constant("production" as const),
      fc.integer({ min: 1, max: 5 }),
      fc.double({ min: 0, max: 1, noNaN: true })
    ).filter(([_, criticality, anomaly]) =>
      anomaly > 0.8 || criticality === 5
    ).map(([namespaceClassification, serviceCriticality, davisAnomalyScore]) => ({
      namespace: "test-namespace",
      namespaceClassification,
      serviceCriticality,
      davisAnomalyScore,
      anomalyWindowMinutes: 10 as const,
    } satisfies PodContext));

    fc.assert(
      fc.property(
        criticalContextArb,
        (context) => {
          const result = classifyThreat(context);
          expect(result).toBe("critical");
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "high" when production AND (anomaly >= 0.6 && anomaly <= 0.8 OR criticality === 4) AND NOT critical', () => {
    const highContextArb = fc.tuple(
      fc.constant("production" as const),
      fc.integer({ min: 1, max: 4 }),
      fc.double({ min: 0, max: 0.8, noNaN: true })
    ).filter(([_, criticality, anomaly]) =>
      // Must match high conditions
      ((anomaly >= 0.6 && anomaly <= 0.8) || criticality === 4) &&
      // Must NOT match critical conditions
      !(anomaly > 0.8 || criticality === 5)
    ).map(([namespaceClassification, serviceCriticality, davisAnomalyScore]) => ({
      namespace: "test-namespace",
      namespaceClassification,
      serviceCriticality,
      davisAnomalyScore,
      anomalyWindowMinutes: 10 as const,
    } satisfies PodContext));

    fc.assert(
      fc.property(
        highContextArb,
        (context) => {
          const result = classifyThreat(context);
          expect(result).toBe("high");
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "medium" for everything else (not low, not high, not critical)', () => {
    fc.assert(
      fc.property(
        podContextArb,
        (context) => {
          const { namespaceClassification, serviceCriticality, davisAnomalyScore } = context;
          const isProduction = namespaceClassification === "production";

          const isLow = !isProduction && davisAnomalyScore < 0.3 && serviceCriticality <= 2;
          const isCritical = isProduction && (davisAnomalyScore > 0.8 || serviceCriticality === 5);
          const isHigh = isProduction &&
            ((davisAnomalyScore >= 0.6 && davisAnomalyScore <= 0.8) || serviceCriticality === 4) &&
            !isCritical;

          const result = classifyThreat(context);

          if (isLow) {
            expect(result).toBe("low");
          } else if (isCritical) {
            expect(result).toBe("critical");
          } else if (isHigh) {
            expect(result).toBe("high");
          } else {
            expect(result).toBe("medium");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
