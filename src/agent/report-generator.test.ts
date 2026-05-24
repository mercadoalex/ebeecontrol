import { describe, it, expect, vi } from "vitest";
import {
  createReportGenerator,
  buildPrompt,
  ReportGeneratorConfig,
  GeminiGenerateFn,
  IncidentData,
} from "./report-generator";
import { AccessEvent, ThreatAssessment, ResponseAction } from "../types/index";

function makeAccessEvent(overrides?: Partial<AccessEvent>): AccessEvent {
  return {
    eventId: "event-001",
    processId: 1234,
    processBinaryPath: "/usr/bin/cat",
    userId: 1000,
    podId: "pod-abc-123",
    namespace: "production",
    honeytokenPath: "/etc/secrets/decoy-token",
    accessType: "read",
    timestamp: "2024-01-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeThreatAssessment(
  overrides?: Partial<ThreatAssessment>
): ThreatAssessment {
  return {
    assessmentId: "assessment-001",
    accessEventId: "event-001",
    classification: "high",
    inputs: {
      namespaceClassification: "production",
      serviceCriticality: 4,
      davisAnomalyScore: 0.75,
    },
    assessmentTimestamp: "2024-01-15T10:00:01.000Z",
    assessmentLatencyMs: 150,
    ...overrides,
  };
}

function makeResponseAction(
  overrides?: Partial<ResponseAction>
): ResponseAction {
  return {
    actionId: "action-001",
    actionType: "pod_isolation",
    target: "pod-abc-123",
    timestamp: "2024-01-15T10:00:02.000Z",
    threatClassification: "high",
    result: "success",
    retryCount: 0,
    ...overrides,
  };
}

function makeIncidentData(overrides?: Partial<IncidentData>): IncidentData {
  return {
    accessEvent: makeAccessEvent(),
    threatAssessment: makeThreatAssessment(),
    responseActions: [
      makeResponseAction(),
      makeResponseAction({
        actionId: "action-002",
        actionType: "ip_block",
        target: "pod-abc-123",
        timestamp: "2024-01-15T10:00:03.000Z",
      }),
    ],
    ...overrides,
  };
}

function makeSuccessGemini(): GeminiGenerateFn {
  return vi.fn().mockResolvedValue("Gemini response: report generated");
}

describe("createReportGenerator", () => {
  describe("generate", () => {
    it("should generate a report with a unique UUID", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.reportId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should include a generation timestamp in ISO 8601 format", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(new Date(report.generationTimestamp).toISOString()).toBe(
        report.generationTimestamp
      );
    });

    it("should associate the report with the triggering access event", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData({
        accessEvent: makeAccessEvent({ eventId: "event-xyz-999" }),
      });

      const report = await generator.generate(incident);

      expect(report.triggeringAccessEventId).toBe("event-xyz-999");
    });

    it("should use default retention of 90 days", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.retentionDays).toBe(90);
    });

    it("should use custom retention when configured", async () => {
      const generator = createReportGenerator(makeSuccessGemini(), {
        retentionDays: 180,
      });
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.retentionDays).toBe(180);
    });

    it("should include complete access event details", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.accessEventDetails).toEqual({
        processId: 1234,
        userId: 1000,
        podId: "pod-abc-123",
        namespace: "production",
        honeytokenPath: "/etc/secrets/decoy-token",
        accessType: "read",
        timestamp: "2024-01-15T10:00:00.000Z",
      });
    });

    it("should include contextual assessment", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.contextualAssessment).toEqual({
        threatClassification: "high",
        podCriticality: 4,
        anomalyScore: 0.75,
      });
    });

    it("should include all response actions", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.responseActions).toHaveLength(2);
      expect(report.responseActions[0]).toEqual({
        actionType: "pod_isolation",
        target: "pod-abc-123",
        timestamp: "2024-01-15T10:00:02.000Z",
        result: "success",
      });
      expect(report.responseActions[1]).toEqual({
        actionType: "ip_block",
        target: "pod-abc-123",
        timestamp: "2024-01-15T10:00:03.000Z",
        result: "success",
      });
    });

    it("should include a chronological timeline with at least 2 entries", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.timeline.length).toBeGreaterThanOrEqual(2);
      // First entry should be the access event
      expect(report.timeline[0].timestamp).toBe("2024-01-15T10:00:00.000Z");
      // Second entry should be the assessment
      expect(report.timeline[1].timestamp).toBe("2024-01-15T10:00:01.000Z");
    });

    it("should include at least one recommended follow-up action", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.recommendedFollowUpActions.length).toBeGreaterThanOrEqual(
        1
      );
    });

    it("should include more follow-up actions for critical threats", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData({
        threatAssessment: makeThreatAssessment({ classification: "critical" }),
      });

      const report = await generator.generate(incident);

      expect(report.recommendedFollowUpActions.length).toBeGreaterThanOrEqual(
        2
      );
    });

    it("should recommend investigating failed actions when present", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData({
        responseActions: [
          makeResponseAction({ result: "failure" }),
        ],
      });

      const report = await generator.generate(incident);

      const hasFailedActionRecommendation =
        report.recommendedFollowUpActions.some((a) =>
          a.toLowerCase().includes("failed")
        );
      expect(hasFailedActionRecommendation).toBe(true);
    });

    it("should store the generated report", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(generator.getStoredReports()).toHaveLength(1);
      expect(generator.getStoredReports()[0].reportId).toBe(report.reportId);
    });

    it("should generate unique IDs for multiple reports", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report1 = await generator.generate(incident);
      const report2 = await generator.generate(incident);

      expect(report1.reportId).not.toBe(report2.reportId);
    });
  });

  describe("retry logic", () => {
    it("should retry on Gemini failure up to maxRetries times", async () => {
      const gemini = vi
        .fn()
        .mockRejectedValueOnce(new Error("Gemini unavailable"))
        .mockRejectedValueOnce(new Error("Gemini unavailable"))
        .mockResolvedValueOnce("Success response");

      const generator = createReportGenerator(gemini, {
        retryIntervalSeconds: 0.01, // fast retries for testing
      });
      const incident = makeIncidentData();

      const report = await generator.generate(incident);

      expect(report.reportId).toBeDefined();
      expect(gemini).toHaveBeenCalledTimes(3);
    });

    it("should throw after exhausting all retries", async () => {
      const gemini = vi
        .fn()
        .mockRejectedValue(new Error("Gemini permanently unavailable"));

      const generator = createReportGenerator(gemini, {
        maxRetries: 3,
        retryIntervalSeconds: 0.01,
      });
      const incident = makeIncidentData();

      await expect(generator.generate(incident)).rejects.toThrow(
        "Gemini permanently unavailable"
      );
      // 1 initial + 3 retries = 4 total calls
      expect(gemini).toHaveBeenCalledTimes(4);
    });

    it("should not retry if first attempt succeeds", async () => {
      const gemini = makeSuccessGemini();
      const generator = createReportGenerator(gemini);
      const incident = makeIncidentData();

      await generator.generate(incident);

      expect(gemini).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout", () => {
    it("should reject if Gemini exceeds the generation timeout", async () => {
      const gemini = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
      );

      const generator = createReportGenerator(gemini, {
        generationTimeoutSeconds: 0.05, // 50ms timeout for testing
        maxRetries: 0,
        retryIntervalSeconds: 0.01,
      });
      const incident = makeIncidentData();

      await expect(generator.generate(incident)).rejects.toThrow(
        /timed out/
      );
    });
  });

  describe("getStoredReports", () => {
    it("should return empty array when no reports generated", () => {
      const generator = createReportGenerator(makeSuccessGemini());

      expect(generator.getStoredReports()).toEqual([]);
    });

    it("should return all generated reports", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      await generator.generate(incident);
      await generator.generate(incident);
      await generator.generate(incident);

      expect(generator.getStoredReports()).toHaveLength(3);
    });

    it("should return a copy (not a reference to internal storage)", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      await generator.generate(incident);
      const reports = generator.getStoredReports();
      reports.pop();

      expect(generator.getStoredReports()).toHaveLength(1);
    });
  });

  describe("getReportById", () => {
    it("should return undefined for non-existent report ID", () => {
      const generator = createReportGenerator(makeSuccessGemini());

      expect(generator.getReportById("non-existent")).toBeUndefined();
    });

    it("should return the correct report by ID", async () => {
      const generator = createReportGenerator(makeSuccessGemini());
      const incident = makeIncidentData();

      const report = await generator.generate(incident);
      const found = generator.getReportById(report.reportId);

      expect(found).toBeDefined();
      expect(found!.reportId).toBe(report.reportId);
      expect(found!.triggeringAccessEventId).toBe("event-001");
    });
  });
});

describe("buildPrompt", () => {
  it("should include access event details in the prompt", () => {
    const incident = makeIncidentData();
    const prompt = buildPrompt(incident);

    expect(prompt).toContain("event-001");
    expect(prompt).toContain("1234");
    expect(prompt).toContain("/usr/bin/cat");
    expect(prompt).toContain("pod-abc-123");
    expect(prompt).toContain("production");
    expect(prompt).toContain("/etc/secrets/decoy-token");
    expect(prompt).toContain("read");
  });

  it("should include threat assessment details in the prompt", () => {
    const incident = makeIncidentData();
    const prompt = buildPrompt(incident);

    expect(prompt).toContain("high");
    expect(prompt).toContain("4");
    expect(prompt).toContain("0.75");
  });

  it("should include response actions in the prompt", () => {
    const incident = makeIncidentData();
    const prompt = buildPrompt(incident);

    expect(prompt).toContain("pod_isolation");
    expect(prompt).toContain("ip_block");
    expect(prompt).toContain("success");
  });
});
