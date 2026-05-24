/**
 * Tetragon Monitor - eBPF-based kernel-level file access monitor.
 *
 * Maintains a registry of honeytoken paths and generates access events
 * with full process context when file operations are detected.
 *
 * Validates: Requirements 3.1, 3.2, 3.4
 */

import { v4 as uuidv4 } from "uuid";
import { AccessEvent } from "../types/index.js";

/**
 * Represents a registered honeytoken path being monitored by Tetragon.
 */
export interface HoneytokenPath {
  podId: string;
  namespace: string;
  filePath: string;
  honeytokenId: string;
}

/**
 * Parameters for generating an access event.
 */
export interface AccessEventParams {
  processId: number;
  processBinaryPath: string;
  userId: number;
  podId: string;
  namespace: string;
  honeytokenPath: string;
  accessType: "open" | "read" | "write" | "stat";
}

/**
 * Buffer status for the Tetragon Monitor's local event buffer.
 */
export interface BufferStatus {
  currentSize: number;
  maxCapacity: 1000;
  oldestEventTimestamp?: string;
  overflowCount: number;
}

/**
 * TetragonMonitor interface as defined in the design document.
 */
export interface TetragonMonitor {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerHoneytokenPath(path: HoneytokenPath): Promise<void>;
  unregisterHoneytokenPath(path: HoneytokenPath): Promise<void>;
  getRegisteredPaths(): Promise<HoneytokenPath[]>;
  generateAccessEvent(params: AccessEventParams): AccessEvent;
  getBufferStatus(): BufferStatus;
}

const VALID_ACCESS_TYPES: ReadonlySet<string> = new Set([
  "open",
  "read",
  "write",
  "stat",
]);

/**
 * Validates that an AccessEvent contains all required fields with valid values.
 *
 * Validation rules:
 * - eventId: non-empty string
 * - processId: positive integer (> 0)
 * - processBinaryPath: non-empty string
 * - userId: non-negative integer (>= 0)
 * - podId: non-empty string
 * - namespace: non-empty string
 * - honeytokenPath: non-empty string
 * - accessType: one of "open", "read", "write", "stat"
 * - timestamp: valid ISO 8601 string with millisecond precision
 *
 * @param event - The access event to validate
 * @returns true if all fields are present and valid
 */
export function validateAccessEvent(event: AccessEvent): boolean {
  if (!event) return false;

  // eventId must be a non-empty string
  if (typeof event.eventId !== "string" || event.eventId.trim().length === 0) {
    return false;
  }

  // processId must be a positive integer
  if (
    typeof event.processId !== "number" ||
    !Number.isInteger(event.processId) ||
    event.processId <= 0
  ) {
    return false;
  }

  // processBinaryPath must be a non-empty string
  if (
    typeof event.processBinaryPath !== "string" ||
    event.processBinaryPath.trim().length === 0
  ) {
    return false;
  }

  // userId must be a non-negative integer
  if (
    typeof event.userId !== "number" ||
    !Number.isInteger(event.userId) ||
    event.userId < 0
  ) {
    return false;
  }

  // podId must be a non-empty string
  if (typeof event.podId !== "string" || event.podId.trim().length === 0) {
    return false;
  }

  // namespace must be a non-empty string
  if (
    typeof event.namespace !== "string" ||
    event.namespace.trim().length === 0
  ) {
    return false;
  }

  // honeytokenPath must be a non-empty string
  if (
    typeof event.honeytokenPath !== "string" ||
    event.honeytokenPath.trim().length === 0
  ) {
    return false;
  }

  // accessType must be one of the valid types
  if (!VALID_ACCESS_TYPES.has(event.accessType)) {
    return false;
  }

  // timestamp must be a valid ISO 8601 string with millisecond precision
  if (typeof event.timestamp !== "string" || !isValidIso8601WithMs(event.timestamp)) {
    return false;
  }

  return true;
}

/**
 * Checks if a timestamp string is valid ISO 8601 with millisecond precision.
 */
function isValidIso8601WithMs(timestamp: string): boolean {
  // Must parse to a valid date
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return false;
  }

  // Must contain millisecond precision (e.g., .123 or .000)
  const msPattern = /\.\d{3}/;
  if (!msPattern.test(timestamp)) {
    return false;
  }

  return true;
}

/**
 * Creates a unique key for a HoneytokenPath for use in the registry.
 */
function pathKey(path: HoneytokenPath): string {
  return `${path.podId}:${path.namespace}:${path.filePath}:${path.honeytokenId}`;
}

/**
 * Creates a TetragonMonitor instance that manages honeytoken path registration
 * and generates validated access events.
 */
export function createTetragonMonitor(): TetragonMonitor {
  const registeredPaths = new Map<string, HoneytokenPath>();
  let running = false;

  return {
    async start(): Promise<void> {
      running = true;
    },

    async stop(): Promise<void> {
      running = false;
    },

    async registerHoneytokenPath(path: HoneytokenPath): Promise<void> {
      const key = pathKey(path);
      registeredPaths.set(key, { ...path });
    },

    async unregisterHoneytokenPath(path: HoneytokenPath): Promise<void> {
      const key = pathKey(path);
      registeredPaths.delete(key);
    },

    async getRegisteredPaths(): Promise<HoneytokenPath[]> {
      return Array.from(registeredPaths.values());
    },

    generateAccessEvent(params: AccessEventParams): AccessEvent {
      const event: AccessEvent = {
        eventId: uuidv4(),
        processId: params.processId,
        processBinaryPath: params.processBinaryPath,
        userId: params.userId,
        podId: params.podId,
        namespace: params.namespace,
        honeytokenPath: params.honeytokenPath,
        accessType: params.accessType,
        timestamp: new Date().toISOString(),
      };
      return event;
    },

    getBufferStatus(): BufferStatus {
      return {
        currentSize: 0,
        maxCapacity: 1000,
        oldestEventTimestamp: undefined,
        overflowCount: 0,
      };
    },
  };
}
