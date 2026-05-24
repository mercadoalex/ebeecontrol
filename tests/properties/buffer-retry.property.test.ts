import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { retryWithFixedInterval } from '../../src/utils/retry';

/**
 * Feature: ebeecontrol, Property 8: Event Buffer Retry Behavior
 *
 * For any sequence of forwarding failures for a buffered event, the Tetragon_Monitor
 * SHALL retry delivery at 10-second intervals, and the total retry count for any
 * single event SHALL never exceed 5.
 *
 * Validates: Requirements 3.5
 */
describe('Feature: ebeecontrol, Property 8: Event Buffer Retry Behavior', () => {
  it('retry function is called at most 5 times after the initial attempt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        async (numFailures) => {
          let attemptCount = 0;
          const maxRetries = 5;

          const operation = async (): Promise<string> => {
            attemptCount++;
            if (attemptCount <= numFailures) {
              throw new Error(`Failure #${attemptCount}`);
            }
            return 'success';
          };

          try {
            await retryWithFixedInterval({
              operation,
              maxRetries,
              intervalSeconds: 0,
            });
          } catch {
            // All retries exhausted - expected when numFailures > maxRetries + 1
          }

          // Total attempts = 1 initial + up to 5 retries = max 6
          expect(attemptCount).toBeLessThanOrEqual(maxRetries + 1);
          // Retries (attempts beyond the initial) should be at most 5
          const retryCount = attemptCount - 1;
          expect(retryCount).toBeLessThanOrEqual(maxRetries);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('total attempts never exceed 6 (1 initial + 5 retries)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        async (numFailures) => {
          let attemptCount = 0;
          const maxRetries = 5;

          const operation = async (): Promise<string> => {
            attemptCount++;
            if (attemptCount <= numFailures) {
              throw new Error(`Failure #${attemptCount}`);
            }
            return 'success';
          };

          try {
            await retryWithFixedInterval({
              operation,
              maxRetries,
              intervalSeconds: 0,
            });
          } catch {
            // All retries exhausted
          }

          // Total attempts must never exceed 6
          expect(attemptCount).toBeLessThanOrEqual(6);
          expect(attemptCount).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('succeeds on the correct attempt when failures are fewer than max retries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (numFailures) => {
          let attemptCount = 0;
          const maxRetries = 5;

          const operation = async (): Promise<string> => {
            attemptCount++;
            if (attemptCount <= numFailures) {
              throw new Error(`Failure #${attemptCount}`);
            }
            return 'success';
          };

          const result = await retryWithFixedInterval({
            operation,
            maxRetries,
            intervalSeconds: 0,
          });

          // Should succeed since numFailures <= maxRetries
          expect(result).toBe('success');
          // Should have taken exactly numFailures + 1 attempts
          expect(attemptCount).toBe(numFailures + 1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('throws after exhausting all retries when failures exceed max retries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 7, max: 10 }),
        async (numFailures) => {
          let attemptCount = 0;
          const maxRetries = 5;

          const operation = async (): Promise<string> => {
            attemptCount++;
            if (attemptCount <= numFailures) {
              throw new Error(`Failure #${attemptCount}`);
            }
            return 'success';
          };

          let threw = false;
          try {
            await retryWithFixedInterval({
              operation,
              maxRetries,
              intervalSeconds: 0,
            });
          } catch {
            threw = true;
          }

          // Should have thrown since numFailures > 6 (1 initial + 5 retries)
          expect(threw).toBe(true);
          // Should have attempted exactly 6 times (1 initial + 5 retries)
          expect(attemptCount).toBe(6);
        }
      ),
      { numRuns: 100 }
    );
  });
});
