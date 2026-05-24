import { describe, it, expect } from "vitest";
import {
  generateResponsePlan,
  ResponsePlan,
  PlannedAction,
  ResponseContext,
} from "./response-planner";
import { ThreatAssessment } from "../types/index";
import { ThreatClassification } from "./threat-classifier";

function makeThreatAssessment(
  classification: ThreatClassification,
  overrides?: Partial<ThreatAssessment>
): ThreatAssessment {
  return {
    assessmentId: "assessment-001",
    accessEventId: "event-001",
    classification,
    inputs: {
      namespaceClassification: "production",
      serviceCriticality: 3,
      davisAnomalyScore: 0.5,
    },
    assessmentTimestamp: "2024-01-15T10:00:00.000Z",
    assessmentLatencyMs: 150,
    ...overrides,
  };
}

const defaultContext: ResponseContext = {
  namespace: "production-ns",
  podId: "pod-abc-123",
};

describe("generateResponsePlan", () => {
  describe("low classification", () => {
    it("should return an empty actions array for low threats", () => {
      const assessment = makeThreatAssessment("low");
      const plan = generateResponsePlan(assessment, defaultContext);

      expect(plan.actions).toEqual([]);
    });

    it("should include correct metadata for low threats", () => {
      const assessment = makeThreatAssessment("low", {
        assessmentId: "low-assessment-42",
      });
      const plan = generateResponsePlan(assessment, defaultContext);

      expect(plan.assessmentId).toBe("low-assessment-42");
      expect(plan.classification).toBe("low");
      expect(plan.namespace).toBe("production-ns");
      expect(plan.podId).toBe("pod-abc-123");
    });
  });

  describe("medium classification", () => {
    it("should include additional honeytokens action for medium threats", () => {
      const assessment = makeThreatAssessment("medium");
      const plan = generateResponsePlan(assessment, defaultContext);

      const honeytokenActions = plan.actions.filter(
        (a) => a.actionType === "additional_honeytokens"
      );
      expect(honeytokenActions.length).toBeGreaterThanOrEqual(1);
    });

    it("should target the same namespace for honeytoken deployment", () => {
      const assessment = makeThreatAssessment("medium");
      const plan = generateResponsePlan(assessment, defaultContext);

      const honeytokenAction = plan.actions.find(
        (a) => a.actionType === "additional_honeytokens"
      );
      expect(honeytokenAction).toBeDefined();
      expect(honeytokenAction!.target).toBe("production-ns");
    });

    it("should NOT include pod isolation for medium threats", () => {
      const assessment = makeThreatAssessment("medium");
      const plan = generateResponsePlan(assessment, defaultContext);

      const isolationActions = plan.actions.filter(
        (a) => a.actionType === "pod_isolation"
      );
      expect(isolationActions).toHaveLength(0);
    });

    it("should NOT include IP block for medium threats", () => {
      const assessment = makeThreatAssessment("medium");
      const plan = generateResponsePlan(assessment, defaultContext);

      const ipBlockActions = plan.actions.filter(
        (a) => a.actionType === "ip_block"
      );
      expect(ipBlockActions).toHaveLength(0);
    });

    it("should include correct metadata for medium threats", () => {
      const assessment = makeThreatAssessment("medium", {
        assessmentId: "med-assessment-99",
      });
      const context: ResponseContext = {
        namespace: "staging-ns",
        podId: "pod-xyz-789",
      };
      const plan = generateResponsePlan(assessment, context);

      expect(plan.assessmentId).toBe("med-assessment-99");
      expect(plan.classification).toBe("medium");
      expect(plan.namespace).toBe("staging-ns");
      expect(plan.podId).toBe("pod-xyz-789");
    });
  });

  describe("high classification", () => {
    it("should include pod isolation for high threats", () => {
      const assessment = makeThreatAssessment("high");
      const plan = generateResponsePlan(assessment, defaultContext);

      const isolationActions = plan.actions.filter(
        (a) => a.actionType === "pod_isolation"
      );
      expect(isolationActions).toHaveLength(1);
      expect(isolationActions[0].target).toBe("pod-abc-123");
    });

    it("should include IP block for high threats", () => {
      const assessment = makeThreatAssessment("high");
      const plan = generateResponsePlan(assessment, defaultContext);

      const ipBlockActions = plan.actions.filter(
        (a) => a.actionType === "ip_block"
      );
      expect(ipBlockActions).toHaveLength(1);
      expect(ipBlockActions[0].target).toBe("pod-abc-123");
    });

    it("should include additional honeytokens for high threats", () => {
      const assessment = makeThreatAssessment("high");
      const plan = generateResponsePlan(assessment, defaultContext);

      const honeytokenActions = plan.actions.filter(
        (a) => a.actionType === "additional_honeytokens"
      );
      expect(honeytokenActions.length).toBeGreaterThanOrEqual(1);
    });

    it("should target the same namespace for honeytoken deployment", () => {
      const assessment = makeThreatAssessment("high");
      const plan = generateResponsePlan(assessment, defaultContext);

      const honeytokenAction = plan.actions.find(
        (a) => a.actionType === "additional_honeytokens"
      );
      expect(honeytokenAction!.target).toBe("production-ns");
    });

    it("should prioritize pod isolation highest for high threats", () => {
      const assessment = makeThreatAssessment("high");
      const plan = generateResponsePlan(assessment, defaultContext);

      const isolation = plan.actions.find(
        (a) => a.actionType === "pod_isolation"
      );
      const ipBlock = plan.actions.find((a) => a.actionType === "ip_block");
      const honeytokens = plan.actions.find(
        (a) => a.actionType === "additional_honeytokens"
      );

      expect(isolation!.priority).toBeLessThan(ipBlock!.priority);
      expect(ipBlock!.priority).toBeLessThan(honeytokens!.priority);
    });
  });

  describe("critical classification", () => {
    it("should include pod isolation for critical threats", () => {
      const assessment = makeThreatAssessment("critical");
      const plan = generateResponsePlan(assessment, defaultContext);

      const isolationActions = plan.actions.filter(
        (a) => a.actionType === "pod_isolation"
      );
      expect(isolationActions).toHaveLength(1);
      expect(isolationActions[0].target).toBe("pod-abc-123");
    });

    it("should include IP block for critical threats", () => {
      const assessment = makeThreatAssessment("critical");
      const plan = generateResponsePlan(assessment, defaultContext);

      const ipBlockActions = plan.actions.filter(
        (a) => a.actionType === "ip_block"
      );
      expect(ipBlockActions).toHaveLength(1);
      expect(ipBlockActions[0].target).toBe("pod-abc-123");
    });

    it("should include additional honeytokens for critical threats", () => {
      const assessment = makeThreatAssessment("critical");
      const plan = generateResponsePlan(assessment, defaultContext);

      const honeytokenActions = plan.actions.filter(
        (a) => a.actionType === "additional_honeytokens"
      );
      expect(honeytokenActions.length).toBeGreaterThanOrEqual(1);
    });

    it("should have same action types as high classification", () => {
      const highPlan = generateResponsePlan(
        makeThreatAssessment("high"),
        defaultContext
      );
      const criticalPlan = generateResponsePlan(
        makeThreatAssessment("critical"),
        defaultContext
      );

      const highActionTypes = highPlan.actions
        .map((a) => a.actionType)
        .sort();
      const criticalActionTypes = criticalPlan.actions
        .map((a) => a.actionType)
        .sort();

      expect(criticalActionTypes).toEqual(highActionTypes);
    });
  });

  describe("context handling", () => {
    it("should use empty strings when no context is provided", () => {
      const assessment = makeThreatAssessment("low");
      const plan = generateResponsePlan(assessment);

      expect(plan.namespace).toBe("");
      expect(plan.podId).toBe("");
    });

    it("should use provided namespace and podId from context", () => {
      const assessment = makeThreatAssessment("medium");
      const context: ResponseContext = {
        namespace: "custom-namespace",
        podId: "custom-pod-id",
      };
      const plan = generateResponsePlan(assessment, context);

      expect(plan.namespace).toBe("custom-namespace");
      expect(plan.podId).toBe("custom-pod-id");
    });
  });

  describe("priority ordering", () => {
    it("should assign priorities in correct order for high/critical", () => {
      const assessment = makeThreatAssessment("critical");
      const plan = generateResponsePlan(assessment, defaultContext);

      const sorted = [...plan.actions].sort((a, b) => a.priority - b.priority);

      expect(sorted[0].actionType).toBe("pod_isolation");
      expect(sorted[1].actionType).toBe("ip_block");
      expect(sorted[2].actionType).toBe("additional_honeytokens");
    });

    it("should assign priority 1 to honeytoken deployment for medium", () => {
      const assessment = makeThreatAssessment("medium");
      const plan = generateResponsePlan(assessment, defaultContext);

      const honeytokenAction = plan.actions.find(
        (a) => a.actionType === "additional_honeytokens"
      );
      expect(honeytokenAction!.priority).toBe(1);
    });
  });
});
