import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executeResponse,
  ResponseExecutorDependencies,
  ResponseExecutionResult,
} from "./response-executor";
import { ResponsePlan } from "./response-planner";
import { ThreatAssessment } from "../types/index";
import { createAuditLog, AuditLog } from "./audit-log";

function createMockDeps(
  overrides: Partial<ResponseExecutorDependencies> = {}
): ResponseExecutorDependencies {
  return {
    isolatePod: vi.fn().mockResolvedValue(undefined),
    blockIp: vi.fn().mockResolvedValue(undefined),
    deployHoneytokens: vi.fn().mockResolvedValue(undefined),
    sendAlert: vi.fn().mockResolvedValue(undefined),
    auditLog: createAuditLog(),
    ...overrides,
  };
}

function createHighThreatPlan(): ResponsePlan {
  return {
    assessmentId: "assess-1",
    classification: "high",
    namespace: "production-ns",
    podId: "pod-123",
    actions: [
      { actionType: "pod_isolation", target: "pod-123", priority: 1 },
      { actionType: "ip_block", target: "pod-123", priority: 2 },
      {
        actionType: "additional_honeytokens",
        target: "production-ns",
        priority: 3,
      },
    ],
  };
}

function createMediumThreatPlan(): ResponsePlan {
  return {
    assessmentId: "assess-2",
    classification: "medium",
    namespace: "staging-ns",
    podId: "pod-456",
    actions: [
      {
        actionType: "additional_honeytokens",
        target: "staging-ns",
        priority: 1,
      },
    ],
  };
}

function createAssessment(
  classification: "low" | "medium" | "high" | "critical" = "high"
): ThreatAssessment {
  return {
    assessmentId: "assess-1",
    accessEventId: "event-1",
    classification,
    inputs: {
      namespaceClassification: "production",
      serviceCriticality: 4,
      davisAnomalyScore: 0.7,
    },
    assessmentTimestamp: new Date().toISOString(),
    assessmentLatencyMs: 150,
  };
}

describe("response-executor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("executeResponse", () => {
    it("should execute all actions in priority order for high threat", async () => {
      const deps = createMockDeps();
      const plan = createHighThreatPlan();
      const assessment = createAssessment("high");

      const result = await executeResponse(plan, assessment, deps);

      expect(result.allSucceeded).toBe(true);
      expect(result.actions).toHaveLength(3);
      expect(result.criticalFailures).toHaveLength(0);

      // Verify actions were executed in priority order
      expect(result.actions[0].actionType).toBe("pod_isolation");
      expect(result.actions[1].actionType).toBe("ip_block");
      expect(result.actions[2].actionType).toBe("additional_honeytokens");

      // Verify dependencies were called
      expect(deps.isolatePod).toHaveBeenCalledWith("pod-123");
      expect(deps.blockIp).toHaveBeenCalledWith("pod-123");
      expect(deps.deployHoneytokens).toHaveBeenCalledWith("production-ns", 2);
    });

    it("should execute only honeytoken deployment for medium threat", async () => {
      const deps = createMockDeps();
      const plan = createMediumThreatPlan();
      const assessment = createAssessment("medium");

      const result = await executeResponse(plan, assessment, deps);

      expect(result.allSucceeded).toBe(true);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].actionType).toBe("additional_honeytokens");
      expect(deps.isolatePod).not.toHaveBeenCalled();
      expect(deps.blockIp).not.toHaveBeenCalled();
      expect(deps.deployHoneytokens).toHaveBeenCalledWith("staging-ns", 2);
    });

    it("should return empty actions for empty plan", async () => {
      const deps = createMockDeps();
      const plan: ResponsePlan = {
        assessmentId: "assess-3",
        classification: "low",
        namespace: "dev-ns",
        podId: "pod-789",
        actions: [],
      };
      const assessment = createAssessment("low");

      const result = await executeResponse(plan, assessment, deps);

      expect(result.allSucceeded).toBe(true);
      expect(result.actions).toHaveLength(0);
      expect(result.criticalFailures).toHaveLength(0);
    });

    it("should log each action to the audit log", async () => {
      const auditLog = createAuditLog();
      const deps = createMockDeps({ auditLog });
      const plan = createHighThreatPlan();
      const assessment = createAssessment("high");

      await executeResponse(plan, assessment, deps);

      const entries = auditLog.getByType("response");
      expect(entries).toHaveLength(3);

      // Verify audit log entries contain required fields
      for (const entry of entries) {
        expect(entry.decisionType).toBe("response");
        expect(entry.decisionRationale).toContain("high");
        expect(entry.inputDataSummary).toContain("classification=high");
        expect(entry.outcome).toMatch(/success|failure/);
      }
    });

    it("should include action type and target in each ResponseAction", async () => {
      const deps = createMockDeps();
      const plan = createHighThreatPlan();
      const assessment = createAssessment("high");

      const result = await executeResponse(plan, assessment, deps);

      for (const action of result.actions) {
        expect(action.actionId).toBeTruthy();
        expect(action.actionType).toBeTruthy();
        expect(action.target).toBeTruthy();
        expect(action.timestamp).toBeTruthy();
        expect(action.threatClassification).toBe("high");
        expect(action.result).toBe("success");
        expect(action.retryCount).toBe(0);
      }
    });
  });

  describe("pod isolation retry behavior", () => {
    it("should retry pod isolation up to 3 times on failure", async () => {
      const isolatePod = vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"));

      const deps = createMockDeps({ isolatePod });
      const plan: ResponsePlan = {
        assessmentId: "assess-1",
        classification: "high",
        namespace: "ns",
        podId: "pod-1",
        actions: [
          { actionType: "pod_isolation", target: "pod-1", priority: 1 },
        ],
      };
      const assessment = createAssessment("high");

      const resultPromise = executeResponse(plan, assessment, deps);
      // Advance timers for 3 retry intervals (5s each)
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      // 1 initial + 3 retries = 4 calls total
      expect(isolatePod).toHaveBeenCalledTimes(4);
      expect(result.actions[0].result).toBe("failure");
      expect(result.actions[0].retryCount).toBe(3);
      expect(result.allSucceeded).toBe(false);
    });

    it("should succeed on retry if isolation eventually works", async () => {
      const isolatePod = vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(undefined);

      const deps = createMockDeps({ isolatePod });
      const plan: ResponsePlan = {
        assessmentId: "assess-1",
        classification: "high",
        namespace: "ns",
        podId: "pod-1",
        actions: [
          { actionType: "pod_isolation", target: "pod-1", priority: 1 },
        ],
      };
      const assessment = createAssessment("high");

      const resultPromise = executeResponse(plan, assessment, deps);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(isolatePod).toHaveBeenCalledTimes(3);
      expect(result.actions[0].result).toBe("success");
      expect(result.actions[0].retryCount).toBe(2);
    });

    it("should send alert on each pod isolation failure", async () => {
      const isolatePod = vi
        .fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce(undefined);

      const sendAlert = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ isolatePod, sendAlert });
      const plan: ResponsePlan = {
        assessmentId: "assess-1",
        classification: "high",
        namespace: "ns",
        podId: "pod-1",
        actions: [
          { actionType: "pod_isolation", target: "pod-1", priority: 1 },
        ],
      };
      const assessment = createAssessment("high");

      const resultPromise = executeResponse(plan, assessment, deps);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      await resultPromise;

      // 2 retry alerts (one for each failed attempt before success)
      expect(sendAlert).toHaveBeenCalledTimes(2);
      expect(sendAlert).toHaveBeenCalledWith(
        expect.stringContaining("Pod isolation failed")
      );
    });

    it("should send critical alert when all pod isolation retries exhausted", async () => {
      const isolatePod = vi
        .fn()
        .mockRejectedValue(new Error("persistent failure"));

      const sendAlert = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ isolatePod, sendAlert });
      const plan: ResponsePlan = {
        assessmentId: "assess-1",
        classification: "critical",
        namespace: "ns",
        podId: "pod-1",
        actions: [
          { actionType: "pod_isolation", target: "pod-1", priority: 1 },
        ],
      };
      const assessment = createAssessment("critical");

      const resultPromise = executeResponse(plan, assessment, deps);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result.criticalFailures).toHaveLength(1);
      expect(result.criticalFailures[0]).toContain("Pod isolation failed");

      // Should have retry alerts + critical alert
      const criticalAlertCall = sendAlert.mock.calls.find((call) =>
        (call[0] as string).includes("CRITICAL")
      );
      expect(criticalAlertCall).toBeDefined();
      expect(criticalAlertCall![0]).toContain("Manual intervention required");
    });
  });

  describe("IP block retry behavior", () => {
    it("should retry IP block up to 3 times on failure", async () => {
      const blockIp = vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"));

      const deps = createMockDeps({ blockIp });
      const plan: ResponsePlan = {
        assessmentId: "assess-1",
        classification: "high",
        namespace: "ns",
        podId: "pod-1",
        actions: [{ actionType: "ip_block", target: "pod-1", priority: 1 }],
      };
      const assessment = createAssessment("high");

      const resultPromise = executeResponse(plan, assessment, deps);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      // 1 initial + 3 retries = 4 calls total
      expect(blockIp).toHaveBeenCalledTimes(4);
      expect(result.actions[0].result).toBe("failure");
      expect(result.actions[0].retryCount).toBe(3);
    });

    it("should send alert on each IP block failure", async () => {
      const blockIp = vi
        .fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce(undefined);

      const sendAlert = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ blockIp, sendAlert });
      const plan: ResponsePlan = {
        assessmentId: "assess-1",
        classification: "high",
        namespace: "ns",
        podId: "pod-1",
        actions: [{ actionType: "ip_block", target: "pod-1", priority: 1 }],
      };
      const assessment = createAssessment("high");

      const resultPromise = executeResponse(plan, assessment, deps);
      await vi.advanceTimersByTimeAsync(5000);

      await resultPromise;

      expect(sendAlert).toHaveBeenCalledTimes(1);
      expect(sendAlert).toHaveBeenCalledWith(
        expect.stringContaining("IP block failed")
      );
    });

    it("should succeed on retry if IP block eventually works", async () => {
      const blockIp = vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(undefined);

      const deps = createMockDeps({ blockIp });
      const plan: ResponsePlan = {
        assessmentId: "assess-1",
        classification: "high",
        namespace: "ns",
        podId: "pod-1",
        actions: [{ actionType: "ip_block", target: "pod-1", priority: 1 }],
      };
      const assessment = createAssessment("high");

      const resultPromise = executeResponse(plan, assessment, deps);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(blockIp).toHaveBeenCalledTimes(2);
      expect(result.actions[0].result).toBe("success");
      expect(result.actions[0].retryCount).toBe(1);
    });
  });

  describe("honeytoken deployment", () => {
    it("should deploy at least 2 honeytokens in the namespace", async () => {
      const deployHoneytokens = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ deployHoneytokens });
      const plan = createMediumThreatPlan();
      const assessment = createAssessment("medium");

      const result = await executeResponse(plan, assessment, deps);

      expect(deployHoneytokens).toHaveBeenCalledWith("staging-ns", 2);
      expect(result.actions[0].result).toBe("success");
    });

    it("should report failure if honeytoken deployment fails", async () => {
      const deployHoneytokens = vi
        .fn()
        .mockRejectedValue(new Error("deployment failed"));

      const deps = createMockDeps({ deployHoneytokens });
      const plan = createMediumThreatPlan();
      const assessment = createAssessment("medium");

      const result = await executeResponse(plan, assessment, deps);

      expect(result.actions[0].result).toBe("failure");
      expect(result.allSucceeded).toBe(false);
    });
  });

  describe("mixed success/failure scenarios", () => {
    it("should continue executing remaining actions after one fails", async () => {
      const isolatePod = vi
        .fn()
        .mockRejectedValue(new Error("persistent failure"));
      const blockIp = vi.fn().mockResolvedValue(undefined);
      const deployHoneytokens = vi.fn().mockResolvedValue(undefined);

      const deps = createMockDeps({
        isolatePod,
        blockIp,
        deployHoneytokens,
      });
      const plan = createHighThreatPlan();
      const assessment = createAssessment("high");

      const resultPromise = executeResponse(plan, assessment, deps);
      // Advance timers for pod isolation retries (3 retries * 5s)
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result.allSucceeded).toBe(false);
      expect(result.actions).toHaveLength(3);
      expect(result.actions[0].result).toBe("failure"); // pod_isolation
      expect(result.actions[1].result).toBe("success"); // ip_block
      expect(result.actions[2].result).toBe("success"); // honeytokens
    });

    it("should report allSucceeded=false if any action fails", async () => {
      const deployHoneytokens = vi
        .fn()
        .mockRejectedValue(new Error("failed"));

      const deps = createMockDeps({ deployHoneytokens });
      const plan = createHighThreatPlan();
      const assessment = createAssessment("high");

      const result = await executeResponse(plan, assessment, deps);

      expect(result.allSucceeded).toBe(false);
    });
  });

  describe("action metadata", () => {
    it("should assign unique actionIds to each action", async () => {
      const deps = createMockDeps();
      const plan = createHighThreatPlan();
      const assessment = createAssessment("high");

      const result = await executeResponse(plan, assessment, deps);

      const ids = result.actions.map((a) => a.actionId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should include the threat classification in each action", async () => {
      const deps = createMockDeps();
      const plan = createHighThreatPlan();
      const assessment = createAssessment("critical");

      const result = await executeResponse(plan, assessment, deps);

      for (const action of result.actions) {
        expect(action.threatClassification).toBe("critical");
      }
    });

    it("should include valid ISO timestamps in each action", async () => {
      const deps = createMockDeps();
      const plan = createHighThreatPlan();
      const assessment = createAssessment("high");

      const result = await executeResponse(plan, assessment, deps);

      for (const action of result.actions) {
        const date = new Date(action.timestamp);
        expect(date.toISOString()).toBe(action.timestamp);
      }
    });
  });
});
