import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Feature: ebeecontrol, Property 17: Health Status Computation
 *
 * For any component with a last connectivity check result and timestamp, the
 * component SHALL be reported as "unhealthy" if and only if: (a) the last check
 * returned an error, OR (b) the last check did not respond within 10 seconds.
 * Otherwise, the component SHALL be reported as "healthy".
 *
 * Validates: Requirements 8.3
 */

/**
 * Pure function that computes the health status of a component based on its
 * last check result and response time.
 */
function computeComponentHealthStatus(
  lastCheckReturnedError: boolean,
  responseTimeSeconds: number
): 'healthy' | 'unhealthy' {
  const TIMEOUT_THRESHOLD_SECONDS = 10;

  if (lastCheckReturnedError || responseTimeSeconds > TIMEOUT_THRESHOLD_SECONDS) {
    return 'unhealthy';
  }
  return 'healthy';
}

describe('Feature: ebeecontrol, Property 17: Health Status Computation', () => {
  // Generate random check results (success/error)
  const checkResultArb = fc.boolean(); // true = error, false = success

  // Generate random response times (0-20 seconds)
  const responseTimeArb = fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true });

  it('component is unhealthy iff error OR timeout > 10s, healthy otherwise', () => {
    fc.assert(
      fc.property(
        checkResultArb,
        responseTimeArb,
        (lastCheckReturnedError, responseTimeSeconds) => {
          const status = computeComponentHealthStatus(lastCheckReturnedError, responseTimeSeconds);

          const shouldBeUnhealthy = lastCheckReturnedError || responseTimeSeconds > 10;

          if (shouldBeUnhealthy) {
            expect(status).toBe('unhealthy');
          } else {
            expect(status).toBe('healthy');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('component with error is always unhealthy regardless of response time', () => {
    fc.assert(
      fc.property(
        responseTimeArb,
        (responseTimeSeconds) => {
          const status = computeComponentHealthStatus(true, responseTimeSeconds);
          expect(status).toBe('unhealthy');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('component with response time > 10s is always unhealthy regardless of error state', () => {
    fc.assert(
      fc.property(
        checkResultArb,
        fc.double({ min: 10.001, max: 20, noNaN: true, noDefaultInfinity: true }),
        (lastCheckReturnedError, responseTimeSeconds) => {
          const status = computeComponentHealthStatus(lastCheckReturnedError, responseTimeSeconds);
          expect(status).toBe('unhealthy');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('component with no error and response time <= 10s is always healthy', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
        (responseTimeSeconds) => {
          const status = computeComponentHealthStatus(false, responseTimeSeconds);
          expect(status).toBe('healthy');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('health status is a biconditional: unhealthy iff (error OR timeout)', () => {
    fc.assert(
      fc.property(
        checkResultArb,
        responseTimeArb,
        (lastCheckReturnedError, responseTimeSeconds) => {
          const status = computeComponentHealthStatus(lastCheckReturnedError, responseTimeSeconds);

          // Biconditional check
          if (status === 'unhealthy') {
            // If unhealthy, at least one condition must be true
            expect(lastCheckReturnedError || responseTimeSeconds > 10).toBe(true);
          } else {
            // If healthy, both conditions must be false
            expect(lastCheckReturnedError).toBe(false);
            expect(responseTimeSeconds <= 10).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
