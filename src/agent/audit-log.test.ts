import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createAuditLog, AuditLog } from "./audit-log";

describe("AuditLog", () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    auditLog = createAuditLog();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("log", () => {
    it("creates an entry with a generated UUID entryId", () => {
      const entry = auditLog.log({
        decisionType: "discovery",
        decisionRationale: "Scheduled discovery cycle initiated",
        inputDataSummary: "Queried Dynatrace for high-risk services",
        outcome: "Found 3 high-risk services",
      });

      expect(entry.entryId).toBeDefined();
      expect(entry.entryId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("sets timestamp to current ISO 8601", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-06-15T10:30:00.000Z"));

      const entry = auditLog.log({
        decisionType: "deployment",
        decisionRationale: "High-risk pod identified",
        inputDataSummary: "Pod pod-abc in namespace production",
        outcome: "Deployed 3 honeytokens",
      });

      expect(entry.timestamp).toBe("2024-06-15T10:30:00.000Z");
    });

    it("sets retentionDays from default config (90)", () => {
      const entry = auditLog.log({
        decisionType: "assessment",
        decisionRationale: "Access event received",
        inputDataSummary: "Process 1234 accessed /etc/secrets/token",
        outcome: "Classified as high threat",
      });

      expect(entry.retentionDays).toBe(90);
    });

    it("stores the entry and increments size", () => {
      auditLog.log({
        decisionType: "response",
        decisionRationale: "High threat detected",
        inputDataSummary: "Pod pod-xyz classified as high",
        outcome: "Pod isolated successfully",
      });

      expect(auditLog.getSize()).toBe(1);
    });

    it("returns a complete entry with all fields", () => {
      const entry = auditLog.log({
        decisionType: "learning",
        decisionRationale: "Response sequence completed",
        inputDataSummary: "Outcome data for incident inc-001",
        outcome: "Submitted to Vertex AI trainer",
      });

      expect(entry.entryId).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.decisionType).toBe("learning");
      expect(entry.decisionRationale).toBe("Response sequence completed");
      expect(entry.inputDataSummary).toBe(
        "Outcome data for incident inc-001"
      );
      expect(entry.outcome).toBe("Submitted to Vertex AI trainer");
      expect(entry.retentionDays).toBe(90);
    });

    it("generates unique entryIds for each log call", () => {
      const entry1 = auditLog.log({
        decisionType: "discovery",
        decisionRationale: "Cycle 1",
        inputDataSummary: "Input 1",
        outcome: "Outcome 1",
      });
      const entry2 = auditLog.log({
        decisionType: "discovery",
        decisionRationale: "Cycle 2",
        inputDataSummary: "Input 2",
        outcome: "Outcome 2",
      });

      expect(entry1.entryId).not.toBe(entry2.entryId);
    });

    it("supports all decision types", () => {
      const types = [
        "discovery",
        "deployment",
        "assessment",
        "response",
        "learning",
        "model_update",
      ] as const;

      for (const decisionType of types) {
        const entry = auditLog.log({
          decisionType,
          decisionRationale: `Rationale for ${decisionType}`,
          inputDataSummary: `Input for ${decisionType}`,
          outcome: `Outcome for ${decisionType}`,
        });
        expect(entry.decisionType).toBe(decisionType);
      }

      expect(auditLog.getSize()).toBe(6);
    });
  });

  describe("config", () => {
    it("uses custom retentionDays when provided", () => {
      const customLog = createAuditLog({ retentionDays: 180 });
      const entry = customLog.log({
        decisionType: "discovery",
        decisionRationale: "Test",
        inputDataSummary: "Test",
        outcome: "Test",
      });

      expect(entry.retentionDays).toBe(180);
    });

    it("enforces minimum 90 days retention", () => {
      const customLog = createAuditLog({ retentionDays: 30 });
      const entry = customLog.log({
        decisionType: "discovery",
        decisionRationale: "Test",
        inputDataSummary: "Test",
        outcome: "Test",
      });

      expect(entry.retentionDays).toBe(90);
    });

    it("enforces minimum 90 days when retentionDays is 0", () => {
      const customLog = createAuditLog({ retentionDays: 0 });
      const entry = customLog.log({
        decisionType: "discovery",
        decisionRationale: "Test",
        inputDataSummary: "Test",
        outcome: "Test",
      });

      expect(entry.retentionDays).toBe(90);
    });
  });

  describe("getAll", () => {
    it("returns empty array when no entries exist", () => {
      expect(auditLog.getAll()).toEqual([]);
    });

    it("returns all logged entries", () => {
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "R1",
        inputDataSummary: "I1",
        outcome: "O1",
      });
      auditLog.log({
        decisionType: "deployment",
        decisionRationale: "R2",
        inputDataSummary: "I2",
        outcome: "O2",
      });

      const all = auditLog.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].decisionType).toBe("discovery");
      expect(all[1].decisionType).toBe("deployment");
    });

    it("returns copies that do not affect the internal store", () => {
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "R1",
        inputDataSummary: "I1",
        outcome: "O1",
      });

      const all = auditLog.getAll();
      all[0].outcome = "MODIFIED";

      const allAgain = auditLog.getAll();
      expect(allAgain[0].outcome).toBe("O1");
    });
  });

  describe("getByType", () => {
    beforeEach(() => {
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "R1",
        inputDataSummary: "I1",
        outcome: "O1",
      });
      auditLog.log({
        decisionType: "deployment",
        decisionRationale: "R2",
        inputDataSummary: "I2",
        outcome: "O2",
      });
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "R3",
        inputDataSummary: "I3",
        outcome: "O3",
      });
      auditLog.log({
        decisionType: "response",
        decisionRationale: "R4",
        inputDataSummary: "I4",
        outcome: "O4",
      });
    });

    it("returns entries matching the specified decision type", () => {
      const discoveries = auditLog.getByType("discovery");
      expect(discoveries).toHaveLength(2);
      expect(discoveries.every((e) => e.decisionType === "discovery")).toBe(
        true
      );
    });

    it("returns empty array when no entries match", () => {
      const modelUpdates = auditLog.getByType("model_update");
      expect(modelUpdates).toEqual([]);
    });

    it("returns copies that do not affect the internal store", () => {
      const discoveries = auditLog.getByType("discovery");
      discoveries[0].outcome = "MODIFIED";

      const discoveriesAgain = auditLog.getByType("discovery");
      expect(discoveriesAgain[0].outcome).toBe("O1");
    });
  });

  describe("getByDateRange", () => {
    beforeEach(() => {
      vi.useFakeTimers();

      vi.setSystemTime(new Date("2024-01-10T10:00:00.000Z"));
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "R1",
        inputDataSummary: "I1",
        outcome: "O1",
      });

      vi.setSystemTime(new Date("2024-01-15T10:00:00.000Z"));
      auditLog.log({
        decisionType: "deployment",
        decisionRationale: "R2",
        inputDataSummary: "I2",
        outcome: "O2",
      });

      vi.setSystemTime(new Date("2024-01-20T10:00:00.000Z"));
      auditLog.log({
        decisionType: "assessment",
        decisionRationale: "R3",
        inputDataSummary: "I3",
        outcome: "O3",
      });

      vi.setSystemTime(new Date("2024-01-25T10:00:00.000Z"));
      auditLog.log({
        decisionType: "response",
        decisionRationale: "R4",
        inputDataSummary: "I4",
        outcome: "O4",
      });
    });

    it("returns entries within the specified date range (inclusive)", () => {
      const results = auditLog.getByDateRange(
        "2024-01-14T00:00:00.000Z",
        "2024-01-21T00:00:00.000Z"
      );
      expect(results).toHaveLength(2);
      expect(results[0].decisionType).toBe("deployment");
      expect(results[1].decisionType).toBe("assessment");
    });

    it("returns empty array when no entries fall in range", () => {
      const results = auditLog.getByDateRange(
        "2024-02-01T00:00:00.000Z",
        "2024-02-28T00:00:00.000Z"
      );
      expect(results).toEqual([]);
    });

    it("returns all entries when range covers everything", () => {
      const results = auditLog.getByDateRange(
        "2024-01-01T00:00:00.000Z",
        "2024-12-31T23:59:59.999Z"
      );
      expect(results).toHaveLength(4);
    });

    it("includes entries exactly at the boundary timestamps", () => {
      const results = auditLog.getByDateRange(
        "2024-01-15T10:00:00.000Z",
        "2024-01-20T10:00:00.000Z"
      );
      expect(results).toHaveLength(2);
    });
  });

  describe("getSize", () => {
    it("returns 0 for empty log", () => {
      expect(auditLog.getSize()).toBe(0);
    });

    it("returns correct count after logging entries", () => {
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "R1",
        inputDataSummary: "I1",
        outcome: "O1",
      });
      auditLog.log({
        decisionType: "deployment",
        decisionRationale: "R2",
        inputDataSummary: "I2",
        outcome: "O2",
      });
      expect(auditLog.getSize()).toBe(2);
    });
  });

  describe("purgeExpired", () => {
    it("removes entries older than retentionDays", () => {
      vi.useFakeTimers();

      // Log an entry 91 days ago
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "Old entry",
        inputDataSummary: "Old input",
        outcome: "Old outcome",
      });

      // Log an entry now
      vi.setSystemTime(new Date("2024-04-02T00:00:00.000Z"));
      auditLog.log({
        decisionType: "deployment",
        decisionRationale: "Recent entry",
        inputDataSummary: "Recent input",
        outcome: "Recent outcome",
      });

      const purged = auditLog.purgeExpired();
      expect(purged).toBe(1);
      expect(auditLog.getSize()).toBe(1);
      expect(auditLog.getAll()[0].decisionRationale).toBe("Recent entry");
    });

    it("returns 0 when no entries are expired", () => {
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "Fresh entry",
        inputDataSummary: "Fresh input",
        outcome: "Fresh outcome",
      });

      const purged = auditLog.purgeExpired();
      expect(purged).toBe(0);
      expect(auditLog.getSize()).toBe(1);
    });

    it("returns 0 when log is empty", () => {
      const purged = auditLog.purgeExpired();
      expect(purged).toBe(0);
    });

    it("purges multiple expired entries", () => {
      vi.useFakeTimers();

      // Log entries 100 days ago
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      auditLog.log({
        decisionType: "discovery",
        decisionRationale: "Old 1",
        inputDataSummary: "I1",
        outcome: "O1",
      });
      auditLog.log({
        decisionType: "deployment",
        decisionRationale: "Old 2",
        inputDataSummary: "I2",
        outcome: "O2",
      });
      auditLog.log({
        decisionType: "assessment",
        decisionRationale: "Old 3",
        inputDataSummary: "I3",
        outcome: "O3",
      });

      // Move time forward 100 days
      vi.setSystemTime(new Date("2024-04-10T00:00:00.000Z"));
      auditLog.log({
        decisionType: "response",
        decisionRationale: "Recent",
        inputDataSummary: "I4",
        outcome: "O4",
      });

      const purged = auditLog.purgeExpired();
      expect(purged).toBe(3);
      expect(auditLog.getSize()).toBe(1);
    });

    it("respects custom retention days", () => {
      vi.useFakeTimers();
      const customLog = createAuditLog({ retentionDays: 180 });

      // Log an entry 100 days ago
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      customLog.log({
        decisionType: "discovery",
        decisionRationale: "Entry within 180 days",
        inputDataSummary: "Input",
        outcome: "Outcome",
      });

      // Move time forward 100 days (within 180-day retention)
      vi.setSystemTime(new Date("2024-04-10T00:00:00.000Z"));
      const purged = customLog.purgeExpired();
      expect(purged).toBe(0);
      expect(customLog.getSize()).toBe(1);
    });

    it("purges entries with custom retention when expired", () => {
      vi.useFakeTimers();
      const customLog = createAuditLog({ retentionDays: 180 });

      // Log an entry 181 days ago
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      customLog.log({
        decisionType: "discovery",
        decisionRationale: "Old entry",
        inputDataSummary: "Input",
        outcome: "Outcome",
      });

      // Move time forward 181 days
      vi.setSystemTime(new Date("2024-07-01T00:00:00.000Z"));
      const purged = customLog.purgeExpired();
      expect(purged).toBe(1);
      expect(customLog.getSize()).toBe(0);
    });
  });
});
