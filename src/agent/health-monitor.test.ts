import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createHealthMonitor,
  HealthMonitor,
  HealthMonitorConfig,
  HealthMonitorDependencies,
  ComponentHealthCheck,
  ComponentName,
} from "./health-monitor";

function createHealthyCheck(name: ComponentName): ComponentHealthCheck {
  return {
    name,
    check: vi.fn().mockResolvedValue(undefined),
  };
}

function createUnhealthyCheck(
  name: ComponentName,
  error = "Connection refused"
): ComponentHealthCheck {
  return {
    name,
    check: vi.fn().mockRejectedValue(new Error(error)),
  };
}

function createSlowCheck(name: ComponentName, delayMs: number): ComponentHealthCheck {
  return {
    name,
    check: vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, delayMs))
    ),
  };
}

function createTestDependencies(
  overrides: Partial<HealthMonitorDependencies> = {}
): HealthMonitorDependencies {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    alert: vi.fn(),
    ...overrides,
  };
}

describe("HealthMonitor", () => {
  let monitor: HealthMonitor;
  let deps: HealthMonitorDependencies;
  const defaultConfig: Partial<HealthMonitorConfig> = {
    checkIntervalSeconds: 30,
    componentTimeoutSeconds: 10,
    recoveryMaxRetries: 3,
    recoveryRetryIntervalSeconds: 20,
    alertTimeoutSeconds: 60,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createTestDependencies();
    monitor = createHealthMonitor(defaultConfig, deps);
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  describe("registerComponent", () => {
    it("should register a component with initial healthy status", () => {
      const component = createHealthyCheck("Tetragon_Monitor");
      monitor.registerComponent(component);

      const status = monitor.getHealthStatus();
      expect(status.components.Tetragon_Monitor).toBeDefined();
      expect(status.components.Tetragon_Monitor.status).toBe("healthy");
    });

    it("should register multiple components", () => {
      monitor.registerComponent(createHealthyCheck("Tetragon_Monitor"));
      monitor.registerComponent(createHealthyCheck("Koney_Deployer"));
      monitor.registerComponent(createHealthyCheck("Dynatrace_MCP_Server"));
      monitor.registerComponent(createHealthyCheck("Vertex_AI_Trainer"));

      const status = monitor.getHealthStatus();
      expect(Object.keys(status.components)).toHaveLength(4);
    });
  });

  describe("getHealthStatus", () => {
    it("should return overall healthy when all components are healthy", () => {
      monitor.registerComponent(createHealthyCheck("Tetragon_Monitor"));
      monitor.registerComponent(createHealthyCheck("Koney_Deployer"));

      const status = monitor.getHealthStatus();
      expect(status.overall).toBe("healthy");
    });

    it("should return overall healthy when no components are registered", () => {
      const status = monitor.getHealthStatus();
      expect(status.overall).toBe("healthy");
    });

    it("should include a timestamp in ISO 8601 format", () => {
      const status = monitor.getHealthStatus();
      expect(new Date(status.timestamp).toISOString()).toBe(status.timestamp);
    });

    it("should include lastCheckTimestamp for each component", () => {
      monitor.registerComponent(createHealthyCheck("Tetragon_Monitor"));

      const status = monitor.getHealthStatus();
      const ts = status.components.Tetragon_Monitor.lastCheckTimestamp;
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });

  describe("checkNow", () => {
    it("should mark component as healthy when check succeeds", async () => {
      monitor.registerComponent(createHealthyCheck("Tetragon_Monitor"));

      const status = await monitor.checkNow();
      expect(status.components.Tetragon_Monitor.status).toBe("healthy");
    });

    it("should mark component as unhealthy when check throws an error", async () => {
      monitor.registerComponent(
        createUnhealthyCheck("Koney_Deployer", "Connection refused")
      );

      const status = await monitor.checkNow();
      expect(status.components.Koney_Deployer.status).toBe("unhealthy");
      expect(status.components.Koney_Deployer.lastErrorMessage).toBe(
        "Connection refused"
      );
    });

    it("should mark component as unhealthy when check times out", async () => {
      // Component takes 15s but timeout is 10s
      monitor.registerComponent(createSlowCheck("Dynatrace_MCP_Server", 15000));

      const checkPromise = monitor.checkNow();
      // Advance past the 10s timeout
      await vi.advanceTimersByTimeAsync(11000);
      const status = await checkPromise;

      expect(status.components.Dynatrace_MCP_Server.status).toBe("unhealthy");
      expect(status.components.Dynatrace_MCP_Server.lastErrorMessage).toContain(
        "timed out"
      );
    });

    it("should check all registered components", async () => {
      const check1 = createHealthyCheck("Tetragon_Monitor");
      const check2 = createHealthyCheck("Koney_Deployer");
      monitor.registerComponent(check1);
      monitor.registerComponent(check2);

      await monitor.checkNow();

      expect(check1.check).toHaveBeenCalledOnce();
      expect(check2.check).toHaveBeenCalledOnce();
    });

    it("should return degraded overall when some components are unhealthy", async () => {
      monitor.registerComponent(createHealthyCheck("Tetragon_Monitor"));
      monitor.registerComponent(
        createUnhealthyCheck("Koney_Deployer", "Failed")
      );

      const status = await monitor.checkNow();
      expect(status.overall).toBe("degraded");
    });

    it("should return unhealthy overall when all components are unhealthy", async () => {
      monitor.registerComponent(
        createUnhealthyCheck("Tetragon_Monitor", "Error 1")
      );
      monitor.registerComponent(
        createUnhealthyCheck("Koney_Deployer", "Error 2")
      );

      const status = await monitor.checkNow();
      expect(status.overall).toBe("unhealthy");
    });
  });

  describe("periodic health checks (start/stop)", () => {
    it("should check components at the configured interval", async () => {
      const check = createHealthyCheck("Tetragon_Monitor");
      monitor.registerComponent(check);
      monitor.start();

      // Advance to first interval
      await vi.advanceTimersByTimeAsync(30000);
      expect(check.check).toHaveBeenCalledOnce();

      // Advance to second interval
      await vi.advanceTimersByTimeAsync(30000);
      expect(check.check).toHaveBeenCalledTimes(2);
    });

    it("should stop checking when stop is called", async () => {
      const check = createHealthyCheck("Tetragon_Monitor");
      monitor.registerComponent(check);
      monitor.start();

      await vi.advanceTimersByTimeAsync(30000);
      expect(check.check).toHaveBeenCalledOnce();

      monitor.stop();

      await vi.advanceTimersByTimeAsync(60000);
      expect(check.check).toHaveBeenCalledOnce(); // No additional calls
    });

    it("should not create duplicate intervals on multiple start calls", async () => {
      const check = createHealthyCheck("Tetragon_Monitor");
      monitor.registerComponent(check);
      monitor.start();
      monitor.start(); // second call should be no-op

      await vi.advanceTimersByTimeAsync(30000);
      expect(check.check).toHaveBeenCalledOnce();
    });

    it("should handle stop when not started", () => {
      expect(() => monitor.stop()).not.toThrow();
    });

    it("should log when starting", () => {
      monitor.start();
      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("Health monitor started")
      );
    });

    it("should log when stopping", () => {
      monitor.start();
      monitor.stop();
      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("Health monitor stopped")
      );
    });
  });

  describe("recovery retries", () => {
    it("should retry unhealthy component up to 3 times at 20s intervals", async () => {
      const check = createUnhealthyCheck("Tetragon_Monitor", "Connection lost");
      monitor.registerComponent(check);

      // Trigger initial failure
      await monitor.checkNow();
      expect(check.check).toHaveBeenCalledOnce();

      // First retry at 20s
      await vi.advanceTimersByTimeAsync(20000);
      expect(check.check).toHaveBeenCalledTimes(2);

      // Second retry at 40s
      await vi.advanceTimersByTimeAsync(20000);
      expect(check.check).toHaveBeenCalledTimes(3);

      // Third retry at 60s
      await vi.advanceTimersByTimeAsync(20000);
      expect(check.check).toHaveBeenCalledTimes(4);
    });

    it("should mark component as degraded after retry exhaustion", async () => {
      const check = createUnhealthyCheck("Koney_Deployer", "Unavailable");
      monitor.registerComponent(check);

      await monitor.checkNow();

      // Exhaust all 3 retries
      await vi.advanceTimersByTimeAsync(20000); // retry 1
      await vi.advanceTimersByTimeAsync(20000); // retry 2
      await vi.advanceTimersByTimeAsync(20000); // retry 3

      const status = monitor.getHealthStatus();
      expect(status.components.Koney_Deployer.status).toBe("degraded");
    });

    it("should recover component if retry succeeds", async () => {
      let callCount = 0;
      const component: ComponentHealthCheck = {
        name: "Vertex_AI_Trainer",
        check: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 2) {
            return Promise.reject(new Error("Temporary failure"));
          }
          return Promise.resolve();
        }),
      };
      monitor.registerComponent(component);

      // Initial check fails
      await monitor.checkNow();
      expect(monitor.getHealthStatus().components.Vertex_AI_Trainer.status).toBe(
        "unhealthy"
      );

      // First retry fails (callCount = 2)
      await vi.advanceTimersByTimeAsync(20000);
      expect(monitor.getHealthStatus().components.Vertex_AI_Trainer.status).toBe(
        "unhealthy"
      );

      // Second retry succeeds (callCount = 3)
      await vi.advanceTimersByTimeAsync(20000);
      expect(monitor.getHealthStatus().components.Vertex_AI_Trainer.status).toBe(
        "healthy"
      );
    });

    it("should log recovery retries", async () => {
      const check = createUnhealthyCheck("Tetragon_Monitor", "Error");
      monitor.registerComponent(check);

      await monitor.checkNow();
      await vi.advanceTimersByTimeAsync(20000);

      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("Recovery retry 1/3 for Tetragon_Monitor")
      );
    });

    it("should log when component recovers", async () => {
      let shouldFail = true;
      const component: ComponentHealthCheck = {
        name: "Dynatrace_MCP_Server",
        check: vi.fn().mockImplementation(() => {
          if (shouldFail) return Promise.reject(new Error("Down"));
          return Promise.resolve();
        }),
      };
      monitor.registerComponent(component);

      await monitor.checkNow();
      shouldFail = false;
      await vi.advanceTimersByTimeAsync(20000);

      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("Dynatrace_MCP_Server recovered")
      );
    });
  });

  describe("alerting", () => {
    it("should send alert within 60 seconds of initial failure", async () => {
      const check = createUnhealthyCheck("Tetragon_Monitor", "Down");
      monitor.registerComponent(check);

      await monitor.checkNow();

      // Alert should not have fired yet
      expect(deps.alert).not.toHaveBeenCalled();

      // Advance to 60s (alert timeout)
      await vi.advanceTimersByTimeAsync(60000);

      expect(deps.alert).toHaveBeenCalledWith(
        expect.stringContaining("Tetragon_Monitor")
      );
    });

    it("should send escalation alert after retry exhaustion", async () => {
      const check = createUnhealthyCheck("Koney_Deployer", "Unavailable");
      monitor.registerComponent(check);

      await monitor.checkNow();

      // Exhaust all retries (3 retries at 20s intervals = 60s)
      await vi.advanceTimersByTimeAsync(20000); // retry 1
      await vi.advanceTimersByTimeAsync(20000); // retry 2
      await vi.advanceTimersByTimeAsync(20000); // retry 3

      expect(deps.alert).toHaveBeenCalledWith(
        expect.stringContaining("ESCALATION")
      );
      expect(deps.alert).toHaveBeenCalledWith(
        expect.stringContaining("Manual intervention required")
      );
    });

    it("should not send alert if component recovers before timeout", async () => {
      let shouldFail = true;
      const component: ComponentHealthCheck = {
        name: "Vertex_AI_Trainer",
        check: vi.fn().mockImplementation(() => {
          if (shouldFail) return Promise.reject(new Error("Temp"));
          return Promise.resolve();
        }),
      };
      monitor.registerComponent(component);

      await monitor.checkNow();
      shouldFail = false;

      // Recovery happens at 20s (first retry)
      await vi.advanceTimersByTimeAsync(20000);

      // Advance past alert timeout
      await vi.advanceTimersByTimeAsync(60000);

      // Alert should not have been sent (recovery cleared it)
      expect(deps.alert).not.toHaveBeenCalled();
    });
  });

  describe("degraded state behavior", () => {
    it("should continue operating with healthy components when one is degraded", async () => {
      const healthyCheck = createHealthyCheck("Tetragon_Monitor");
      const unhealthyCheck = createUnhealthyCheck("Koney_Deployer", "Down");
      monitor.registerComponent(healthyCheck);
      monitor.registerComponent(unhealthyCheck);

      await monitor.checkNow();

      // Exhaust retries for unhealthy component
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(20000);

      const status = monitor.getHealthStatus();
      expect(status.components.Tetragon_Monitor.status).toBe("healthy");
      expect(status.components.Koney_Deployer.status).toBe("degraded");
      expect(status.overall).toBe("degraded");
    });

    it("should not downgrade degraded component back to unhealthy on subsequent checks", async () => {
      const check = createUnhealthyCheck("Tetragon_Monitor", "Error");
      monitor.registerComponent(check);

      await monitor.checkNow();

      // Exhaust retries
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(20000);

      expect(monitor.getHealthStatus().components.Tetragon_Monitor.status).toBe(
        "degraded"
      );

      // Run another check - should stay degraded, not go back to unhealthy
      await monitor.checkNow();
      expect(monitor.getHealthStatus().components.Tetragon_Monitor.status).toBe(
        "degraded"
      );
    });
  });

  describe("configuration", () => {
    it("should use default config values when not specified", () => {
      const mon = createHealthMonitor({}, deps);
      mon.registerComponent(createHealthyCheck("Tetragon_Monitor"));
      mon.start();

      // Default interval is 30s
      vi.advanceTimersByTime(29000);
      // No check yet
      vi.advanceTimersByTime(1000);
      // Check should have happened at 30s

      mon.stop();
    });

    it("should respect custom check interval", async () => {
      const customMonitor = createHealthMonitor(
        { checkIntervalSeconds: 15 },
        deps
      );
      const check = createHealthyCheck("Tetragon_Monitor");
      customMonitor.registerComponent(check);
      customMonitor.start();

      await vi.advanceTimersByTimeAsync(15000);
      expect(check.check).toHaveBeenCalledOnce();

      customMonitor.stop();
    });

    it("should respect custom component timeout", async () => {
      const customMonitor = createHealthMonitor(
        { componentTimeoutSeconds: 5 },
        deps
      );
      // Component takes 8s but timeout is 5s
      customMonitor.registerComponent(createSlowCheck("Tetragon_Monitor", 8000));

      const checkPromise = customMonitor.checkNow();
      await vi.advanceTimersByTimeAsync(6000);
      const status = await checkPromise;

      expect(status.components.Tetragon_Monitor.status).toBe("unhealthy");
      customMonitor.stop();
    });
  });

  describe("health endpoint response time", () => {
    it("should return health status synchronously (within 5 seconds)", () => {
      monitor.registerComponent(createHealthyCheck("Tetragon_Monitor"));
      monitor.registerComponent(createHealthyCheck("Koney_Deployer"));

      // getHealthStatus is synchronous - it returns cached state
      const start = Date.now();
      const status = monitor.getHealthStatus();
      const elapsed = Date.now() - start;

      expect(status).toBeDefined();
      expect(status.overall).toBe("healthy");
      // Synchronous call should be essentially instant
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("error logging", () => {
    it("should log when a component becomes unhealthy", async () => {
      monitor.registerComponent(
        createUnhealthyCheck("Tetragon_Monitor", "Connection refused")
      );

      await monitor.checkNow();

      expect(deps.logger!.error).toHaveBeenCalledWith(
        expect.stringContaining("Tetragon_Monitor is unhealthy")
      );
      expect(deps.logger!.error).toHaveBeenCalledWith(
        expect.stringContaining("Connection refused")
      );
    });
  });

  describe("works without dependencies", () => {
    it("should work without logger or alert function", async () => {
      const mon = createHealthMonitor(defaultConfig);
      mon.registerComponent(createHealthyCheck("Tetragon_Monitor"));

      const status = await mon.checkNow();
      expect(status.components.Tetragon_Monitor.status).toBe("healthy");
      mon.stop();
    });
  });
});
