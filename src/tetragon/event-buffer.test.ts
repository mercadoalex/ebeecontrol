/**
 * Unit tests for the EventBuffer implementation.
 *
 * Validates: Requirements 3.5, 3.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createEventBuffer, EventBuffer } from "./event-buffer.js";
import { AccessEvent } from "../types/index.js";

function makeEvent(id: string, timestamp?: string): AccessEvent {
  return {
    eventId: id,
    processId: 1,
    processBinaryPath: "/usr/bin/cat",
    userId: 0,
    podId: "pod-1",
    namespace: "default",
    honeytokenPath: "/tmp/secret.txt",
    accessType: "read",
    timestamp: timestamp ?? new Date().toISOString(),
  };
}

describe("EventBuffer", () => {
  let buffer: EventBuffer;

  beforeEach(() => {
    buffer = createEventBuffer(5);
  });

  describe("creation", () => {
    it("should create a buffer with default capacity of 1000", () => {
      const defaultBuffer = createEventBuffer();
      expect(defaultBuffer.getSize()).toBe(0);
      expect(defaultBuffer.isFull()).toBe(false);
    });

    it("should create a buffer with custom capacity", () => {
      const customBuffer = createEventBuffer(50);
      expect(customBuffer.getSize()).toBe(0);
      expect(customBuffer.isFull()).toBe(false);
    });

    it("should throw on invalid capacity (zero)", () => {
      expect(() => createEventBuffer(0)).toThrow();
    });

    it("should throw on invalid capacity (negative)", () => {
      expect(() => createEventBuffer(-1)).toThrow();
    });

    it("should throw on invalid capacity (non-integer)", () => {
      expect(() => createEventBuffer(3.5)).toThrow();
    });
  });

  describe("add and getAll", () => {
    it("should add events and return them in insertion order", () => {
      const e1 = makeEvent("e1");
      const e2 = makeEvent("e2");
      const e3 = makeEvent("e3");

      buffer.add(e1);
      buffer.add(e2);
      buffer.add(e3);

      const all = buffer.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].eventId).toBe("e1");
      expect(all[1].eventId).toBe("e2");
      expect(all[2].eventId).toBe("e3");
    });

    it("should return an empty array when buffer is empty", () => {
      expect(buffer.getAll()).toEqual([]);
    });
  });

  describe("getSize", () => {
    it("should return 0 for empty buffer", () => {
      expect(buffer.getSize()).toBe(0);
    });

    it("should return correct size after adding events", () => {
      buffer.add(makeEvent("e1"));
      buffer.add(makeEvent("e2"));
      expect(buffer.getSize()).toBe(2);
    });

    it("should not exceed capacity", () => {
      for (let i = 0; i < 10; i++) {
        buffer.add(makeEvent(`e${i}`));
      }
      expect(buffer.getSize()).toBe(5);
    });
  });

  describe("FIFO eviction (overflow)", () => {
    it("should discard oldest event when buffer is full", () => {
      // Fill buffer (capacity 5)
      for (let i = 0; i < 5; i++) {
        buffer.add(makeEvent(`e${i}`));
      }
      expect(buffer.isFull()).toBe(true);

      // Add one more - should evict e0
      buffer.add(makeEvent("e5"));

      const all = buffer.getAll();
      expect(all).toHaveLength(5);
      expect(all[0].eventId).toBe("e1");
      expect(all[4].eventId).toBe("e5");
    });

    it("should maintain insertion order after multiple overflows", () => {
      // Fill buffer and overflow multiple times
      for (let i = 0; i < 12; i++) {
        buffer.add(makeEvent(`e${i}`));
      }

      const all = buffer.getAll();
      expect(all).toHaveLength(5);
      // Should contain the 5 most recent: e7, e8, e9, e10, e11
      expect(all[0].eventId).toBe("e7");
      expect(all[1].eventId).toBe("e8");
      expect(all[2].eventId).toBe("e9");
      expect(all[3].eventId).toBe("e10");
      expect(all[4].eventId).toBe("e11");
    });

    it("should contain exactly the N most recently added events after overflow", () => {
      // Add 8 events to a buffer of capacity 5
      for (let i = 0; i < 8; i++) {
        buffer.add(makeEvent(`e${i}`));
      }

      const all = buffer.getAll();
      expect(all).toHaveLength(5);
      // Most recent 5: e3, e4, e5, e6, e7
      expect(all.map((e) => e.eventId)).toEqual([
        "e3",
        "e4",
        "e5",
        "e6",
        "e7",
      ]);
    });
  });

  describe("getOverflowCount", () => {
    it("should return 0 when no overflow has occurred", () => {
      buffer.add(makeEvent("e1"));
      expect(buffer.getOverflowCount()).toBe(0);
    });

    it("should track number of discarded events", () => {
      // Fill buffer (capacity 5) then add 3 more
      for (let i = 0; i < 8; i++) {
        buffer.add(makeEvent(`e${i}`));
      }
      expect(buffer.getOverflowCount()).toBe(3);
    });

    it("should accumulate overflow count across multiple adds", () => {
      for (let i = 0; i < 15; i++) {
        buffer.add(makeEvent(`e${i}`));
      }
      // 15 events added, capacity 5, so 10 overflows
      expect(buffer.getOverflowCount()).toBe(10);
    });
  });

  describe("getOldestTimestamp", () => {
    it("should return undefined for empty buffer", () => {
      expect(buffer.getOldestTimestamp()).toBeUndefined();
    });

    it("should return the timestamp of the oldest event", () => {
      const ts = "2024-01-01T00:00:00.000Z";
      buffer.add(makeEvent("e1", ts));
      buffer.add(makeEvent("e2", "2024-01-02T00:00:00.000Z"));

      expect(buffer.getOldestTimestamp()).toBe(ts);
    });

    it("should update oldest timestamp after eviction", () => {
      const timestamps = [
        "2024-01-01T00:00:00.000Z",
        "2024-01-02T00:00:00.000Z",
        "2024-01-03T00:00:00.000Z",
        "2024-01-04T00:00:00.000Z",
        "2024-01-05T00:00:00.000Z",
      ];

      for (let i = 0; i < 5; i++) {
        buffer.add(makeEvent(`e${i}`, timestamps[i]));
      }

      // Oldest is the first one
      expect(buffer.getOldestTimestamp()).toBe("2024-01-01T00:00:00.000Z");

      // Add one more, evicting the oldest
      buffer.add(makeEvent("e5", "2024-01-06T00:00:00.000Z"));
      expect(buffer.getOldestTimestamp()).toBe("2024-01-02T00:00:00.000Z");
    });
  });

  describe("clear", () => {
    it("should reset buffer to empty state", () => {
      for (let i = 0; i < 8; i++) {
        buffer.add(makeEvent(`e${i}`));
      }

      buffer.clear();

      expect(buffer.getSize()).toBe(0);
      expect(buffer.getAll()).toEqual([]);
      expect(buffer.getOverflowCount()).toBe(0);
      expect(buffer.getOldestTimestamp()).toBeUndefined();
      expect(buffer.isFull()).toBe(false);
    });

    it("should allow adding events after clear", () => {
      for (let i = 0; i < 5; i++) {
        buffer.add(makeEvent(`e${i}`));
      }

      buffer.clear();
      buffer.add(makeEvent("new1"));

      expect(buffer.getSize()).toBe(1);
      expect(buffer.getAll()[0].eventId).toBe("new1");
    });
  });

  describe("isFull", () => {
    it("should return false when buffer is not at capacity", () => {
      buffer.add(makeEvent("e1"));
      expect(buffer.isFull()).toBe(false);
    });

    it("should return true when buffer is at capacity", () => {
      for (let i = 0; i < 5; i++) {
        buffer.add(makeEvent(`e${i}`));
      }
      expect(buffer.isFull()).toBe(true);
    });

    it("should remain true after overflow", () => {
      for (let i = 0; i < 7; i++) {
        buffer.add(makeEvent(`e${i}`));
      }
      expect(buffer.isFull()).toBe(true);
    });
  });

  describe("default capacity (1000)", () => {
    it("should hold up to 1000 events without overflow", () => {
      const largeBuffer = createEventBuffer();

      for (let i = 0; i < 1000; i++) {
        largeBuffer.add(makeEvent(`e${i}`));
      }

      expect(largeBuffer.getSize()).toBe(1000);
      expect(largeBuffer.isFull()).toBe(true);
      expect(largeBuffer.getOverflowCount()).toBe(0);
    });

    it("should overflow at 1001 events", () => {
      const largeBuffer = createEventBuffer();

      for (let i = 0; i < 1001; i++) {
        largeBuffer.add(makeEvent(`e${i}`));
      }

      expect(largeBuffer.getSize()).toBe(1000);
      expect(largeBuffer.getOverflowCount()).toBe(1);
      // First event should be e1 (e0 was evicted)
      const all = largeBuffer.getAll();
      expect(all[0].eventId).toBe("e1");
      expect(all[999].eventId).toBe("e1000");
    });
  });
});
