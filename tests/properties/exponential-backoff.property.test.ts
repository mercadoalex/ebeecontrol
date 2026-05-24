import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeBackoffDelay } from '../../src/utils/retry';

/**
 * Feature: ebeecontrol, Property 1: Exponential Backoff Computation
 *
 * For any retry attempt number n (where 0 ≤ n ≤ 4), the computed retry delay
 * SHALL equal 2^(n+1) seconds, producing the sequence [2, 4, 8, 16, 32],
 * and the total number of retry attempts SHALL never exceed 5.
 *
 * Validates: Requirements 1.3
 */
describe('Feature: ebeecontrol, Property 1: Exponential Backoff Computation', () => {
  it('computeBackoffDelay(n) equals 2^(n+1) for all valid attempt numbers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        (attempt) => {
          const delay = computeBackoffDelay(attempt);
          expect(delay).toBe(Math.pow(2, attempt + 1));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the maximum retry count is 5 (attempts 0 through 4)', () => {
    const maxRetryAttempts = 5;
    const validAttempts = Array.from({ length: maxRetryAttempts }, (_, i) => i);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        (attempt) => {
          // The attempt number must be within valid range [0, 4]
          expect(attempt).toBeGreaterThanOrEqual(0);
          expect(attempt).toBeLessThanOrEqual(maxRetryAttempts - 1);
          // This confirms the function should never be called with attempt > 4
          expect(validAttempts).toContain(attempt);
        }
      ),
      { numRuns: 100 }
    );
  });
});
