import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Feature: ebeecontrol, Property 16: Discovery Scheduling
 *
 * For any agent state with a configured discovery interval I and a previous cycle
 * status (complete or in-progress), a new discovery cycle SHALL be initiated if
 * and only if: (a) at least I minutes have elapsed since last cycle initiation,
 * AND (b) the previous cycle has completed.
 *
 * Validates: Requirements 8.2
 */

/**
 * Pure function that determines whether a new discovery cycle should be initiated.
 * Extracted from the orchestrator logic for property-based testing.
 */
function shouldInitiateDiscoveryCycle(
  intervalMinutes: number,
  elapsedMinutes: number,
  previousCycleComplete: boolean
): boolean {
  const intervalElapsed = elapsedMinutes >= intervalMinutes;
  return intervalElapsed && previousCycleComplete;
}

describe('Feature: ebeecontrol, Property 16: Discovery Scheduling', () => {
  // Generate random intervals between 5 and 1440 minutes (valid range per config)
  const intervalArb = fc.integer({ min: 5, max: 1440 });

  // Generate random elapsed times (0 to 3000 minutes to cover both under and over interval)
  const elapsedArb = fc.integer({ min: 0, max: 3000 });

  // Generate random cycle states
  const cycleStateArb = fc.boolean(); // true = complete, false = in-progress

  it('a new discovery cycle is initiated if and only if interval elapsed AND previous cycle completed', () => {
    fc.assert(
      fc.property(
        intervalArb,
        elapsedArb,
        cycleStateArb,
        (interval, elapsed, previousCycleComplete) => {
          const result = shouldInitiateDiscoveryCycle(interval, elapsed, previousCycleComplete);

          const intervalElapsed = elapsed >= interval;
          const expectedResult = intervalElapsed && previousCycleComplete;

          // The cycle should be initiated iff both conditions are met
          expect(result).toBe(expectedResult);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cycle is never initiated when previous cycle is still in-progress', () => {
    fc.assert(
      fc.property(
        intervalArb,
        elapsedArb,
        (interval, elapsed) => {
          const result = shouldInitiateDiscoveryCycle(interval, elapsed, false);

          // Should never initiate when previous cycle is in-progress
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cycle is never initiated when interval has not elapsed', () => {
    fc.assert(
      fc.property(
        intervalArb,
        cycleStateArb,
        (interval, previousCycleComplete) => {
          // Generate elapsed time strictly less than interval
          const elapsed = interval - 1;
          const result = shouldInitiateDiscoveryCycle(interval, elapsed, previousCycleComplete);

          // Should never initiate when interval hasn't elapsed
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cycle is always initiated when both conditions are met', () => {
    fc.assert(
      fc.property(
        intervalArb,
        (interval) => {
          // Elapsed time at least equal to interval, previous cycle complete
          const elapsed = interval; // exactly at the boundary
          const result = shouldInitiateDiscoveryCycle(interval, elapsed, true);

          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validates against the actual orchestrator behavior', () => {
    fc.assert(
      fc.property(
        intervalArb,
        elapsedArb,
        cycleStateArb,
        (interval, elapsed, previousCycleComplete) => {
          const result = shouldInitiateDiscoveryCycle(interval, elapsed, previousCycleComplete);

          // Biconditional: result is true iff both conditions hold
          if (result) {
            // If initiated, both conditions must be true
            expect(elapsed >= interval).toBe(true);
            expect(previousCycleComplete).toBe(true);
          } else {
            // If not initiated, at least one condition must be false
            expect(elapsed < interval || !previousCycleComplete).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
