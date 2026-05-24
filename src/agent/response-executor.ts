/**
 * Response Executor for the Ebeecontrol Agent.
 *
 * Executes response plans based on threat classification:
 * - Pod isolation via Kubernetes API (10s timeout, 3 retries, 5s interval)
 * - IP blocking via network policy (10s timeout, 3 retries, 5s interval)
 * - Additional honeytoken deployment for medium+ threats
 *
 * Logs all actions with type, target, timestamp, classification, and result.
 * Handles isolation failure: alert + retry; exhaustion: critical alert.
 * Handles IP block failure: alert + retry.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { v4 as uuidv4 } from "uuid";
import { ResponseAction, ThreatAssessment } from "../types/index";
import { retryWithFixedInterval } from "../utils/retry";
import { AuditLog } from "./audit-log";
import { ResponsePlan, PlannedAction } from "./response-planner";

/**
 * Dependencies required by the response executor.
 */
export interface ResponseExecutorDependencies {
  isolatePod: (podId: string) => Promise<void>;
  blockIp: (podId: string) => Promise<void>;
  deployHoneytokens: (namespace: string, count: number) => Promise<void>;
  sendAlert: (message: string) => Promise<void>;
  auditLog: AuditLog;
}

/**
 * Result of executing a response plan.
 */
export interface ResponseExecutionResult {
  actions: ResponseAction[];
  allSucceeded: boolean;
  criticalFailures: string[];
}

/**
 * Executes a response plan based on the threat assessment.
 *
 * Actions are executed in priority order (lower priority number = higher priority).
 * Each action is retried with fixed intervals on failure:
 * - pod_isolation: 3 retries, 5s interval; alert on each failure; critical alert on exhaustion
 * - ip_block: 3 retries, 5s interval; alert on each failure
 * - additional_honeytokens: deploy 2+ honeytokens in the namespace
 *
 * All actions are logged to the audit log with type, target, timestamp, classification, and result.
 */
export async function executeResponse(
  plan: ResponsePlan,
  assessment: ThreatAssessment,
  deps: ResponseExecutorDependencies
): Promise<ResponseExecutionResult> {
  const actions: ResponseAction[] = [];
  const criticalFailures: string[] = [];

  // Sort actions by priority (lower number = higher priority)
  const sortedActions = [...plan.actions].sort(
    (a, b) => a.priority - b.priority
  );

  for (const plannedAction of sortedActions) {
    const result = await executeSingleAction(
      plannedAction,
      plan,
      assessment,
      deps,
      criticalFailures
    );
    actions.push(result);
  }

  const allSucceeded = actions.every((a) => a.result === "success");

  return {
    actions,
    allSucceeded,
    criticalFailures,
  };
}

/**
 * Executes a single planned action with appropriate retry logic.
 */
async function executeSingleAction(
  plannedAction: PlannedAction,
  plan: ResponsePlan,
  assessment: ThreatAssessment,
  deps: ResponseExecutorDependencies,
  criticalFailures: string[]
): Promise<ResponseAction> {
  const actionId = uuidv4();
  const timestamp = new Date().toISOString();

  let result: "success" | "failure" = "failure";
  let retryCount = 0;

  switch (plannedAction.actionType) {
    case "pod_isolation":
      ({ result, retryCount } = await executePodIsolation(
        plan.podId,
        deps,
        criticalFailures
      ));
      break;

    case "ip_block":
      ({ result, retryCount } = await executeIpBlock(plan.podId, deps));
      break;

    case "additional_honeytokens":
      ({ result, retryCount } = await executeHoneytokenDeployment(
        plan.namespace,
        deps
      ));
      break;
  }

  const responseAction: ResponseAction = {
    actionId,
    actionType: plannedAction.actionType,
    target: plannedAction.target,
    timestamp,
    threatClassification: assessment.classification,
    result,
    retryCount,
  };

  // Log the action to the audit log
  deps.auditLog.log({
    decisionType: "response",
    decisionRationale: `Executed ${plannedAction.actionType} for ${assessment.classification} threat`,
    inputDataSummary: `target=${plannedAction.target}, classification=${assessment.classification}, assessmentId=${assessment.assessmentId}`,
    outcome: `${result} (retries: ${retryCount})`,
  });

  return responseAction;
}

/**
 * Executes pod isolation with retry logic.
 * - 3 retries, 5s interval
 * - Alert on each failure
 * - Critical alert on exhaustion
 */
async function executePodIsolation(
  podId: string,
  deps: ResponseExecutorDependencies,
  criticalFailures: string[]
): Promise<{ result: "success" | "failure"; retryCount: number }> {
  let retryCount = 0;

  try {
    await retryWithFixedInterval({
      operation: () => deps.isolatePod(podId),
      maxRetries: 3,
      intervalSeconds: 5,
      onRetry: async (attempt, error) => {
        retryCount = attempt + 1;
        await deps.sendAlert(
          `Pod isolation failed for ${podId} (attempt ${attempt + 1}): ${error.message}. Retrying...`
        );
      },
    });
    return { result: "success", retryCount };
  } catch (error) {
    retryCount = 3;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Critical alert on exhaustion
    await deps.sendAlert(
      `CRITICAL: Pod isolation failed for ${podId} after all retries exhausted. Manual intervention required. Last error: ${errorMessage}`
    );
    criticalFailures.push(
      `Pod isolation failed for ${podId}: ${errorMessage}`
    );

    return { result: "failure", retryCount };
  }
}

/**
 * Executes IP blocking with retry logic.
 * - 3 retries, 5s interval
 * - Alert on each failure
 */
async function executeIpBlock(
  podId: string,
  deps: ResponseExecutorDependencies
): Promise<{ result: "success" | "failure"; retryCount: number }> {
  let retryCount = 0;

  try {
    await retryWithFixedInterval({
      operation: () => deps.blockIp(podId),
      maxRetries: 3,
      intervalSeconds: 5,
      onRetry: async (attempt, error) => {
        retryCount = attempt + 1;
        await deps.sendAlert(
          `IP block failed for ${podId} (attempt ${attempt + 1}): ${error.message}. Retrying...`
        );
      },
    });
    return { result: "success", retryCount };
  } catch (error) {
    retryCount = 3;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await deps.sendAlert(
      `IP block failed for ${podId} after all retries exhausted. Last error: ${errorMessage}`
    );

    return { result: "failure", retryCount };
  }
}

/**
 * Executes honeytoken deployment (2+ honeytokens in the namespace).
 */
async function executeHoneytokenDeployment(
  namespace: string,
  deps: ResponseExecutorDependencies
): Promise<{ result: "success" | "failure"; retryCount: number }> {
  try {
    await deps.deployHoneytokens(namespace, 2);
    return { result: "success", retryCount: 0 };
  } catch {
    return { result: "failure", retryCount: 0 };
  }
}
