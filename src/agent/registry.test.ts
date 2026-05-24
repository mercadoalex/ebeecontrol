import { describe, it, expect, beforeEach } from "vitest";
import { createHoneytokenRegistry, HoneytokenRegistry } from "./registry";
import { HoneytokenRegistryEntry } from "../types/index";

function makeEntry(
  overrides: Partial<HoneytokenRegistryEntry> = {}
): HoneytokenRegistryEntry {
  return {
    honeytokenId: "ht-001",
    podId: "pod-abc",
    namespace: "production",
    type: "decoy_secret",
    filePath: "/etc/secrets/db-password",
    deploymentTimestamp: "2024-01-15T10:00:00.000Z",
    status: "active",
    accessCount: 0,
    ...overrides,
  };
}

describe("HoneytokenRegistry", () => {
  let registry: HoneytokenRegistry;

  beforeEach(() => {
    registry = createHoneytokenRegistry();
  });

  describe("addEntry", () => {
    it("adds an entry to the registry", () => {
      const entry = makeEntry();
      registry.addEntry(entry);
      expect(registry.getSize()).toBe(1);
    });

    it("stores entry with correct fields", () => {
      const entry = makeEntry();
      registry.addEntry(entry);
      const retrieved = registry.getById("ht-001");
      expect(retrieved).toEqual(entry);
    });

    it("overwrites entry with same honeytokenId", () => {
      registry.addEntry(makeEntry({ status: "active" }));
      registry.addEntry(makeEntry({ status: "triggered" }));
      expect(registry.getSize()).toBe(1);
      expect(registry.getById("ht-001")?.status).toBe("triggered");
    });

    it("stores multiple entries with different IDs", () => {
      registry.addEntry(makeEntry({ honeytokenId: "ht-001" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-002" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-003" }));
      expect(registry.getSize()).toBe(3);
    });

    it("does not mutate the original entry object", () => {
      const entry = makeEntry();
      registry.addEntry(entry);
      entry.status = "decommissioned";
      expect(registry.getById("ht-001")?.status).toBe("active");
    });
  });

  describe("updateStatus", () => {
    it("updates status of existing entry", () => {
      registry.addEntry(makeEntry());
      const result = registry.updateStatus("ht-001", "triggered");
      expect(result).toBe(true);
      expect(registry.getById("ht-001")?.status).toBe("triggered");
    });

    it("returns false for non-existent entry", () => {
      const result = registry.updateStatus("non-existent", "triggered");
      expect(result).toBe(false);
    });

    it("can transition from active to decommissioned", () => {
      registry.addEntry(makeEntry());
      registry.updateStatus("ht-001", "decommissioned");
      expect(registry.getById("ht-001")?.status).toBe("decommissioned");
    });

    it("can transition from triggered to decommissioned", () => {
      registry.addEntry(makeEntry({ status: "triggered" }));
      registry.updateStatus("ht-001", "decommissioned");
      expect(registry.getById("ht-001")?.status).toBe("decommissioned");
    });
  });

  describe("recordAccess", () => {
    it("records access timestamp and increments count", () => {
      registry.addEntry(makeEntry());
      const result = registry.recordAccess(
        "ht-001",
        "2024-01-15T12:00:00.000Z"
      );
      expect(result).toBe(true);
      const entry = registry.getById("ht-001");
      expect(entry?.lastAccessTimestamp).toBe("2024-01-15T12:00:00.000Z");
      expect(entry?.accessCount).toBe(1);
    });

    it("increments access count on multiple accesses", () => {
      registry.addEntry(makeEntry());
      registry.recordAccess("ht-001", "2024-01-15T12:00:00.000Z");
      registry.recordAccess("ht-001", "2024-01-15T12:01:00.000Z");
      registry.recordAccess("ht-001", "2024-01-15T12:02:00.000Z");
      const entry = registry.getById("ht-001");
      expect(entry?.accessCount).toBe(3);
      expect(entry?.lastAccessTimestamp).toBe("2024-01-15T12:02:00.000Z");
    });

    it("returns false for non-existent entry", () => {
      const result = registry.recordAccess(
        "non-existent",
        "2024-01-15T12:00:00.000Z"
      );
      expect(result).toBe(false);
    });
  });

  describe("getById", () => {
    it("returns entry by honeytokenId", () => {
      const entry = makeEntry();
      registry.addEntry(entry);
      expect(registry.getById("ht-001")).toEqual(entry);
    });

    it("returns undefined for non-existent ID", () => {
      expect(registry.getById("non-existent")).toBeUndefined();
    });

    it("returns a copy that does not affect the registry", () => {
      registry.addEntry(makeEntry());
      const retrieved = registry.getById("ht-001");
      retrieved!.status = "decommissioned";
      expect(registry.getById("ht-001")?.status).toBe("active");
    });
  });

  describe("getByPod", () => {
    it("returns all entries for a given pod", () => {
      registry.addEntry(makeEntry({ honeytokenId: "ht-001", podId: "pod-a" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-002", podId: "pod-a" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-003", podId: "pod-b" }));
      const results = registry.getByPod("pod-a");
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.podId === "pod-a")).toBe(true);
    });

    it("returns empty array for non-existent pod", () => {
      registry.addEntry(makeEntry());
      expect(registry.getByPod("non-existent")).toEqual([]);
    });

    it("returns empty array when registry is empty", () => {
      expect(registry.getByPod("pod-a")).toEqual([]);
    });
  });

  describe("getByNamespace", () => {
    it("returns all entries for a given namespace", () => {
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-001", namespace: "prod" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-002", namespace: "prod" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-003", namespace: "staging" })
      );
      const results = registry.getByNamespace("prod");
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.namespace === "prod")).toBe(true);
    });

    it("returns empty array for non-existent namespace", () => {
      registry.addEntry(makeEntry());
      expect(registry.getByNamespace("non-existent")).toEqual([]);
    });
  });

  describe("getAll", () => {
    it("returns all entries in the registry", () => {
      registry.addEntry(makeEntry({ honeytokenId: "ht-001" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-002" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-003" }));
      expect(registry.getAll()).toHaveLength(3);
    });

    it("returns empty array when registry is empty", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("returns copies that do not affect the registry", () => {
      registry.addEntry(makeEntry());
      const all = registry.getAll();
      all[0].status = "decommissioned";
      expect(registry.getById("ht-001")?.status).toBe("active");
    });
  });

  describe("getActive", () => {
    it("returns only entries with active status", () => {
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-001", status: "active" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-002", status: "triggered" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-003", status: "decommissioned" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-004", status: "active" })
      );
      const active = registry.getActive();
      expect(active).toHaveLength(2);
      expect(active.every((e) => e.status === "active")).toBe(true);
    });

    it("returns empty array when no active entries exist", () => {
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-001", status: "triggered" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-002", status: "decommissioned" })
      );
      expect(registry.getActive()).toEqual([]);
    });
  });

  describe("remove", () => {
    it("removes an existing entry", () => {
      registry.addEntry(makeEntry());
      const result = registry.remove("ht-001");
      expect(result).toBe(true);
      expect(registry.getSize()).toBe(0);
      expect(registry.getById("ht-001")).toBeUndefined();
    });

    it("returns false for non-existent entry", () => {
      const result = registry.remove("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("getSize", () => {
    it("returns 0 for empty registry", () => {
      expect(registry.getSize()).toBe(0);
    });

    it("returns correct count after additions", () => {
      registry.addEntry(makeEntry({ honeytokenId: "ht-001" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-002" }));
      expect(registry.getSize()).toBe(2);
    });

    it("returns correct count after removal", () => {
      registry.addEntry(makeEntry({ honeytokenId: "ht-001" }));
      registry.addEntry(makeEntry({ honeytokenId: "ht-002" }));
      registry.remove("ht-001");
      expect(registry.getSize()).toBe(1);
    });
  });

  describe("registry entry fields", () => {
    it("stores all required fields correctly", () => {
      const entry = makeEntry({
        honeytokenId: "uuid-123",
        podId: "pod-xyz",
        namespace: "kube-system",
        type: "decoy_credential",
        filePath: "/var/run/secrets/token",
        deploymentTimestamp: "2024-03-01T08:30:00.000Z",
        status: "active",
        accessCount: 0,
      });
      registry.addEntry(entry);
      const retrieved = registry.getById("uuid-123");
      expect(retrieved?.honeytokenId).toBe("uuid-123");
      expect(retrieved?.podId).toBe("pod-xyz");
      expect(retrieved?.namespace).toBe("kube-system");
      expect(retrieved?.type).toBe("decoy_credential");
      expect(retrieved?.filePath).toBe("/var/run/secrets/token");
      expect(retrieved?.deploymentTimestamp).toBe("2024-03-01T08:30:00.000Z");
      expect(retrieved?.status).toBe("active");
      expect(retrieved?.accessCount).toBe(0);
      expect(retrieved?.lastAccessTimestamp).toBeUndefined();
    });

    it("supports all honeytoken types", () => {
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-1", type: "decoy_secret" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-2", type: "decoy_file" })
      );
      registry.addEntry(
        makeEntry({ honeytokenId: "ht-3", type: "decoy_credential" })
      );
      expect(registry.getById("ht-1")?.type).toBe("decoy_secret");
      expect(registry.getById("ht-2")?.type).toBe("decoy_file");
      expect(registry.getById("ht-3")?.type).toBe("decoy_credential");
    });
  });
});
