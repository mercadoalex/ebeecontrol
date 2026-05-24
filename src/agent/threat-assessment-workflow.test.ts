import { describe, it, expect, vi } from "vitest";
import {
  createThreatAssessmentWorkflow,
  ThreatAssessmentDependencies,
  PodContextProvider,
} from "./threat-assessment-workflow";
import { AccessEvent, PodContext } from "../types/index";
import { ThreatClassification } from "./threat-classifier";

function createTestEvent(overrides: Partial<AccessEvent> = {}): AccessEvent {
  return {
    eventId: "evt-001",
    processId: 1234,
    processBinaryPath: "/usr/bin/cat",
    userId: 1000,
    podId: "pod-abc",
    namespace: "production",
    honeytokenPath: "/etc/secrets/token.json",
    accessType: "read",
    timestamp: "2024-01-15T10:00:00.000Z",
    ...overrides,
  };
}

function createTestPodContext(overrides: Partial<PodContext> = {}): PodContext {
  return {
    namespace: "production",
    namespaceClassification: "production",
    serviceCriticality: 3,
    davisAnomalyScore: 0.5,
    anomalyWindowMinutes: 10,
    ...overrides,
  };
}

function createTestDependencies(
  overrides: Partial<ThreatAssessmentDependencies> = {}
): ThreatAssessmentDependencies {
  return {
    podContextProvider: {
      getPodContext: vi.fn().mockResolvedValue(createTestPodContext()),
    },
    classifyThreat: vi.fn().mockReturnValue("medium" as ThreatClassification),
    classifyThreatWithDefaults: vi
      .fn()
      .mockReturnValue("critical" as ThreatClassification),
    generateId: vi.fn().mockReturnValue("assessment-uuid-001"),
    now: vi.fn().mockReturnValue(new Date("2024-01-15T10:00:01.000Z")),
    ...overrides,
  };
}

describe("ThreatAssessmentWorkflow", () => {
  describe("assessThreat", () => {
    it("should query Dynatrace for pod context using event podId and namespace", async () => {
      const deps = createTestDependencies();
      const workflow = createThreatAssessmentWorkflow(deps);
      const event = createTestEvent({
        podId: "pod-xyz",
        namespace: "staging",
      });

      await workflow.assessThreat(event);

      expect(deps.podContextProvider.getPodContext).toHaveBeenCalledWith(
        "pod-xyz",
        "staging"
      );
    });

    it("should classify threat using classifyThreat when context is available", async () => {
      const context = createTestPodContext({
        namespaceClassification: "production",
        serviceCriticality: 4,
        davisAnomalyScore: 0.7,
      });
      const deps = createTestDependencies({
        podContextProvider: {
          getPodContext: vi.fn().mockResolvedValue(context),
        },
        classifyThreat: vi.fn().mockReturnValue("high" as ThreatClassification),
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      expect(deps.classifyThreat).toHaveBeenCalledWith(context);
      expect(result.classification).toBe("high");
    });

    it("should use classifyThreatWithDefaults when context is null (timeout)", async () => {
      const deps = createTestDependencies({
        podContextProvider: {
          getPodContext: vi.fn().mockResolvedValue(null),
        },
        classifyThreatWithDefaults: vi
          .fn()
          .mockReturnValue("critical" as ThreatClassification),
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      expect(deps.classifyThreatWithDefaults).toHaveBeenCalledWith({});
      expect(result.classification).toBe("critical");
    });

    it("should return highest-risk default inputs when context is null", async () => {
      const deps = createTestDependencies({
        podContextProvider: {
          getPodContext: vi.fn().mockResolvedValue(null),
        },
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      expect(result.inputs).toEqual({
        namespaceClassification: "production",
        serviceCriticality: 5,
        davisAnomalyScore: 1.0,
      });
    });

    it("should return actual context inputs when context is available", async () => {
      const context = createTestPodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 2,
        davisAnomalyScore: 0.1,
      });
      const deps = createTestDependencies({
        podContextProvider: {
          getPodContext: vi.fn().mockResolvedValue(context),
        },
        classifyThreat: vi.fn().mockReturnValue("low" as ThreatClassification),
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      expect(result.inputs).toEqual({
        namespaceClassification: "non-production",
        serviceCriticality: 2,
        davisAnomalyScore: 0.1,
      });
    });

    it("should generate a unique assessment ID", async () => {
      const deps = createTestDependencies({
        generateId: vi.fn().mockReturnValue("unique-uuid-123"),
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      expect(result.assessmentId).toBe("unique-uuid-123");
    });

    it("should include the access event ID in the assessment", async () => {
      const deps = createTestDependencies();
      const workflow = createThreatAssessmentWorkflow(deps);
      const event = createTestEvent({ eventId: "evt-specific-42" });

      const result = await workflow.assessThreat(event);

      expect(result.accessEventId).toBe("evt-specific-42");
    });

    it("should include an ISO 8601 assessment timestamp", async () => {
      const fixedDate = new Date("2024-03-20T14:30:00.500Z");
      const deps = createTestDependencies({
        now: vi.fn().mockReturnValue(fixedDate),
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      expect(result.assessmentTimestamp).toBe("2024-03-20T14:30:00.500Z");
    });

    it("should track assessment latency in milliseconds", async () => {
      let callCount = 0;
      const startTime = new Date("2024-01-15T10:00:00.000Z");
      const endTime = new Date("2024-01-15T10:00:01.500Z"); // 1500ms later

      const deps = createTestDependencies({
        now: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? startTime : endTime;
        }),
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      expect(result.assessmentLatencyMs).toBe(1500);
    });

    it("should not call classifyThreat when context is null", async () => {
      const deps = createTestDependencies({
        podContextProvider: {
          getPodContext: vi.fn().mockResolvedValue(null),
        },
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      await workflow.assessThreat(createTestEvent());

      expect(deps.classifyThreat).not.toHaveBeenCalled();
    });

    it("should not call classifyThreatWithDefaults when context is available", async () => {
      const deps = createTestDependencies({
        podContextProvider: {
          getPodContext: vi.fn().mockResolvedValue(createTestPodContext()),
        },
      });
      const workflow = createThreatAssessmentWorkflow(deps);

      await workflow.assessThreat(createTestEvent());

      expect(deps.classifyThreatWithDefaults).not.toHaveBeenCalled();
    });

    it("should use default uuid generator when generateId is not provided", async () => {
      const deps = createTestDependencies();
      delete (deps as any).generateId;
      const workflow = createThreatAssessmentWorkflow(deps);

      const result = await workflow.assessThreat(createTestEvent());

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(result.assessmentId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it("should use default Date when now is not provided", async () => {
      const deps = createTestDependencies();
      delete (deps as any).now;
      const workflow = createThreatAssessmentWorkflow(deps);

      const before = Date.now();
      const result = await workflow.assessThreat(createTestEvent());
      const after = Date.now();

      const assessmentTime = new Date(result.assessmentTimestamp).getTime();
      expect(assessmentTime).toBeGreaterThanOrEqual(before);
      expect(assessmentTime).toBeLessThanOrEqual(after);
    });

    it("should produce a complete ThreatAssessment structure", async () => {
      const deps = createTestDependencies({
        podContextProvider: {
          getPodContext: vi.fn().mockResolvedValue(
            createTestPodContext({
              namespaceClassification: "production",
              serviceCriticality: 5,
              davisAnomalyScore: 0.9,
            })
          ),
        },
        classifyThreat: vi
          .fn()
          .mockReturnValue("critical" as ThreatClassification),
        generateId: vi.fn().mockReturnValue("assess-uuid-999"),
        now: vi.fn().mockReturnValue(new Date("2024-06-01T12:00:00.000Z")),
      });
      const workflow = createThreatAssessmentWorkflow(deps);
      const event = createTestEvent({ eventId: "evt-complete-test" });

      const result = await workflow.assessThreat(event);

      expect(result).toEqual({
        assessmentId: "assess-uuid-999",
        accessEventId: "evt-complete-test",
        classification: "critical",
        inputs: {
          namespaceClassification: "production",
          serviceCriticality: 5,
          davisAnomalyScore: 0.9,
        },
        assessmentTimestamp: "2024-06-01T12:00:00.000Z",
        assessmentLatencyMs: 0,
      });
    });
  });
});
