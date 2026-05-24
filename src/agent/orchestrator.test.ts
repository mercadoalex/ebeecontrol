import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createOrchestrator,
  Orchestrator,
  OrchestratorConfig,
  OrchestratorDependencies,
} from "./orchestrator";
import { HighRiskService } from "../types/index";

function createMockServices(count: number): HighRiskService[] {
  return Array.from({ length: count }, (_, i) => ({
    serviceId: `svc-${i}`,
    serviceName: `service-${String.fromCharCode(65 + i)}`,
    namespace: "default",
    podIdentifiers: [`pod-${i}`],
    riskScore: 50 + i * 10,
  }));
}

function createTestDependencies(
  overrides: Partial<OrchestratorDependencies> = {}
): OrchestratorDependencies {
  return {
    queryHighRiskServices: vi.fn().mockResolvedValue(createMockServices(3)),
    rankServices: vi.fn((services: HighRiskService[]) =>
      [...services].sort((a, b) => {
        if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
        return a.serviceName.localeCompare(b.serviceName);
      })
    ),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

describe("Orchestrator", () => {
  let orchestrator: Orchestrator;
  let deps: OrchestratorDependencies;
  const defaultConfig: OrchestratorConfig = { discoveryIntervalMinutes: 60 };

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createTestDependencies();
    orchestrator = createOrchestrator(defaultConfig, deps);
  });

  afterEach(() => {
    orchestrator.stop();
    vi.useRealTimers();
  });

  describe("initiateDiscoveryCycle", () => {
    it("should query Dynatrace and return ranked services", async () => {
      const result = await orchestrator.initiateDiscoveryCycle();

      expect(deps.queryHighRiskServices).toHaveBeenCalledOnce();
      expect(deps.rankServices).toHaveBeenCalledOnce();
      expect(result.skipped).toBe(false);
      expect(result.servicesFound).toBe(3);
      expect(result.rankedServices).toHaveLength(3);
    });

    it("should return services ranked by risk score descending", async () => {
      const result = await orchestrator.initiateDiscoveryCycle();

      for (let i = 0; i < result.rankedServices.length - 1; i++) {
        expect(result.rankedServices[i].riskScore).toBeGreaterThanOrEqual(
          result.rankedServices[i + 1].riskScore
        );
      }
    });

    it("should handle empty service list gracefully", async () => {
      deps = createTestDependencies({
        queryHighRiskServices: vi.fn().mockResolvedValue([]),
      });
      orchestrator = createOrchestrator(defaultConfig, deps);

      const result = await orchestrator.initiateDiscoveryCycle();

      expect(result.skipped).toBe(false);
      expect(result.servicesFound).toBe(0);
      expect(result.rankedServices).toHaveLength(0);
      expect(result.reason).toBeUndefined();
      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("No high-risk services found")
      );
    });

    it("should skip if previous cycle is still in progress", async () => {
      // Create a slow query that won't resolve immediately
      let resolveQuery: (value: HighRiskService[]) => void;
      const slowQuery = new Promise<HighRiskService[]>((resolve) => {
        resolveQuery = resolve;
      });

      deps = createTestDependencies({
        queryHighRiskServices: vi.fn().mockReturnValue(slowQuery),
      });
      orchestrator = createOrchestrator(defaultConfig, deps);

      // Start first cycle (won't complete)
      const firstCyclePromise = orchestrator.initiateDiscoveryCycle();

      // Attempt second cycle while first is in progress
      const secondResult = await orchestrator.initiateDiscoveryCycle();

      expect(secondResult.skipped).toBe(true);
      expect(secondResult.reason).toContain("not yet completed");
      expect(secondResult.servicesFound).toBe(0);

      // Resolve the first cycle
      resolveQuery!(createMockServices(2));
      await firstCyclePromise;
    });

    it("should set lastDiscoveryTimestamp on cycle initiation", async () => {
      expect(orchestrator.getLastDiscoveryTimestamp()).toBeUndefined();

      const before = new Date().toISOString();
      await orchestrator.initiateDiscoveryCycle();
      const after = new Date().toISOString();

      const timestamp = orchestrator.getLastDiscoveryTimestamp();
      expect(timestamp).toBeDefined();
      expect(timestamp! >= before).toBe(true);
      expect(timestamp! <= after).toBe(true);
    });

    it("should mark cycle as not in progress after completion", async () => {
      expect(orchestrator.isDiscoveryCycleInProgress()).toBe(false);

      await orchestrator.initiateDiscoveryCycle();

      expect(orchestrator.isDiscoveryCycleInProgress()).toBe(false);
    });

    it("should mark cycle as not in progress after error", async () => {
      deps = createTestDependencies({
        queryHighRiskServices: vi
          .fn()
          .mockRejectedValue(new Error("Connection failed")),
      });
      orchestrator = createOrchestrator(defaultConfig, deps);

      await expect(orchestrator.initiateDiscoveryCycle()).rejects.toThrow(
        "Connection failed"
      );

      expect(orchestrator.isDiscoveryCycleInProgress()).toBe(false);
    });

    it("should propagate errors from queryHighRiskServices", async () => {
      deps = createTestDependencies({
        queryHighRiskServices: vi
          .fn()
          .mockRejectedValue(new Error("Dynatrace timeout")),
      });
      orchestrator = createOrchestrator(defaultConfig, deps);

      await expect(orchestrator.initiateDiscoveryCycle()).rejects.toThrow(
        "Dynatrace timeout"
      );
      expect(deps.logger!.error).toHaveBeenCalledWith(
        expect.stringContaining("Discovery cycle failed")
      );
    });

    it("should allow a new cycle after previous one completes", async () => {
      await orchestrator.initiateDiscoveryCycle();
      const result = await orchestrator.initiateDiscoveryCycle();

      expect(result.skipped).toBe(false);
      expect(result.servicesFound).toBe(3);
    });
  });

  describe("configuration", () => {
    it("should use default interval of 60 minutes", () => {
      orchestrator.start();

      // Advance less than 60 minutes - should not trigger
      vi.advanceTimersByTime(59 * 60 * 1000);
      expect(deps.queryHighRiskServices).not.toHaveBeenCalled();

      // Advance to 60 minutes - should trigger
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(deps.queryHighRiskServices).toHaveBeenCalledOnce();
    });

    it("should respect custom interval", () => {
      const customConfig: OrchestratorConfig = {
        discoveryIntervalMinutes: 30,
      };
      orchestrator = createOrchestrator(customConfig, deps);
      orchestrator.start();

      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(deps.queryHighRiskServices).toHaveBeenCalledOnce();
    });

    it("should clamp interval below minimum to 5 minutes", () => {
      const config: OrchestratorConfig = { discoveryIntervalMinutes: 1 };
      orchestrator = createOrchestrator(config, deps);
      orchestrator.start();

      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(deps.queryHighRiskServices).toHaveBeenCalledOnce();
    });

    it("should clamp interval above maximum to 1440 minutes", () => {
      const config: OrchestratorConfig = { discoveryIntervalMinutes: 2000 };
      orchestrator = createOrchestrator(config, deps);
      orchestrator.start();

      // Should not trigger at 1440 - 1 minutes
      vi.advanceTimersByTime(1439 * 60 * 1000);
      expect(deps.queryHighRiskServices).not.toHaveBeenCalled();

      // Should trigger at 1440 minutes
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(deps.queryHighRiskServices).toHaveBeenCalledOnce();
    });
  });

  describe("start/stop scheduling", () => {
    it("should start the interval scheduler", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(deps.queryHighRiskServices).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(deps.queryHighRiskServices).toHaveBeenCalledTimes(2);
    });

    it("should stop the interval scheduler", () => {
      orchestrator.start();
      orchestrator.stop();

      vi.advanceTimersByTime(120 * 60 * 1000);
      expect(deps.queryHighRiskServices).not.toHaveBeenCalled();
    });

    it("should not create duplicate intervals on multiple start calls", () => {
      orchestrator.start();
      orchestrator.start(); // second call should be no-op

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(deps.queryHighRiskServices).toHaveBeenCalledOnce();
    });

    it("should handle stop when not started", () => {
      // Should not throw
      expect(() => orchestrator.stop()).not.toThrow();
    });

    it("should log errors from scheduled cycles without crashing", async () => {
      deps = createTestDependencies({
        queryHighRiskServices: vi
          .fn()
          .mockRejectedValue(new Error("Network error")),
      });
      orchestrator = createOrchestrator(defaultConfig, deps);
      orchestrator.start();

      // Advance timer to trigger the scheduled cycle
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      // The scheduler should continue running despite the error
      expect(deps.logger!.error).toHaveBeenCalled();
    });
  });

  describe("isDiscoveryCycleInProgress", () => {
    it("should return false initially", () => {
      expect(orchestrator.isDiscoveryCycleInProgress()).toBe(false);
    });

    it("should return true during an active cycle", async () => {
      let resolveQuery: (value: HighRiskService[]) => void;
      const slowQuery = new Promise<HighRiskService[]>((resolve) => {
        resolveQuery = resolve;
      });

      deps = createTestDependencies({
        queryHighRiskServices: vi.fn().mockReturnValue(slowQuery),
      });
      orchestrator = createOrchestrator(defaultConfig, deps);

      const cyclePromise = orchestrator.initiateDiscoveryCycle();
      expect(orchestrator.isDiscoveryCycleInProgress()).toBe(true);

      resolveQuery!([]);
      await cyclePromise;
      expect(orchestrator.isDiscoveryCycleInProgress()).toBe(false);
    });
  });

  describe("getLastDiscoveryTimestamp", () => {
    it("should return undefined before any cycle", () => {
      expect(orchestrator.getLastDiscoveryTimestamp()).toBeUndefined();
    });

    it("should return ISO timestamp after a cycle", async () => {
      await orchestrator.initiateDiscoveryCycle();

      const timestamp = orchestrator.getLastDiscoveryTimestamp();
      expect(timestamp).toBeDefined();
      // Validate ISO 8601 format
      expect(new Date(timestamp!).toISOString()).toBe(timestamp);
    });

    it("should update timestamp on each new cycle", async () => {
      await orchestrator.initiateDiscoveryCycle();
      const first = orchestrator.getLastDiscoveryTimestamp();

      // Advance time slightly
      vi.advanceTimersByTime(1000);

      await orchestrator.initiateDiscoveryCycle();
      const second = orchestrator.getLastDiscoveryTimestamp();

      expect(second).not.toBe(first);
      expect(new Date(second!).getTime()).toBeGreaterThan(
        new Date(first!).getTime()
      );
    });
  });

  describe("logger integration", () => {
    it("should work without a logger (no-op)", async () => {
      const depsNoLogger: OrchestratorDependencies = {
        queryHighRiskServices: vi.fn().mockResolvedValue([]),
        rankServices: vi.fn((s) => s),
      };
      const orch = createOrchestrator(defaultConfig, depsNoLogger);

      // Should not throw
      const result = await orch.initiateDiscoveryCycle();
      expect(result.servicesFound).toBe(0);
    });

    it("should log when discovery cycle starts scheduler", () => {
      orchestrator.start();
      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("Orchestrator started")
      );
    });

    it("should log when discovery cycle stops scheduler", () => {
      orchestrator.start();
      orchestrator.stop();
      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("Orchestrator stopped")
      );
    });
  });
});
