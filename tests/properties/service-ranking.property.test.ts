import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { rankServices } from '../../src/utils/ranking';
import { HighRiskService } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 2: Service Ranking Order
 *
 * For any list of High_Risk_Service entries with risk scores and service names,
 * the ranking function SHALL produce an output where: (a) for any two adjacent
 * entries, the first has a risk score greater than or equal to the second, and
 * (b) for any two adjacent entries with equal risk scores, the first has a
 * service name that is lexicographically less than or equal to the second.
 *
 * Validates: Requirements 1.4
 */
describe('Feature: ebeecontrol, Property 2: Service Ranking Order', () => {
  const highRiskServiceArb = fc.record({
    serviceId: fc.uuid(),
    serviceName: fc.string({ minLength: 1 }),
    namespace: fc.string({ minLength: 1 }),
    podIdentifiers: fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
    riskScore: fc.integer({ min: 0, max: 100 }),
  }) as fc.Arbitrary<HighRiskService>;

  it('adjacent entries have descending risk scores (first >= second)', () => {
    fc.assert(
      fc.property(
        fc.array(highRiskServiceArb),
        (services) => {
          const ranked = rankServices(services);

          for (let i = 0; i < ranked.length - 1; i++) {
            expect(ranked[i].riskScore).toBeGreaterThanOrEqual(ranked[i + 1].riskScore);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('adjacent entries with equal risk scores are sorted by service name lexicographically (first <= second)', () => {
    fc.assert(
      fc.property(
        fc.array(highRiskServiceArb),
        (services) => {
          const ranked = rankServices(services);

          for (let i = 0; i < ranked.length - 1; i++) {
            if (ranked[i].riskScore === ranked[i + 1].riskScore) {
              expect(ranked[i].serviceName.localeCompare(ranked[i + 1].serviceName)).toBeLessThanOrEqual(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
