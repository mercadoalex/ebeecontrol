/**
 * Ebeecontrol Agent Orchestrator - Discovery cycle scheduling and execution.
 *
 * Implements the discovery cycle that queries Dynatrace for high-risk services,
 * ranks them, and selects placement targets. Provides configurable interval
 * scheduling with guard against overlapping cycles.
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 8.1, 8.2
 */

import { HighRiskService } from "../types/index";

/**
 * Result of a discovery cycle execution.
 */
export interface DiscoveryResult {
  servicesFound: number;
  rankedServices: HighRiskService[];
  skipped: boolean;
  reason?: string;
}

/**
 * Configuration for the orchestrator's discovery scheduling.
 */
export interface OrchestratorConfig {
  discoveryIntervalMinutes: number; // 5-1440, default 60
}

/**
 * Interface for the orchestrator managing discovery cycles.
 */
export interface Orchestrator {
  initiateDiscoveryCycle(): Promise<DiscoveryResult>;
  isDiscoveryCycleInProgress(): boolean;
  getLastDiscoveryTimestamp(): string | undefined;
  start(): void;
  stop(): void;
}

/**
 * Dependencies injected into the orchestrator.
 */
export interface OrchestratorDependencies {
  queryHighRiskServices: () => Promise<HighRiskService[]>;
  rankServices: (services: HighRiskService[]) => HighRiskService[];
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;

/**
 * Validates and clamps the discovery interval to the allowed range [5, 1440].
 */
function validateInterval(minutes: number): number {
  if (minutes < MIN_INTERVAL_MINUTES) return MIN_INTERVAL_MINUTES;
  if (minutes > MAX_INTERVAL_MINUTES) return MAX_INTERVAL_MINUTES;
  return minutes;
}

/**
 * Default no-op logger used when no logger is provided.
 */
const noopLogger = {
  info: (_message: string) => {},
  warn: (_message: string) => {},
  error: (_message: string) => {},
};

/**
 * Creates an Orchestrator instance that manages discovery cycle scheduling.
 *
 * The orchestrator:
 * 1. Accepts a DynatraceClient's queryHighRiskServices method via dependency injection
 * 2. Accepts a rankServices function via dependency injection
 * 3. Tracks whether a discovery cycle is in progress
 * 4. Tracks the last discovery timestamp
 * 5. Skips if previous cycle hasn't completed
 * 6. Queries Dynatrace, ranks results, returns them
 * 7. Handles empty results gracefully (log, return skipped=false with 0 services)
 * 8. Provides start/stop for the interval scheduler (using setInterval)
 */
export function createOrchestrator(
  config: OrchestratorConfig,
  dependencies: OrchestratorDependencies
): Orchestrator {
  const intervalMinutes = validateInterval(
    config.discoveryIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES
  );
  const logger = dependencies.logger ?? noopLogger;

  let cycleInProgress = false;
  let lastDiscoveryTimestamp: string | undefined;
  let schedulerInterval: ReturnType<typeof setInterval> | undefined;

  async function initiateDiscoveryCycle(): Promise<DiscoveryResult> {
    // Guard: skip if previous cycle is still in progress
    if (cycleInProgress) {
      logger.info(
        "Discovery cycle skipped: previous cycle has not yet completed"
      );
      return {
        servicesFound: 0,
        rankedServices: [],
        skipped: true,
        reason: "Previous discovery cycle has not yet completed",
      };
    }

    cycleInProgress = true;
    lastDiscoveryTimestamp = new Date().toISOString();

    try {
      // Query Dynatrace for high-risk services
      const services = await dependencies.queryHighRiskServices();

      // Handle empty service list gracefully
      if (services.length === 0) {
        logger.info(
          "No high-risk services found during discovery cycle. Skipping placement."
        );
        return {
          servicesFound: 0,
          rankedServices: [],
          skipped: false,
        };
      }

      // Rank services by risk score (descending), tiebreak by name (alphabetical)
      const rankedServices = dependencies.rankServices(services);

      logger.info(
        `Discovery cycle completed: found ${rankedServices.length} high-risk services`
      );

      return {
        servicesFound: rankedServices.length,
        rankedServices,
        skipped: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Discovery cycle failed: ${errorMessage}`);
      throw error;
    } finally {
      cycleInProgress = false;
    }
  }

  function isDiscoveryCycleInProgress(): boolean {
    return cycleInProgress;
  }

  function getLastDiscoveryTimestamp(): string | undefined {
    return lastDiscoveryTimestamp;
  }

  function start(): void {
    if (schedulerInterval) {
      return; // Already running
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    schedulerInterval = setInterval(() => {
      initiateDiscoveryCycle().catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(
          `Scheduled discovery cycle failed: ${errorMessage}`
        );
      });
    }, intervalMs);

    logger.info(
      `Orchestrator started: discovery cycle scheduled every ${intervalMinutes} minutes`
    );
  }

  function stop(): void {
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = undefined;
      logger.info("Orchestrator stopped: discovery cycle scheduler cleared");
    }
  }

  return {
    initiateDiscoveryCycle,
    isDiscoveryCycleInProgress,
    getLastDiscoveryTimestamp,
    start,
    stop,
  };
}
