/**
 * Event Buffer - Circular buffer for AccessEvent objects with bounded capacity.
 *
 * Implements FIFO eviction when the buffer reaches maximum capacity (default 1000).
 * Tracks overflow count for warning emission on next successful connection.
 *
 * Validates: Requirements 3.5, 3.6
 */

import { AccessEvent } from "../types/index.js";

const DEFAULT_MAX_CAPACITY = 1000;

/**
 * Interface for the bounded event buffer.
 */
export interface EventBuffer {
  /** Add an event to the buffer. If full, discards the oldest event (FIFO eviction). */
  add(event: AccessEvent): void;
  /** Returns all events in insertion order (oldest first). */
  getAll(): AccessEvent[];
  /** Returns the current number of events in the buffer. */
  getSize(): number;
  /** Returns the total number of events discarded due to overflow. */
  getOverflowCount(): number;
  /** Returns the timestamp of the oldest event in the buffer, or undefined if empty. */
  getOldestTimestamp(): string | undefined;
  /** Clears all events from the buffer and resets overflow count. */
  clear(): void;
  /** Returns true if the buffer is at maximum capacity. */
  isFull(): boolean;
}

/**
 * Creates a bounded event buffer with circular buffer semantics.
 *
 * @param maxCapacity - Maximum number of events the buffer can hold (default 1000).
 * @returns An EventBuffer instance.
 */
export function createEventBuffer(maxCapacity?: number): EventBuffer {
  const capacity = maxCapacity ?? DEFAULT_MAX_CAPACITY;

  if (capacity <= 0 || !Number.isInteger(capacity)) {
    throw new Error(
      `maxCapacity must be a positive integer, got: ${maxCapacity}`
    );
  }

  // Internal circular buffer storage
  const buffer: (AccessEvent | undefined)[] = new Array(capacity);
  let head = 0; // Index of the oldest element
  let size = 0; // Current number of elements
  let overflowCount = 0;

  return {
    add(event: AccessEvent): void {
      if (size < capacity) {
        // Buffer not full: insert at the next available position
        const insertIndex = (head + size) % capacity;
        buffer[insertIndex] = event;
        size++;
      } else {
        // Buffer full: overwrite the oldest event (at head) and advance head
        buffer[head] = event;
        head = (head + 1) % capacity;
        overflowCount++;
      }
    },

    getAll(): AccessEvent[] {
      const result: AccessEvent[] = [];
      for (let i = 0; i < size; i++) {
        const index = (head + i) % capacity;
        result.push(buffer[index] as AccessEvent);
      }
      return result;
    },

    getSize(): number {
      return size;
    },

    getOverflowCount(): number {
      return overflowCount;
    },

    getOldestTimestamp(): string | undefined {
      if (size === 0) {
        return undefined;
      }
      return (buffer[head] as AccessEvent).timestamp;
    },

    clear(): void {
      for (let i = 0; i < capacity; i++) {
        buffer[i] = undefined;
      }
      head = 0;
      size = 0;
      overflowCount = 0;
    },

    isFull(): boolean {
      return size === capacity;
    },
  };
}
