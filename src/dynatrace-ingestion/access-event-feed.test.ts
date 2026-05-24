/**
 * Unit tests for the AccessEventFeed implementation.
 *
 * Validates: Requirements 9.3
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createAccessEventFeed, AccessEventFeed } from "./access-event-feed.js";
import { AccessEventLogPayload } from "../types/dynatrace-ingestion.js";

function makePayload(
  id: string,
  classification: AccessEventLogPayload["threatClassification"] = "low"
): AccessEventLogPayload {
  return {
    timestamp: `2024-01-01T00:00:${id.padStart(2, "0")}.000Z`,
    podId: `pod-${id}`,
    namespace: "default",
    processBinaryPath: "/usr/bin/cat",
    accessType: "read",
    threatClassification: classification,
  };
}

describe("AccessEventFeed", () => {
  let feed: AccessEventFeed;

  beforeEach(() => {
    feed = createAccessEventFeed(5);
  });

  describe("creation", () => {
    it("should create a feed with default capacity of 1000", () => {
      const defaultFeed = createAccessEventFeed();
      expect(defaultFeed.getSize()).toBe(0);
    });

    it("should create a feed with custom capacity", () => {
      const customFeed = createAccessEventFeed(50);
      expect(customFeed.getSize()).toBe(0);
    });

    it("should throw on invalid capacity (zero)", () => {
      expect(() => createAccessEventFeed(0)).toThrow();
    });

    it("should throw on invalid capacity (negative)", () => {
      expect(() => createAccessEventFeed(-1)).toThrow();
    });

    it("should throw on invalid capacity (non-integer)", () => {
      expect(() => createAccessEventFeed(3.5)).toThrow();
    });
  });

  describe("addEvent and getSize", () => {
    it("should start with size 0", () => {
      expect(feed.getSize()).toBe(0);
    });

    it("should increment size when adding events", () => {
      feed.addEvent(makePayload("1"));
      expect(feed.getSize()).toBe(1);

      feed.addEvent(makePayload("2"));
      expect(feed.getSize()).toBe(2);
    });

    it("should not exceed capacity", () => {
      for (let i = 0; i < 10; i++) {
        feed.addEvent(makePayload(String(i)));
      }
      expect(feed.getSize()).toBe(5);
    });
  });

  describe("getRecentEvents", () => {
    it("should return empty array when feed is empty", () => {
      expect(feed.getRecentEvents()).toEqual([]);
    });

    it("should return events in reverse chronological order (newest first)", () => {
      feed.addEvent(makePayload("1"));
      feed.addEvent(makePayload("2"));
      feed.addEvent(makePayload("3"));

      const events = feed.getRecentEvents();
      expect(events).toHaveLength(3);
      expect(events[0].podId).toBe("pod-3");
      expect(events[1].podId).toBe("pod-2");
      expect(events[2].podId).toBe("pod-1");
    });

    it("should limit results when count is specified", () => {
      feed.addEvent(makePayload("1"));
      feed.addEvent(makePayload("2"));
      feed.addEvent(makePayload("3"));

      const events = feed.getRecentEvents(2);
      expect(events).toHaveLength(2);
      expect(events[0].podId).toBe("pod-3");
      expect(events[1].podId).toBe("pod-2");
    });

    it("should return all events when count exceeds size", () => {
      feed.addEvent(makePayload("1"));
      feed.addEvent(makePayload("2"));

      const events = feed.getRecentEvents(10);
      expect(events).toHaveLength(2);
      expect(events[0].podId).toBe("pod-2");
      expect(events[1].podId).toBe("pod-1");
    });

    it("should return all events when count is not specified", () => {
      feed.addEvent(makePayload("1"));
      feed.addEvent(makePayload("2"));
      feed.addEvent(makePayload("3"));

      const events = feed.getRecentEvents();
      expect(events).toHaveLength(3);
    });
  });

  describe("FIFO eviction", () => {
    it("should discard oldest event when feed is full", () => {
      for (let i = 1; i <= 5; i++) {
        feed.addEvent(makePayload(String(i)));
      }

      // Add one more - should evict event 1
      feed.addEvent(makePayload("6"));

      const events = feed.getRecentEvents();
      expect(events).toHaveLength(5);
      // Newest first: 6, 5, 4, 3, 2
      expect(events[0].podId).toBe("pod-6");
      expect(events[4].podId).toBe("pod-2");
    });

    it("should maintain correct order after multiple overflows", () => {
      for (let i = 1; i <= 12; i++) {
        feed.addEvent(makePayload(String(i)));
      }

      const events = feed.getRecentEvents();
      expect(events).toHaveLength(5);
      // Should contain the 5 most recent in reverse order: 12, 11, 10, 9, 8
      expect(events[0].podId).toBe("pod-12");
      expect(events[1].podId).toBe("pod-11");
      expect(events[2].podId).toBe("pod-10");
      expect(events[3].podId).toBe("pod-9");
      expect(events[4].podId).toBe("pod-8");
    });

    it("should return correct limited results after overflow", () => {
      for (let i = 1; i <= 8; i++) {
        feed.addEvent(makePayload(String(i)));
      }

      const events = feed.getRecentEvents(3);
      expect(events).toHaveLength(3);
      // Most recent 3: 8, 7, 6
      expect(events[0].podId).toBe("pod-8");
      expect(events[1].podId).toBe("pod-7");
      expect(events[2].podId).toBe("pod-6");
    });
  });

  describe("threat classifications", () => {
    it("should preserve threat classification on events", () => {
      feed.addEvent(makePayload("1", "low"));
      feed.addEvent(makePayload("2", "medium"));
      feed.addEvent(makePayload("3", "high"));
      feed.addEvent(makePayload("4", "critical"));

      const events = feed.getRecentEvents();
      expect(events[0].threatClassification).toBe("critical");
      expect(events[1].threatClassification).toBe("high");
      expect(events[2].threatClassification).toBe("medium");
      expect(events[3].threatClassification).toBe("low");
    });
  });

  describe("default capacity (1000)", () => {
    it("should hold up to 1000 events without eviction", () => {
      const largeFeed = createAccessEventFeed();

      for (let i = 0; i < 1000; i++) {
        largeFeed.addEvent(makePayload(String(i)));
      }

      expect(largeFeed.getSize()).toBe(1000);
    });

    it("should evict at 1001 events", () => {
      const largeFeed = createAccessEventFeed();

      for (let i = 0; i < 1001; i++) {
        largeFeed.addEvent(makePayload(String(i)));
      }

      expect(largeFeed.getSize()).toBe(1000);
      // Most recent should be event 1000, oldest should be event 1
      const recent = largeFeed.getRecentEvents(1);
      expect(recent[0].podId).toBe("pod-1000");
    });
  });
});
