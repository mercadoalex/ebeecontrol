import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createAccessEventFeed } from '../../src/dynatrace-ingestion/access-event-feed';
import { AccessEventLogPayload } from '../../src/types/dynatrace-ingestion';

/**
 * Feature: ebeecontrol, Property 19: Access Event Feed Bounded Capacity and Ordering
 *
 * For any sequence of N access events added to the feed, the feed SHALL contain at most
 * 1000 events, those events SHALL be in reverse chronological order (most recent first),
 * and when N > 1000 the feed SHALL contain exactly the 1000 most recently added events.
 *
 * Uses smaller capacity (10-50) for practical testing.
 *
 * Validates: Requirements 9.3
 */
describe('Feature: ebeecontrol, Property 19: Access Event Feed Bounded Capacity and Ordering', () => {
  const accessTypes = ['open', 'read', 'write', 'stat'] as const;
  const classifications = ['low', 'medium', 'high', 'critical'] as const;

  const accessEventPayloadArb: fc.Arbitrary<AccessEventLogPayload> = fc.record({
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
    podId: fc.stringMatching(/^pod-[a-z0-9]{3,10}$/),
    namespace: fc.stringMatching(/^[a-z][a-z0-9-]{2,15}$/),
    processBinaryPath: fc.stringMatching(/^\/[a-z][a-z0-9/]{1,20}$/),
    accessType: fc.constantFrom(...accessTypes),
    threatClassification: fc.constantFrom(...classifications),
  });

  it('feed size never exceeds capacity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 50 }).chain((capacity) =>
          fc.tuple(
            fc.constant(capacity),
            fc.array(accessEventPayloadArb, { minLength: 1, maxLength: capacity * 5 })
          )
        ),
        ([capacity, events]) => {
          const feed = createAccessEventFeed(capacity);

          for (const event of events) {
            feed.addEvent(event);
            expect(feed.getSize()).toBeLessThanOrEqual(capacity);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('getRecentEvents returns events in reverse chronological order (newest first)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 50 }).chain((capacity) =>
          fc.tuple(
            fc.constant(capacity),
            fc.array(accessEventPayloadArb, { minLength: 2, maxLength: capacity * 3 })
          )
        ),
        ([capacity, events]) => {
          const feed = createAccessEventFeed(capacity);

          for (const event of events) {
            feed.addEvent(event);
          }

          const recentEvents = feed.getRecentEvents();

          // The most recently added event should be first
          expect(recentEvents[0]).toEqual(events[events.length - 1]);

          // Events should be in reverse insertion order (newest first)
          for (let i = 0; i < recentEvents.length - 1; i++) {
            const currentIdx = events.lastIndexOf(recentEvents[i]);
            const nextIdx = events.lastIndexOf(recentEvents[i + 1]);
            expect(currentIdx).toBeGreaterThan(nextIdx);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('when N > capacity, feed contains exactly the most recently added events', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 50 }).chain((capacity) =>
          fc.tuple(
            fc.constant(capacity),
            fc.array(accessEventPayloadArb, { minLength: capacity + 1, maxLength: capacity * 5 })
          )
        ),
        ([capacity, events]) => {
          const feed = createAccessEventFeed(capacity);

          for (const event of events) {
            feed.addEvent(event);
          }

          // Feed should contain exactly capacity events
          expect(feed.getSize()).toBe(capacity);

          const recentEvents = feed.getRecentEvents();
          expect(recentEvents).toHaveLength(capacity);

          // Should contain the most recent `capacity` events in reverse order
          const expectedEvents = events.slice(events.length - capacity).reverse();
          expect(recentEvents).toEqual(expectedEvents);
        }
      ),
      { numRuns: 100 }
    );
  });
});
