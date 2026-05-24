/**
 * Access Event Feed - Bounded in-memory feed for the most recent access events.
 *
 * Maintains up to 1000 access events with their threat classifications,
 * using a circular buffer pattern for FIFO eviction. Provides the ingestion
 * layer with a window of recent events to push to Dynatrace Log Ingestion API.
 *
 * Validates: Requirements 9.3
 */

import { AccessEventLogPayload } from "../types/dynatrace-ingestion.js";

const DEFAULT_MAX_CAPACITY = 1000;

/**
 * Interface for the access event feed.
 */
export interface AccessEventFeed {
  /** Add an event to the feed. If full, discards the oldest event (FIFO eviction). */
  addEvent(event: AccessEventLogPayload): void;
  /** Returns recent events in reverse chronological order (newest first). */
  getRecentEvents(count?: number): AccessEventLogPayload[];
  /** Returns the current number of events in the feed. */
  getSize(): number;
}

/**
 * Creates a bounded access event feed with circular buffer semantics.
 *
 * @param maxCapacity - Maximum number of events the feed can hold (default 1000).
 * @returns An AccessEventFeed instance.
 */
export function createAccessEventFeed(maxCapacity?: number): AccessEventFeed {
  const capacity = maxCapacity ?? DEFAULT_MAX_CAPACITY;

  if (capacity <= 0 || !Number.isInteger(capacity)) {
    throw new Error(
      `maxCapacity must be a positive integer, got: ${maxCapacity}`
    );
  }

  // Internal circular buffer storage
  const buffer: (AccessEventLogPayload | undefined)[] = new Array(capacity);
  let head = 0; // Index of the oldest element
  let size = 0; // Current number of elements

  return {
    addEvent(event: AccessEventLogPayload): void {
      if (size < capacity) {
        // Buffer not full: insert at the next available position
        const insertIndex = (head + size) % capacity;
        buffer[insertIndex] = event;
        size++;
      } else {
        // Buffer full: overwrite the oldest event (at head) and advance head
        buffer[head] = event;
        head = (head + 1) % capacity;
      }
    },

    getRecentEvents(count?: number): AccessEventLogPayload[] {
      const limit = count !== undefined ? Math.min(count, size) : size;
      const result: AccessEventLogPayload[] = [];

      // Iterate from newest to oldest
      for (let i = 0; i < limit; i++) {
        const index = (head + size - 1 - i) % capacity;
        result.push(buffer[index] as AccessEventLogPayload);
      }

      return result;
    },

    getSize(): number {
      return size;
    },
  };
}
