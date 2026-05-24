import { HoneytokenRegistryEntry } from "../types/index";

/**
 * Interface for the honeytoken registry that tracks all deployed honeytokens.
 * Provides CRUD operations and query methods for managing honeytoken lifecycle.
 *
 * Validates: Requirements 2.6, 2.7
 */
export interface HoneytokenRegistry {
  addEntry(entry: HoneytokenRegistryEntry): void;
  updateStatus(
    honeytokenId: string,
    status: "active" | "triggered" | "decommissioned"
  ): boolean;
  recordAccess(honeytokenId: string, timestamp: string): boolean;
  getById(honeytokenId: string): HoneytokenRegistryEntry | undefined;
  getByPod(podId: string): HoneytokenRegistryEntry[];
  getByNamespace(namespace: string): HoneytokenRegistryEntry[];
  getAll(): HoneytokenRegistryEntry[];
  getActive(): HoneytokenRegistryEntry[];
  remove(honeytokenId: string): boolean;
  getSize(): number;
}

/**
 * Creates a new in-memory honeytoken registry.
 *
 * The registry stores all deployed honeytokens and supports:
 * - Adding entries upon successful deployment
 * - Updating status (active → triggered → decommissioned)
 * - Recording access events with timestamp and count
 * - Querying by pod, namespace, or status
 * - Removing decommissioned entries
 *
 * Registry updates occur within 5 seconds of receiving a deployment report
 * as required by Requirement 2.6.
 */
export function createHoneytokenRegistry(): HoneytokenRegistry {
  const entries = new Map<string, HoneytokenRegistryEntry>();

  return {
    addEntry(entry: HoneytokenRegistryEntry): void {
      entries.set(entry.honeytokenId, { ...entry });
    },

    updateStatus(
      honeytokenId: string,
      status: "active" | "triggered" | "decommissioned"
    ): boolean {
      const entry = entries.get(honeytokenId);
      if (!entry) {
        return false;
      }
      entry.status = status;
      return true;
    },

    recordAccess(honeytokenId: string, timestamp: string): boolean {
      const entry = entries.get(honeytokenId);
      if (!entry) {
        return false;
      }
      entry.lastAccessTimestamp = timestamp;
      entry.accessCount += 1;
      return true;
    },

    getById(honeytokenId: string): HoneytokenRegistryEntry | undefined {
      const entry = entries.get(honeytokenId);
      return entry ? { ...entry } : undefined;
    },

    getByPod(podId: string): HoneytokenRegistryEntry[] {
      const results: HoneytokenRegistryEntry[] = [];
      for (const entry of entries.values()) {
        if (entry.podId === podId) {
          results.push({ ...entry });
        }
      }
      return results;
    },

    getByNamespace(namespace: string): HoneytokenRegistryEntry[] {
      const results: HoneytokenRegistryEntry[] = [];
      for (const entry of entries.values()) {
        if (entry.namespace === namespace) {
          results.push({ ...entry });
        }
      }
      return results;
    },

    getAll(): HoneytokenRegistryEntry[] {
      return Array.from(entries.values()).map((entry) => ({ ...entry }));
    },

    getActive(): HoneytokenRegistryEntry[] {
      const results: HoneytokenRegistryEntry[] = [];
      for (const entry of entries.values()) {
        if (entry.status === "active") {
          results.push({ ...entry });
        }
      }
      return results;
    },

    remove(honeytokenId: string): boolean {
      return entries.delete(honeytokenId);
    },

    getSize(): number {
      return entries.size;
    },
  };
}
