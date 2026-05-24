import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createEventBuffer } from '../../src/tetragon/event-buffer';
import { AccessEvent } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 9: Bounded Buffer Overflow
 *
 * For any sequence of N events added to a full buffer (capacity 1000), the buffer
 * SHALL contain exactly 1000 events, and those events SHALL be the N most recently
 * added events (oldest events discarded first). The buffer size SHALL never exceed 1000.
 *
 * Validates: Requirements 3.6
 */
describe('Feature: ebeecontrol, Property 9: Bounded Buffer Overflow', () => {
  const accessTypes = ['open', 'read', 'write', 'stat'] as const;

  const eventArb: fc.Arbitrary<AccessEvent> = fc.record({
    eventId: fc.uuid(),
    processId: fc.integer({ min: 1, max: 65535 }),
    processBinaryPath: fc.string({ minLength: 1 }),
    userId: fc.integer({ min: 0, max: 65535 }),
    podId: fc.string({ minLength: 1 }),
    namespace: fc.string({ minLength: 1 }),
    honeytokenPath: fc.string({ minLength: 1 }),
    accessType: fc.constantFrom(...accessTypes),
    timestamp: fc.date().map((d) => d.toISOString()),
  });

  it('buffer size never exceeds capacity after overflow', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }).chain((capacity) =>
          fc.tuple(
            fc.constant(capacity),
            fc.array(eventArb, { minLength: capacity + 1, maxLength: capacity * 5 })
          )
        ),
        ([capacity, events]) => {
          const buffer = createEventBuffer(capacity);

          for (const event of events) {
            buffer.add(event);
            expect(buffer.getSize()).toBeLessThanOrEqual(capacity);
          }

          expect(buffer.getSize()).toBe(capacity);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('buffer contains exactly the most recent capacity events', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }).chain((capacity) =>
          fc.tuple(
            fc.constant(capacity),
            fc.array(eventArb, { minLength: capacity + 1, maxLength: capacity * 5 })
          )
        ),
        ([capacity, events]) => {
          const buffer = createEventBuffer(capacity);

          for (const event of events) {
            buffer.add(event);
          }

          const bufferedEvents = buffer.getAll();
          const expectedEvents = events.slice(events.length - capacity);

          expect(bufferedEvents).toHaveLength(capacity);
          expect(bufferedEvents).toEqual(expectedEvents);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('events are in insertion order (oldest first)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }).chain((capacity) =>
          fc.tuple(
            fc.constant(capacity),
            fc.array(eventArb, { minLength: capacity + 1, maxLength: capacity * 5 })
          )
        ),
        ([capacity, events]) => {
          const buffer = createEventBuffer(capacity);

          for (const event of events) {
            buffer.add(event);
          }

          const bufferedEvents = buffer.getAll();
          const expectedEvents = events.slice(events.length - capacity);

          // Verify order matches insertion order (oldest retained event first)
          for (let i = 0; i < bufferedEvents.length; i++) {
            expect(bufferedEvents[i].eventId).toBe(expectedEvents[i].eventId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
