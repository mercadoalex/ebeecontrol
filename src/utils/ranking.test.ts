import { describe, it, expect } from "vitest";
import { rankServices } from "./ranking";
import { HighRiskService } from "../types/index";

function makeService(name: string, riskScore: number): HighRiskService {
  return {
    serviceId: `svc-${name}`,
    serviceName: name,
    namespace: "default",
    podIdentifiers: [`pod-${name}`],
    riskScore,
  };
}

describe("rankServices", () => {
  it("returns an empty array when given an empty array", () => {
    expect(rankServices([])).toEqual([]);
  });

  it("returns a single service unchanged", () => {
    const services = [makeService("alpha", 50)];
    expect(rankServices(services)).toEqual(services);
  });

  it("sorts services by risk score descending", () => {
    const services = [
      makeService("low", 10),
      makeService("high", 90),
      makeService("mid", 50),
    ];
    const ranked = rankServices(services);
    expect(ranked[0].serviceName).toBe("high");
    expect(ranked[1].serviceName).toBe("mid");
    expect(ranked[2].serviceName).toBe("low");
  });

  it("uses alphabetical service name as tiebreaker for equal risk scores", () => {
    const services = [
      makeService("charlie", 75),
      makeService("alpha", 75),
      makeService("bravo", 75),
    ];
    const ranked = rankServices(services);
    expect(ranked[0].serviceName).toBe("alpha");
    expect(ranked[1].serviceName).toBe("bravo");
    expect(ranked[2].serviceName).toBe("charlie");
  });

  it("combines risk score sorting with alphabetical tiebreaker", () => {
    const services = [
      makeService("zulu", 80),
      makeService("alpha", 80),
      makeService("bravo", 60),
      makeService("delta", 100),
    ];
    const ranked = rankServices(services);
    expect(ranked[0].serviceName).toBe("delta");
    expect(ranked[1].serviceName).toBe("alpha");
    expect(ranked[2].serviceName).toBe("zulu");
    expect(ranked[3].serviceName).toBe("bravo");
  });

  it("does not mutate the original array", () => {
    const services = [
      makeService("b", 30),
      makeService("a", 70),
    ];
    const original = [...services];
    rankServices(services);
    expect(services).toEqual(original);
  });

  it("handles services with risk score 0 and 100", () => {
    const services = [
      makeService("min", 0),
      makeService("max", 100),
      makeService("mid", 50),
    ];
    const ranked = rankServices(services);
    expect(ranked[0].riskScore).toBe(100);
    expect(ranked[1].riskScore).toBe(50);
    expect(ranked[2].riskScore).toBe(0);
  });
});
