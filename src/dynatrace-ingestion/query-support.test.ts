/**
 * Unit tests for the historical query support module.
 *
 * Validates: Requirements 9.9, 9.13, 9.14, 9.15
 */

import { describe, it, expect } from "vitest";
import {
  searchForensicReports,
  queryIncidentTimeline,
  ReportFilter,
  IncidentTimelineFilter,
  PaginatedResult,
} from "./query-support.js";
import { ForensicReport } from "../types/index.js";
import { IncidentTimelineLogPayload } from "../types/dynatrace-ingestion.js";

// --- Test Helpers ---

function makeForensicReport(overrides: Partial<{
  reportId: string;
  podId: string;
  namespace: string;
  threatClassification: "low" | "medium" | "high" | "critical";
}> = {}): ForensicReport {
  return {
    reportId: overrides.reportId ?? "report-001",
    generationTimestamp: "2024-06-01T12:00:00.000Z",
    triggeringAccessEventId: "event-001",
    retentionDays: 90,
    accessEventDetails: {
      processId: 1234,
      userId: 1000,
      podId: overrides.podId ?? "pod-alpha",
      namespace: overrides.namespace ?? "production",
      honeytokenPath: "/etc/secrets/token.key",
      accessType: "read",
      timestamp: "2024-06-01T11:59:00.000Z",
    },
    contextualAssessment: {
      threatClassification: overrides.threatClassification ?? "high",
      podCriticality: 4,
      anomalyScore: 0.75,
    },
    responseActions: [
      {
        actionType: "pod_isolation",
        target: "pod-alpha",
        timestamp: "2024-06-01T12:00:05.000Z",
        result: "success",
      },
    ],
    timeline: [
      {
        eventDescription: "Honeytoken access detected",
        timestamp: "2024-06-01T11:59:00.000Z",
      },
      {
        eventDescription: "Threat classified as high",
        timestamp: "2024-06-01T11:59:01.000Z",
      },
    ],
    recommendedFollowUpActions: ["Review incident details"],
  };
}

function makeIncident(overrides: Partial<{
  incidentId: string;
  timestamp: string;
  threatClassification: "low" | "medium" | "high" | "critical";
  namespace: string;
  finalOutcome: "contained" | "escalated" | "false_positive";
}> = {}): IncidentTimelineLogPayload {
  return {
    incidentId: overrides.incidentId ?? "incident-001",
    timestamp: overrides.timestamp ?? "2024-06-01T12:00:00.000Z",
    threatClassification: overrides.threatClassification ?? "high",
    affectedPodId: "pod-alpha",
    namespace: overrides.namespace ?? "production",
    responseActions: [
      { actionType: "pod_isolation", outcome: "success" },
    ],
    finalOutcome: overrides.finalOutcome ?? "contained",
  };
}

// --- searchForensicReports Tests ---

describe("searchForensicReports", () => {
  describe("text search", () => {
    it("should return all reports when no search text is provided", () => {
      const reports = [
        makeForensicReport({ reportId: "report-001" }),
        makeForensicReport({ reportId: "report-002" }),
      ];

      const result = searchForensicReports(reports, { page: 1 });

      expect(result.totalCount).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it("should filter by reportId (case-insensitive)", () => {
      const reports = [
        makeForensicReport({ reportId: "REPORT-ABC" }),
        makeForensicReport({ reportId: "report-xyz" }),
      ];

      const result = searchForensicReports(reports, {
        searchText: "abc",
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].reportId).toBe("REPORT-ABC");
    });

    it("should filter by podId (case-insensitive)", () => {
      const reports = [
        makeForensicReport({ podId: "Pod-Frontend" }),
        makeForensicReport({ podId: "pod-backend" }),
      ];

      const result = searchForensicReports(reports, {
        searchText: "frontend",
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].affectedPodId).toBe("Pod-Frontend");
    });

    it("should filter by namespace (case-insensitive)", () => {
      const reports = [
        makeForensicReport({ namespace: "kube-system" }),
        makeForensicReport({ namespace: "production" }),
      ];

      const result = searchForensicReports(reports, {
        searchText: "KUBE",
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].namespace).toBe("kube-system");
    });

    it("should match across multiple fields", () => {
      const reports = [
        makeForensicReport({ reportId: "alpha-report", podId: "pod-1", namespace: "ns-1" }),
        makeForensicReport({ reportId: "report-2", podId: "alpha-pod", namespace: "ns-2" }),
        makeForensicReport({ reportId: "report-3", podId: "pod-3", namespace: "alpha-ns" }),
        makeForensicReport({ reportId: "report-4", podId: "pod-4", namespace: "ns-4" }),
      ];

      const result = searchForensicReports(reports, {
        searchText: "alpha",
        page: 1,
      });

      expect(result.totalCount).toBe(3);
    });

    it("should return empty results when no match found", () => {
      const reports = [
        makeForensicReport({ reportId: "report-001", podId: "pod-a", namespace: "ns-a" }),
      ];

      const result = searchForensicReports(reports, {
        searchText: "nonexistent",
        page: 1,
      });

      expect(result.totalCount).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it("should treat empty search text as no filter", () => {
      const reports = [
        makeForensicReport({ reportId: "report-001" }),
        makeForensicReport({ reportId: "report-002" }),
      ];

      const result = searchForensicReports(reports, {
        searchText: "   ",
        page: 1,
      });

      expect(result.totalCount).toBe(2);
    });
  });

  describe("pagination", () => {
    it("should use default page size of 50", () => {
      const reports = Array.from({ length: 60 }, (_, i) =>
        makeForensicReport({ reportId: `report-${i}` })
      );

      const result = searchForensicReports(reports, { page: 1 });

      expect(result.pageSize).toBe(50);
      expect(result.items).toHaveLength(50);
      expect(result.totalPages).toBe(2);
    });

    it("should respect custom page size", () => {
      const reports = Array.from({ length: 10 }, (_, i) =>
        makeForensicReport({ reportId: `report-${i}` })
      );

      const result = searchForensicReports(reports, { page: 1, pageSize: 3 });

      expect(result.pageSize).toBe(3);
      expect(result.items).toHaveLength(3);
      expect(result.totalPages).toBe(4);
    });

    it("should return correct page of results", () => {
      const reports = Array.from({ length: 5 }, (_, i) =>
        makeForensicReport({ reportId: `report-${i}` })
      );

      const page2 = searchForensicReports(reports, { page: 2, pageSize: 2 });

      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].reportId).toBe("report-2");
      expect(page2.items[1].reportId).toBe("report-3");
    });

    it("should return partial last page", () => {
      const reports = Array.from({ length: 5 }, (_, i) =>
        makeForensicReport({ reportId: `report-${i}` })
      );

      const lastPage = searchForensicReports(reports, { page: 3, pageSize: 2 });

      expect(lastPage.items).toHaveLength(1);
      expect(lastPage.items[0].reportId).toBe("report-4");
    });

    it("should return empty items for page beyond total", () => {
      const reports = [makeForensicReport({ reportId: "report-0" })];

      const result = searchForensicReports(reports, { page: 5, pageSize: 10 });

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it("should treat page 0 or negative as page 1", () => {
      const reports = Array.from({ length: 3 }, (_, i) =>
        makeForensicReport({ reportId: `report-${i}` })
      );

      const result = searchForensicReports(reports, { page: 0, pageSize: 2 });

      expect(result.page).toBe(1);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].reportId).toBe("report-0");
    });
  });

  describe("payload conversion", () => {
    it("should correctly convert ForensicReport to ForensicReportLogPayload", () => {
      const report = makeForensicReport({
        reportId: "rpt-123",
        podId: "my-pod",
        namespace: "staging",
        threatClassification: "critical",
      });

      const result = searchForensicReports([report], { page: 1 });

      expect(result.items[0].reportId).toBe("rpt-123");
      expect(result.items[0].affectedPodId).toBe("my-pod");
      expect(result.items[0].namespace).toBe("staging");
      expect(result.items[0].threatClassification).toBe("critical");
      expect(result.items[0].generationTimestamp).toBe("2024-06-01T12:00:00.000Z");
      expect(result.items[0].reportContent).toContain("rpt-123");
    });
  });
});

// --- queryIncidentTimeline Tests ---

describe("queryIncidentTimeline", () => {
  describe("date range filtering", () => {
    it("should filter by dateRangeStart", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", timestamp: "2024-01-01T00:00:00.000Z" }),
        makeIncident({ incidentId: "i-2", timestamp: "2024-06-15T00:00:00.000Z" }),
        makeIncident({ incidentId: "i-3", timestamp: "2024-12-01T00:00:00.000Z" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        dateRangeStart: "2024-06-01T00:00:00.000Z",
        page: 1,
      });

      expect(result.totalCount).toBe(2);
      expect(result.items.map((i) => i.incidentId)).toEqual(["i-2", "i-3"]);
    });

    it("should filter by dateRangeEnd", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", timestamp: "2024-01-01T00:00:00.000Z" }),
        makeIncident({ incidentId: "i-2", timestamp: "2024-06-15T00:00:00.000Z" }),
        makeIncident({ incidentId: "i-3", timestamp: "2024-12-01T00:00:00.000Z" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        dateRangeEnd: "2024-06-30T00:00:00.000Z",
        page: 1,
      });

      expect(result.totalCount).toBe(2);
      expect(result.items.map((i) => i.incidentId)).toEqual(["i-1", "i-2"]);
    });

    it("should filter by both dateRangeStart and dateRangeEnd", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", timestamp: "2024-01-01T00:00:00.000Z" }),
        makeIncident({ incidentId: "i-2", timestamp: "2024-06-15T00:00:00.000Z" }),
        makeIncident({ incidentId: "i-3", timestamp: "2024-12-01T00:00:00.000Z" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        dateRangeStart: "2024-03-01T00:00:00.000Z",
        dateRangeEnd: "2024-09-01T00:00:00.000Z",
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].incidentId).toBe("i-2");
    });

    it("should include incidents exactly at range boundaries", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", timestamp: "2024-06-01T00:00:00.000Z" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        dateRangeStart: "2024-06-01T00:00:00.000Z",
        dateRangeEnd: "2024-06-01T00:00:00.000Z",
        page: 1,
      });

      expect(result.totalCount).toBe(1);
    });
  });

  describe("threat classification filtering", () => {
    it("should filter by single threat classification", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", threatClassification: "low" }),
        makeIncident({ incidentId: "i-2", threatClassification: "high" }),
        makeIncident({ incidentId: "i-3", threatClassification: "critical" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        threatClassification: ["high"],
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].incidentId).toBe("i-2");
    });

    it("should filter by multiple threat classifications", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", threatClassification: "low" }),
        makeIncident({ incidentId: "i-2", threatClassification: "high" }),
        makeIncident({ incidentId: "i-3", threatClassification: "critical" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        threatClassification: ["high", "critical"],
        page: 1,
      });

      expect(result.totalCount).toBe(2);
      expect(result.items.map((i) => i.incidentId)).toEqual(["i-2", "i-3"]);
    });

    it("should return all when threatClassification is empty array", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", threatClassification: "low" }),
        makeIncident({ incidentId: "i-2", threatClassification: "high" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        threatClassification: [],
        page: 1,
      });

      expect(result.totalCount).toBe(2);
    });
  });

  describe("namespace filtering", () => {
    it("should filter by namespace (exact match)", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", namespace: "production" }),
        makeIncident({ incidentId: "i-2", namespace: "staging" }),
        makeIncident({ incidentId: "i-3", namespace: "production" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        namespace: "staging",
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].incidentId).toBe("i-2");
    });

    it("should return all when namespace is not specified", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", namespace: "production" }),
        makeIncident({ incidentId: "i-2", namespace: "staging" }),
      ];

      const result = queryIncidentTimeline(incidents, { page: 1 });

      expect(result.totalCount).toBe(2);
    });
  });

  describe("response outcome filtering", () => {
    it("should filter by single response outcome", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", finalOutcome: "contained" }),
        makeIncident({ incidentId: "i-2", finalOutcome: "escalated" }),
        makeIncident({ incidentId: "i-3", finalOutcome: "false_positive" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        responseOutcome: ["escalated"],
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].incidentId).toBe("i-2");
    });

    it("should filter by multiple response outcomes", () => {
      const incidents = [
        makeIncident({ incidentId: "i-1", finalOutcome: "contained" }),
        makeIncident({ incidentId: "i-2", finalOutcome: "escalated" }),
        makeIncident({ incidentId: "i-3", finalOutcome: "false_positive" }),
      ];

      const result = queryIncidentTimeline(incidents, {
        responseOutcome: ["contained", "false_positive"],
        page: 1,
      });

      expect(result.totalCount).toBe(2);
      expect(result.items.map((i) => i.incidentId)).toEqual(["i-1", "i-3"]);
    });
  });

  describe("combined filters", () => {
    it("should apply all filters together", () => {
      const incidents = [
        makeIncident({
          incidentId: "i-1",
          timestamp: "2024-06-01T00:00:00.000Z",
          threatClassification: "high",
          namespace: "production",
          finalOutcome: "contained",
        }),
        makeIncident({
          incidentId: "i-2",
          timestamp: "2024-06-15T00:00:00.000Z",
          threatClassification: "critical",
          namespace: "production",
          finalOutcome: "escalated",
        }),
        makeIncident({
          incidentId: "i-3",
          timestamp: "2024-06-20T00:00:00.000Z",
          threatClassification: "high",
          namespace: "staging",
          finalOutcome: "contained",
        }),
        makeIncident({
          incidentId: "i-4",
          timestamp: "2024-07-01T00:00:00.000Z",
          threatClassification: "high",
          namespace: "production",
          finalOutcome: "contained",
        }),
      ];

      const result = queryIncidentTimeline(incidents, {
        dateRangeStart: "2024-06-01T00:00:00.000Z",
        dateRangeEnd: "2024-06-30T00:00:00.000Z",
        threatClassification: ["high"],
        namespace: "production",
        responseOutcome: ["contained"],
        page: 1,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].incidentId).toBe("i-1");
    });
  });

  describe("pagination", () => {
    it("should cap page size at 500", () => {
      const incidents = Array.from({ length: 10 }, (_, i) =>
        makeIncident({ incidentId: `i-${i}` })
      );

      const result = queryIncidentTimeline(incidents, {
        page: 1,
        pageSize: 1000,
      });

      expect(result.pageSize).toBe(500);
    });

    it("should use default page size of 500 when not specified", () => {
      const incidents = Array.from({ length: 600 }, (_, i) =>
        makeIncident({ incidentId: `i-${i}` })
      );

      const result = queryIncidentTimeline(incidents, { page: 1 });

      expect(result.pageSize).toBe(500);
      expect(result.items).toHaveLength(500);
      expect(result.totalPages).toBe(2);
    });

    it("should paginate correctly with custom page size", () => {
      const incidents = Array.from({ length: 10 }, (_, i) =>
        makeIncident({ incidentId: `i-${i}` })
      );

      const page1 = queryIncidentTimeline(incidents, { page: 1, pageSize: 3 });
      const page2 = queryIncidentTimeline(incidents, { page: 2, pageSize: 3 });

      expect(page1.items).toHaveLength(3);
      expect(page2.items).toHaveLength(3);
      expect(page1.items[0].incidentId).toBe("i-0");
      expect(page2.items[0].incidentId).toBe("i-3");
      expect(page1.totalPages).toBe(4);
    });

    it("should return empty items for page beyond total", () => {
      const incidents = [makeIncident({ incidentId: "i-0" })];

      const result = queryIncidentTimeline(incidents, { page: 10, pageSize: 5 });

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(1);
    });

    it("should treat page 0 or negative as page 1", () => {
      const incidents = Array.from({ length: 5 }, (_, i) =>
        makeIncident({ incidentId: `i-${i}` })
      );

      const result = queryIncidentTimeline(incidents, { page: -1, pageSize: 2 });

      expect(result.page).toBe(1);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].incidentId).toBe("i-0");
    });

    it("should return totalPages of 1 for empty results", () => {
      const result = queryIncidentTimeline([], { page: 1 });

      expect(result.totalCount).toBe(0);
      expect(result.totalPages).toBe(1);
      expect(result.items).toHaveLength(0);
    });
  });

  describe("no filters", () => {
    it("should return all incidents when no filters are applied", () => {
      const incidents = Array.from({ length: 3 }, (_, i) =>
        makeIncident({ incidentId: `i-${i}` })
      );

      const result = queryIncidentTimeline(incidents, { page: 1 });

      expect(result.totalCount).toBe(3);
      expect(result.items).toHaveLength(3);
    });
  });
});
