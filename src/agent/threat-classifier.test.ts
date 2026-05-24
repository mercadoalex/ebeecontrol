import { describe, it, expect } from "vitest";
import {
  classifyThreat,
  classifyThreatWithDefaults,
  ThreatClassification,
} from "./threat-classifier";
import { PodContext } from "../types/index";

function makePodContext(overrides: Partial<PodContext> = {}): PodContext {
  return {
    namespace: "default",
    namespaceClassification: "non-production",
    serviceCriticality: 1,
    davisAnomalyScore: 0.0,
    anomalyWindowMinutes: 10,
    ...overrides,
  };
}

describe("classifyThreat", () => {
  describe("low classification", () => {
    it("classifies as low: non-production, anomaly < 0.3, criticality 1", () => {
      const context = makePodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.1,
      });
      expect(classifyThreat(context)).toBe("low");
    });

    it("classifies as low: non-production, anomaly < 0.3, criticality 2", () => {
      const context = makePodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 2,
        davisAnomalyScore: 0.29,
      });
      expect(classifyThreat(context)).toBe("low");
    });

    it("classifies as low: non-production, anomaly 0.0, criticality 1", () => {
      const context = makePodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.0,
      });
      expect(classifyThreat(context)).toBe("low");
    });
  });

  describe("medium classification", () => {
    it("classifies as medium: production namespace with low anomaly and low criticality", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.1,
      });
      expect(classifyThreat(context)).toBe("medium");
    });

    it("classifies as medium: non-production with anomaly 0.3-0.6", () => {
      const context = makePodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.4,
      });
      expect(classifyThreat(context)).toBe("medium");
    });

    it("classifies as medium: non-production with criticality 3", () => {
      const context = makePodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 3,
        davisAnomalyScore: 0.1,
      });
      expect(classifyThreat(context)).toBe("medium");
    });

    it("classifies as medium: anomaly exactly 0.3", () => {
      const context = makePodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.3,
      });
      expect(classifyThreat(context)).toBe("medium");
    });

    it("classifies as medium: anomaly exactly 0.6", () => {
      const context = makePodContext({
        namespaceClassification: "non-production",
        serviceCriticality: 2,
        davisAnomalyScore: 0.6,
      });
      expect(classifyThreat(context)).toBe("medium");
    });
  });

  describe("high classification", () => {
    it("classifies as high: production with anomaly 0.6-0.8", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.7,
      });
      expect(classifyThreat(context)).toBe("high");
    });

    it("classifies as high: production with criticality 4", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 4,
        davisAnomalyScore: 0.1,
      });
      expect(classifyThreat(context)).toBe("high");
    });

    it("classifies as high: production with anomaly exactly 0.6", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.6,
      });
      expect(classifyThreat(context)).toBe("high");
    });

    it("classifies as high: production with anomaly exactly 0.8", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.8,
      });
      expect(classifyThreat(context)).toBe("high");
    });
  });

  describe("critical classification", () => {
    it("classifies as critical: production with anomaly > 0.8", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.9,
      });
      expect(classifyThreat(context)).toBe("critical");
    });

    it("classifies as critical: production with criticality 5", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 5,
        davisAnomalyScore: 0.1,
      });
      expect(classifyThreat(context)).toBe("critical");
    });

    it("classifies as critical: production with anomaly 1.0", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 1,
        davisAnomalyScore: 1.0,
      });
      expect(classifyThreat(context)).toBe("critical");
    });

    it("classifies as critical: production with both anomaly > 0.8 and criticality 5", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 5,
        davisAnomalyScore: 0.95,
      });
      expect(classifyThreat(context)).toBe("critical");
    });
  });

  describe("boundary cases", () => {
    it("production with anomaly 0.29 and criticality 2 is medium (production triggers medium)", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 2,
        davisAnomalyScore: 0.29,
      });
      expect(classifyThreat(context)).toBe("medium");
    });

    it("production with criticality 3 and low anomaly is medium", () => {
      const context = makePodContext({
        namespaceClassification: "production",
        serviceCriticality: 3,
        davisAnomalyScore: 0.1,
      });
      expect(classifyThreat(context)).toBe("medium");
    });
  });
});

describe("classifyThreatWithDefaults", () => {
  describe("missing field handling", () => {
    it("all fields missing defaults to critical (production, criticality 5, anomaly 1.0)", () => {
      expect(classifyThreatWithDefaults({})).toBe("critical");
    });

    it("missing namespaceClassification defaults to production", () => {
      const result = classifyThreatWithDefaults({
        serviceCriticality: 1,
        davisAnomalyScore: 0.1,
      });
      // production with low anomaly and low criticality = medium
      expect(result).toBe("medium");
    });

    it("missing serviceCriticality defaults to 5", () => {
      const result = classifyThreatWithDefaults({
        namespaceClassification: "production",
        davisAnomalyScore: 0.1,
      });
      // production with criticality 5 = critical
      expect(result).toBe("critical");
    });

    it("missing davisAnomalyScore defaults to 1.0", () => {
      const result = classifyThreatWithDefaults({
        namespaceClassification: "production",
        serviceCriticality: 1,
      });
      // production with anomaly 1.0 = critical
      expect(result).toBe("critical");
    });

    it("missing namespace and criticality defaults to production + criticality 5", () => {
      const result = classifyThreatWithDefaults({
        davisAnomalyScore: 0.1,
      });
      // production with criticality 5 = critical
      expect(result).toBe("critical");
    });

    it("missing namespace and anomaly defaults to production + anomaly 1.0", () => {
      const result = classifyThreatWithDefaults({
        serviceCriticality: 1,
      });
      // production with anomaly 1.0 = critical
      expect(result).toBe("critical");
    });

    it("missing criticality and anomaly defaults to criticality 5 + anomaly 1.0", () => {
      const result = classifyThreatWithDefaults({
        namespaceClassification: "non-production",
      });
      // non-production with criticality 5 and anomaly 1.0 → medium (anomaly 0.3-0.6 doesn't match, but criticality 3 doesn't match either)
      // Actually: non-production, criticality 5, anomaly 1.0
      // Not low (criticality > 2), not medium (not production, anomaly > 0.6, criticality != 3)
      // Falls to medium via fallback (non-production with high criticality)
      expect(result).toBe("medium");
    });
  });

  describe("with all fields provided", () => {
    it("classifies as low when all fields indicate low risk", () => {
      const result = classifyThreatWithDefaults({
        namespaceClassification: "non-production",
        serviceCriticality: 1,
        davisAnomalyScore: 0.1,
      });
      expect(result).toBe("low");
    });

    it("classifies as critical when all fields indicate critical risk", () => {
      const result = classifyThreatWithDefaults({
        namespaceClassification: "production",
        serviceCriticality: 5,
        davisAnomalyScore: 0.95,
      });
      expect(result).toBe("critical");
    });
  });
});
