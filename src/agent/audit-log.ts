import { v4 as uuidv4 } from "uuid";
import { AuditLogEntry } from "../types/index";

/**
 * Audit log for recording all autonomous decisions made by the Ebeecontrol Agent.
 * Each entry includes timestamp, decision type, rationale, input summary, and outcome.
 * Entries are retained for a configurable minimum of 90 days.
 *
 * Validates: Requirements 8.6
 */

export interface AuditLog {
  log(
    entry: Omit<AuditLogEntry, "entryId" | "timestamp" | "retentionDays">
  ): AuditLogEntry;
  getAll(): AuditLogEntry[];
  getByType(decisionType: AuditLogEntry["decisionType"]): AuditLogEntry[];
  getByDateRange(start: string, end: string): AuditLogEntry[];
  getSize(): number;
  purgeExpired(): number;
}

export interface AuditLogConfig {
  retentionDays: number; // minimum 90
}

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 90;

export function createAuditLog(config?: AuditLogConfig): AuditLog {
  const retentionDays = Math.max(
    MIN_RETENTION_DAYS,
    config?.retentionDays ?? DEFAULT_RETENTION_DAYS
  );

  const entries: AuditLogEntry[] = [];

  return {
    log(
      input: Omit<AuditLogEntry, "entryId" | "timestamp" | "retentionDays">
    ): AuditLogEntry {
      const entry: AuditLogEntry = {
        entryId: uuidv4(),
        timestamp: new Date().toISOString(),
        decisionType: input.decisionType,
        decisionRationale: input.decisionRationale,
        inputDataSummary: input.inputDataSummary,
        outcome: input.outcome,
        retentionDays,
      };
      entries.push(entry);
      return { ...entry };
    },

    getAll(): AuditLogEntry[] {
      return entries.map((e) => ({ ...e }));
    },

    getByType(decisionType: AuditLogEntry["decisionType"]): AuditLogEntry[] {
      return entries
        .filter((e) => e.decisionType === decisionType)
        .map((e) => ({ ...e }));
    },

    getByDateRange(start: string, end: string): AuditLogEntry[] {
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      return entries
        .filter((e) => {
          const t = new Date(e.timestamp).getTime();
          return t >= startTime && t <= endTime;
        })
        .map((e) => ({ ...e }));
    },

    getSize(): number {
      return entries.length;
    },

    purgeExpired(): number {
      const now = Date.now();
      const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
      let purgedCount = 0;

      for (let i = entries.length - 1; i >= 0; i--) {
        const entryTime = new Date(entries[i].timestamp).getTime();
        if (now - entryTime > cutoffMs) {
          entries.splice(i, 1);
          purgedCount++;
        }
      }

      return purgedCount;
    },
  };
}
