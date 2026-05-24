/**
 * Health Monitor - Component health checking and recovery logic.
 *
 * Monitors the health of each system component (Tetragon_Monitor, Koney_Deployer,
 * Dynatrace_MCP_Server, Vertex_AI_Trainer) at configurable intervals. Implements
 * retry-based recovery and escalation alerting for unhealthy components.
 *
 * Validates: Requirements 8.3, 8.4, 8.5
 */

export type ComponentName =
  | "Tetragon_Monitor"
  | "Koney_Deployer"
  | "Dynatrace_MCP_Server"
  | "Vertex_AI_Trainer";

export type ComponentStatus = "healthy" | "unhealthy" | "degraded";

export interface ComponentHealthCheck {
  name: ComponentName;
  check: () => Promise<void>; // throws on failure, resolves on success
}

export interface ComponentHealthState {
  status: ComponentStatus;
  lastCheckTimestamp: string;
  lastErrorMessage?: string;
}

export interface HealthStatus {
  overall: "healthy" | "degraded" | "unhealthy";
  components: Record<ComponentName, ComponentHealthState>;
  timestamp: string;
}

export interface HealthMonitor {
  registerComponent(component: ComponentHealthCheck): void;
  getHealthStatus(): HealthStatus;
  start(): void;
  stop(): void;
  checkNow(): Promise<HealthStatus>;
}

export interface HealthMonitorConfig {
  checkIntervalSeconds: number; // default 30
  componentTimeoutSeconds: number; // default 10
  recoveryMaxRetries: number; // default 3
  recoveryRetryIntervalSeconds: number; // default 20
  alertTimeoutSeconds: number; // default 60
}

export interface HealthMonitorDependencies {
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  alert?: (message: string) => void;
  now?: () => Date;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  checkIntervalSeconds: 30,
  componentTimeoutSeconds: 10,
  recoveryMaxRetries: 3,
  recoveryRetryIntervalSeconds: 20,
  alertTimeoutSeconds: 60,
};

const noopLogger = {
  info: (_message: string) => {},
  warn: (_message: string) => {},
  error: (_message: string) => {},
};

/**
 * Creates a promise that rejects after the specified timeout in milliseconds.
 */
function createTimeout(ms: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Health check timed out after ${ms}ms`)), ms);
  });
}

/**
 * Computes the overall health status from individual component statuses.
 * - "healthy" if all components are healthy
 * - "unhealthy" if all components are unhealthy or degraded
 * - "degraded" if some components are unhealthy/degraded but at least one is healthy
 */
function computeOverallStatus(
  components: Record<ComponentName, ComponentHealthState>
): "healthy" | "degraded" | "unhealthy" {
  const statuses = Object.values(components);
  if (statuses.length === 0) return "healthy";

  const allHealthy = statuses.every((c) => c.status === "healthy");
  if (allHealthy) return "healthy";

  const anyHealthy = statuses.some((c) => c.status === "healthy");
  if (anyHealthy) return "degraded";

  return "unhealthy";
}

interface RecoveryState {
  retryCount: number;
  firstFailureTimestamp: string;
  alertSent: boolean;
  escalationAlertSent: boolean;
}

/**
 * Creates a HealthMonitor instance that manages component health checking and recovery.
 *
 * The health monitor:
 * 1. Registers components with their health check functions
 * 2. Periodically checks each component at the configured interval
 * 3. Marks components as unhealthy if check throws or times out
 * 4. On unhealthy: logs, retries up to 3 times at 20s intervals, alerts within 60s
 * 5. After retry exhaustion: marks degraded, sends escalation alert
 * 6. Exposes health status that responds within 5 seconds
 */
export function createHealthMonitor(
  config: Partial<HealthMonitorConfig> = {},
  dependencies: HealthMonitorDependencies = {}
): HealthMonitor {
  const resolvedConfig: HealthMonitorConfig = { ...DEFAULT_CONFIG, ...config };
  const logger = dependencies.logger ?? noopLogger;
  const alertFn = dependencies.alert ?? ((_msg: string) => {});
  const nowFn = dependencies.now ?? (() => new Date());

  const registeredComponents: Map<ComponentName, ComponentHealthCheck> = new Map();
  const componentStates: Map<ComponentName, ComponentHealthState> = new Map();
  const recoveryStates: Map<ComponentName, RecoveryState> = new Map();

  let schedulerInterval: ReturnType<typeof setInterval> | undefined;
  let recoveryTimers: Map<ComponentName, ReturnType<typeof setTimeout>> = new Map();

  function registerComponent(component: ComponentHealthCheck): void {
    registeredComponents.set(component.name, component);
    componentStates.set(component.name, {
      status: "healthy",
      lastCheckTimestamp: nowFn().toISOString(),
    });
  }

  function getHealthStatus(): HealthStatus {
    const components: Record<ComponentName, ComponentHealthState> = {} as Record<
      ComponentName,
      ComponentHealthState
    >;

    for (const [name, state] of componentStates.entries()) {
      components[name] = { ...state };
    }

    return {
      overall: computeOverallStatus(components),
      components,
      timestamp: nowFn().toISOString(),
    };
  }

  async function checkComponent(component: ComponentHealthCheck): Promise<void> {
    const timeoutMs = resolvedConfig.componentTimeoutSeconds * 1000;

    try {
      await Promise.race([component.check(), createTimeout(timeoutMs)]);

      // Check succeeded - mark healthy
      componentStates.set(component.name, {
        status: "healthy",
        lastCheckTimestamp: nowFn().toISOString(),
      });

      // Clear recovery state if component recovered
      if (recoveryStates.has(component.name)) {
        logger.info(`Component ${component.name} recovered`);
        recoveryStates.delete(component.name);
        clearRecoveryTimer(component.name);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const currentState = componentStates.get(component.name);

      // Don't downgrade from degraded to unhealthy
      if (currentState?.status === "degraded") {
        componentStates.set(component.name, {
          status: "degraded",
          lastCheckTimestamp: nowFn().toISOString(),
          lastErrorMessage: errorMessage,
        });
        return;
      }

      componentStates.set(component.name, {
        status: "unhealthy",
        lastCheckTimestamp: nowFn().toISOString(),
        lastErrorMessage: errorMessage,
      });

      logger.error(
        `Component ${component.name} is unhealthy: ${errorMessage}`
      );

      // Start recovery if not already in progress
      if (!recoveryStates.has(component.name)) {
        const recoveryState: RecoveryState = {
          retryCount: 0,
          firstFailureTimestamp: nowFn().toISOString(),
          alertSent: false,
          escalationAlertSent: false,
        };
        recoveryStates.set(component.name, recoveryState);
        scheduleRecoveryRetry(component);
        scheduleAlert(component.name, recoveryState);
      }
    }
  }

  function scheduleRecoveryRetry(component: ComponentHealthCheck): void {
    const recoveryState = recoveryStates.get(component.name);
    if (!recoveryState) return;

    if (recoveryState.retryCount >= resolvedConfig.recoveryMaxRetries) {
      // Retry exhaustion - mark degraded and send escalation alert
      componentStates.set(component.name, {
        status: "degraded",
        lastCheckTimestamp: nowFn().toISOString(),
        lastErrorMessage: componentStates.get(component.name)?.lastErrorMessage,
      });

      if (!recoveryState.escalationAlertSent) {
        recoveryState.escalationAlertSent = true;
        const msg = `ESCALATION: Component ${component.name} remains unhealthy after ${resolvedConfig.recoveryMaxRetries} recovery attempts. Manual intervention required.`;
        logger.error(msg);
        alertFn(msg);
      }
      return;
    }

    const retryTimer = setTimeout(async () => {
      const state = recoveryStates.get(component.name);
      if (!state) return;

      state.retryCount++;
      logger.info(
        `Recovery retry ${state.retryCount}/${resolvedConfig.recoveryMaxRetries} for ${component.name}`
      );

      try {
        const timeoutMs = resolvedConfig.componentTimeoutSeconds * 1000;
        await Promise.race([component.check(), createTimeout(timeoutMs)]);

        // Recovery succeeded
        componentStates.set(component.name, {
          status: "healthy",
          lastCheckTimestamp: nowFn().toISOString(),
        });
        logger.info(`Component ${component.name} recovered after ${state.retryCount} retries`);
        recoveryStates.delete(component.name);
        clearRecoveryTimer(component.name);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        componentStates.set(component.name, {
          status: "unhealthy",
          lastCheckTimestamp: nowFn().toISOString(),
          lastErrorMessage: errorMessage,
        });

        // Schedule next retry
        scheduleRecoveryRetry(component);
      }
    }, resolvedConfig.recoveryRetryIntervalSeconds * 1000);

    recoveryTimers.set(component.name, retryTimer);
  }

  function scheduleAlert(name: ComponentName, recoveryState: RecoveryState): void {
    if (recoveryState.alertSent) return;

    const alertTimer = setTimeout(() => {
      const state = recoveryStates.get(name);
      if (!state || state.alertSent) return;

      state.alertSent = true;
      const msg = `ALERT: Component ${name} has been unhealthy since ${state.firstFailureTimestamp}`;
      logger.warn(msg);
      alertFn(msg);
    }, resolvedConfig.alertTimeoutSeconds * 1000);

    // Store alert timer separately so it doesn't interfere with recovery timers
    // We use a simple approach: the alert timer is fire-and-forget
    // If the component recovers before the alert fires, we clear it via recovery state check
    recoveryTimers.set(`${name}_alert` as ComponentName, alertTimer);
  }

  function clearRecoveryTimer(name: ComponentName): void {
    const timer = recoveryTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      recoveryTimers.delete(name);
    }
    const alertTimer = recoveryTimers.get(`${name}_alert` as ComponentName);
    if (alertTimer) {
      clearTimeout(alertTimer);
      recoveryTimers.delete(`${name}_alert` as ComponentName);
    }
  }

  async function checkAllComponents(): Promise<void> {
    const components = Array.from(registeredComponents.values());
    await Promise.all(components.map((c) => checkComponent(c)));
  }

  async function checkNow(): Promise<HealthStatus> {
    await checkAllComponents();
    return getHealthStatus();
  }

  function start(): void {
    if (schedulerInterval) return;

    const intervalMs = resolvedConfig.checkIntervalSeconds * 1000;
    schedulerInterval = setInterval(() => {
      checkAllComponents().catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(`Health check cycle failed: ${errorMessage}`);
      });
    }, intervalMs);

    logger.info(
      `Health monitor started: checking every ${resolvedConfig.checkIntervalSeconds} seconds`
    );
  }

  function stop(): void {
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = undefined;
    }

    // Clear all recovery timers
    for (const timer of recoveryTimers.values()) {
      clearTimeout(timer);
    }
    recoveryTimers.clear();
    recoveryStates.clear();

    logger.info("Health monitor stopped");
  }

  return {
    registerComponent,
    getHealthStatus,
    start,
    stop,
    checkNow,
  };
}
