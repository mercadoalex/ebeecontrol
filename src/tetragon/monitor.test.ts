/**
 * Unit tests for TetragonMonitor - access event generation and validation.
 *
 * Validates: Requirements 3.1, 3.2, 3.4
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTetragonMonitor,
  validateAccessEvent,
  TetragonMonitor,
  HoneytokenPath,
  AccessEventParams,
} from "./monitor.js";
import { AccessEvent } from "../types/index.js";

describe("TetragonMonitor", () => {
  let monitor: TetragonMonitor;

  beforeEach(() => {
    monitor = createTetragonMonitor();
  });

  describe("registerHoneytokenPath", () => {
    it("should register a honeytoken path", async () => {
      const path: HoneytokenPath = {
        podId: "pod-123",
        namespace: "default",
        filePath: "/etc/secrets/token.json",
        honeytokenId: "ht-001",
      };

      await monitor.registerHoneytokenPath(path);
      const paths = await monitor.getRegisteredPaths();

      expect(paths).toHaveLength(1);
      expect(paths[0]).toEqual(path);
    });

    it("should register multiple honeytoken paths", async () => {
      const path1: HoneytokenPath = {
        podId: "pod-123",
        namespace: "default",
        filePath: "/etc/secrets/token.json",
        honeytokenId: "ht-001",
      };
      const path2: HoneytokenPath = {
        podId: "pod-456",
        namespace: "production",
        filePath: "/var/data/creds.yaml",
        honeytokenId: "ht-002",
      };

      await monitor.registerHoneytokenPath(path1);
      await monitor.registerHoneytokenPath(path2);
      const paths = await monitor.getRegisteredPaths();

      expect(paths).toHaveLength(2);
    });

    it("should not duplicate paths with same key", async () => {
      const path: HoneytokenPath = {
        podId: "pod-123",
        namespace: "default",
        filePath: "/etc/secrets/token.json",
        honeytokenId: "ht-001",
      };

      await monitor.registerHoneytokenPath(path);
      await monitor.registerHoneytokenPath(path);
      const paths = await monitor.getRegisteredPaths();

      expect(paths).toHaveLength(1);
    });
  });

  describe("unregisterHoneytokenPath", () => {
    it("should remove a registered honeytoken path", async () => {
      const path: HoneytokenPath = {
        podId: "pod-123",
        namespace: "default",
        filePath: "/etc/secrets/token.json",
        honeytokenId: "ht-001",
      };

      await monitor.registerHoneytokenPath(path);
      await monitor.unregisterHoneytokenPath(path);
      const paths = await monitor.getRegisteredPaths();

      expect(paths).toHaveLength(0);
    });

    it("should not throw when unregistering a non-existent path", async () => {
      const path: HoneytokenPath = {
        podId: "pod-999",
        namespace: "default",
        filePath: "/nonexistent",
        honeytokenId: "ht-999",
      };

      await expect(
        monitor.unregisterHoneytokenPath(path)
      ).resolves.toBeUndefined();
    });

    it("should only remove the specified path", async () => {
      const path1: HoneytokenPath = {
        podId: "pod-123",
        namespace: "default",
        filePath: "/etc/secrets/token.json",
        honeytokenId: "ht-001",
      };
      const path2: HoneytokenPath = {
        podId: "pod-456",
        namespace: "production",
        filePath: "/var/data/creds.yaml",
        honeytokenId: "ht-002",
      };

      await monitor.registerHoneytokenPath(path1);
      await monitor.registerHoneytokenPath(path2);
      await monitor.unregisterHoneytokenPath(path1);
      const paths = await monitor.getRegisteredPaths();

      expect(paths).toHaveLength(1);
      expect(paths[0]).toEqual(path2);
    });
  });

  describe("generateAccessEvent", () => {
    it("should generate an event with all required fields", () => {
      const params: AccessEventParams = {
        processId: 1234,
        processBinaryPath: "/usr/bin/cat",
        userId: 1000,
        podId: "pod-123",
        namespace: "default",
        honeytokenPath: "/etc/secrets/token.json",
        accessType: "read",
      };

      const event = monitor.generateAccessEvent(params);

      expect(event.eventId).toBeDefined();
      expect(event.eventId.length).toBeGreaterThan(0);
      expect(event.processId).toBe(1234);
      expect(event.processBinaryPath).toBe("/usr/bin/cat");
      expect(event.userId).toBe(1000);
      expect(event.podId).toBe("pod-123");
      expect(event.namespace).toBe("default");
      expect(event.honeytokenPath).toBe("/etc/secrets/token.json");
      expect(event.accessType).toBe("read");
      expect(event.timestamp).toBeDefined();
    });

    it("should generate a UUID for eventId", () => {
      const params: AccessEventParams = {
        processId: 1,
        processBinaryPath: "/bin/ls",
        userId: 0,
        podId: "pod-1",
        namespace: "ns",
        honeytokenPath: "/path",
        accessType: "open",
      };

      const event = monitor.generateAccessEvent(params);
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(event.eventId).toMatch(uuidRegex);
    });

    it("should generate unique eventIds for each event", () => {
      const params: AccessEventParams = {
        processId: 1,
        processBinaryPath: "/bin/ls",
        userId: 0,
        podId: "pod-1",
        namespace: "ns",
        honeytokenPath: "/path",
        accessType: "stat",
      };

      const event1 = monitor.generateAccessEvent(params);
      const event2 = monitor.generateAccessEvent(params);

      expect(event1.eventId).not.toBe(event2.eventId);
    });

    it("should generate ISO 8601 timestamp with millisecond precision", () => {
      const params: AccessEventParams = {
        processId: 42,
        processBinaryPath: "/usr/bin/python3",
        userId: 500,
        podId: "pod-abc",
        namespace: "staging",
        honeytokenPath: "/tmp/decoy.key",
        accessType: "write",
      };

      const event = monitor.generateAccessEvent(params);

      // Should contain milliseconds (e.g., .123Z or .000Z)
      expect(event.timestamp).toMatch(/\.\d{3}/);
      // Should be parseable as a valid date
      const parsed = new Date(event.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it("should support all access types", () => {
      const accessTypes: Array<"open" | "read" | "write" | "stat"> = [
        "open",
        "read",
        "write",
        "stat",
      ];

      for (const accessType of accessTypes) {
        const params: AccessEventParams = {
          processId: 1,
          processBinaryPath: "/bin/test",
          userId: 0,
          podId: "pod-1",
          namespace: "ns",
          honeytokenPath: "/path",
          accessType,
        };

        const event = monitor.generateAccessEvent(params);
        expect(event.accessType).toBe(accessType);
      }
    });

    it("should generate a valid event that passes validation", () => {
      const params: AccessEventParams = {
        processId: 100,
        processBinaryPath: "/usr/sbin/sshd",
        userId: 0,
        podId: "web-pod-xyz",
        namespace: "production",
        honeytokenPath: "/etc/kubernetes/secrets/api-key",
        accessType: "open",
      };

      const event = monitor.generateAccessEvent(params);
      expect(validateAccessEvent(event)).toBe(true);
    });
  });

  describe("getRegisteredPaths", () => {
    it("should return empty array when no paths registered", async () => {
      const paths = await monitor.getRegisteredPaths();
      expect(paths).toEqual([]);
    });
  });
});

describe("validateAccessEvent", () => {
  const validEvent: AccessEvent = {
    eventId: "550e8400-e29b-41d4-a716-446655440000",
    processId: 1234,
    processBinaryPath: "/usr/bin/cat",
    userId: 1000,
    podId: "pod-123",
    namespace: "default",
    honeytokenPath: "/etc/secrets/token.json",
    accessType: "read",
    timestamp: "2024-01-15T10:30:00.123Z",
  };

  it("should return true for a valid event", () => {
    expect(validateAccessEvent(validEvent)).toBe(true);
  });

  it("should return false for null/undefined event", () => {
    expect(validateAccessEvent(null as unknown as AccessEvent)).toBe(false);
    expect(validateAccessEvent(undefined as unknown as AccessEvent)).toBe(
      false
    );
  });

  describe("eventId validation", () => {
    it("should return false for empty eventId", () => {
      expect(validateAccessEvent({ ...validEvent, eventId: "" })).toBe(false);
    });

    it("should return false for whitespace-only eventId", () => {
      expect(validateAccessEvent({ ...validEvent, eventId: "   " })).toBe(
        false
      );
    });
  });

  describe("processId validation", () => {
    it("should return false for processId of 0", () => {
      expect(validateAccessEvent({ ...validEvent, processId: 0 })).toBe(false);
    });

    it("should return false for negative processId", () => {
      expect(validateAccessEvent({ ...validEvent, processId: -1 })).toBe(false);
    });

    it("should return false for non-integer processId", () => {
      expect(validateAccessEvent({ ...validEvent, processId: 1.5 })).toBe(
        false
      );
    });

    it("should return true for processId of 1", () => {
      expect(validateAccessEvent({ ...validEvent, processId: 1 })).toBe(true);
    });
  });

  describe("processBinaryPath validation", () => {
    it("should return false for empty processBinaryPath", () => {
      expect(
        validateAccessEvent({ ...validEvent, processBinaryPath: "" })
      ).toBe(false);
    });

    it("should return false for whitespace-only processBinaryPath", () => {
      expect(
        validateAccessEvent({ ...validEvent, processBinaryPath: "   " })
      ).toBe(false);
    });
  });

  describe("userId validation", () => {
    it("should return true for userId of 0 (root)", () => {
      expect(validateAccessEvent({ ...validEvent, userId: 0 })).toBe(true);
    });

    it("should return false for negative userId", () => {
      expect(validateAccessEvent({ ...validEvent, userId: -1 })).toBe(false);
    });

    it("should return false for non-integer userId", () => {
      expect(validateAccessEvent({ ...validEvent, userId: 1.5 })).toBe(false);
    });
  });

  describe("podId validation", () => {
    it("should return false for empty podId", () => {
      expect(validateAccessEvent({ ...validEvent, podId: "" })).toBe(false);
    });

    it("should return false for whitespace-only podId", () => {
      expect(validateAccessEvent({ ...validEvent, podId: "   " })).toBe(false);
    });
  });

  describe("namespace validation", () => {
    it("should return false for empty namespace", () => {
      expect(validateAccessEvent({ ...validEvent, namespace: "" })).toBe(false);
    });

    it("should return false for whitespace-only namespace", () => {
      expect(validateAccessEvent({ ...validEvent, namespace: "   " })).toBe(
        false
      );
    });
  });

  describe("honeytokenPath validation", () => {
    it("should return false for empty honeytokenPath", () => {
      expect(validateAccessEvent({ ...validEvent, honeytokenPath: "" })).toBe(
        false
      );
    });

    it("should return false for whitespace-only honeytokenPath", () => {
      expect(
        validateAccessEvent({ ...validEvent, honeytokenPath: "   " })
      ).toBe(false);
    });
  });

  describe("accessType validation", () => {
    it("should return true for all valid access types", () => {
      const validTypes: Array<"open" | "read" | "write" | "stat"> = [
        "open",
        "read",
        "write",
        "stat",
      ];
      for (const accessType of validTypes) {
        expect(validateAccessEvent({ ...validEvent, accessType })).toBe(true);
      }
    });

    it("should return false for invalid access type", () => {
      expect(
        validateAccessEvent({
          ...validEvent,
          accessType: "delete" as any,
        })
      ).toBe(false);
    });
  });

  describe("timestamp validation", () => {
    it("should return true for valid ISO 8601 with milliseconds", () => {
      expect(
        validateAccessEvent({
          ...validEvent,
          timestamp: "2024-01-15T10:30:00.000Z",
        })
      ).toBe(true);
    });

    it("should return false for timestamp without milliseconds", () => {
      expect(
        validateAccessEvent({
          ...validEvent,
          timestamp: "2024-01-15T10:30:00Z",
        })
      ).toBe(false);
    });

    it("should return false for invalid date string", () => {
      expect(
        validateAccessEvent({
          ...validEvent,
          timestamp: "not-a-date",
        })
      ).toBe(false);
    });

    it("should return false for empty timestamp", () => {
      expect(
        validateAccessEvent({
          ...validEvent,
          timestamp: "",
        })
      ).toBe(false);
    });

    it("should return true for timestamp with timezone offset and milliseconds", () => {
      expect(
        validateAccessEvent({
          ...validEvent,
          timestamp: "2024-01-15T10:30:00.456+05:30",
        })
      ).toBe(true);
    });
  });
});
