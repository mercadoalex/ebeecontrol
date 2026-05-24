/**
 * Deployment Orchestrator - Wires the Ebeecontrol Agent to Koney Deployer
 * for honeytoken placement, registry updates, and Tetragon path registration.
 *
 * Coordinates the deployment workflow:
 * 1. For each target pod, calls KoneyDeployer.deploy()
 * 2. On success: updates HoneytokenRegistry and registers paths with TetragonMonitor
 * 3. On failure: logs the error and includes remediation actions in the result
 *
 * Validates: Requirements 2.1, 2.3, 2.4, 2.6
 */

import { HighRiskService, HoneytokenRegistryEntry } from "../types/index";
import { KoneyDeployer, HoneytokenSpec, DeploymentRequest } from "../koney/deployer";
import { HoneytokenRegistry } from "./registry";
import { TetragonMonitor, HoneytokenPath } from "../tetragon/monitor";

// --- Interfaces ---

export interface DeploymentOrchestrationResult {
  totalTargets: number;
  successfulDeployments: number;
  failedDeployments: number;
  deployedHoneytokens: HoneytokenRegistryEntry[];
  errors: { podId: string; namespace: string; reason: string; remediationActions: string[] }[];
}

export interface DeploymentOrchestratorDependencies {
  deployer: KoneyDeployer;
  registry: HoneytokenRegistry;
  tetragonMonitor: TetragonMonitor;
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export interface DeploymentOrchestrator {
  deployToTargets(targets: HighRiskService[]): Promise<DeploymentOrchestrationResult>;
}

// --- Default honeytoken specs ---

/**
 * Generates a default set of honeytoken specs for a target pod.
 * Deploys one of each type to maximize detection coverage.
 */
function generateDefaultHoneytokenSpecs(podId: string): HoneytokenSpec[] {
  return [
    {
      type: "decoy_secret",
      name: `secret-${podId}`,
      placement: `/var/run/secrets/kubernetes.io/serviceaccount/decoy-token-${podId}`,
    },
    {
      type: "decoy_file",
      name: `file-${podId}`,
      placement: `/tmp/.config/credentials-${podId}.json`,
    },
    {
      type: "decoy_credential",
      name: `cred-${podId}`,
      placement: `/home/app/.ssh/id_rsa_${podId}`,
    },
  ];
}

// --- No-op logger ---

const noopLogger = {
  info: (_message: string) => {},
  warn: (_message: string) => {},
  error: (_message: string) => {},
};

// --- Implementation ---

/**
 * Creates a DeploymentOrchestrator that coordinates honeytoken deployment
 * across multiple target pods.
 */
export function createDeploymentOrchestrator(
  dependencies: DeploymentOrchestratorDependencies
): DeploymentOrchestrator {
  const { deployer, registry, tetragonMonitor } = dependencies;
  const logger = dependencies.logger ?? noopLogger;

  return {
    async deployToTargets(targets: HighRiskService[]): Promise<DeploymentOrchestrationResult> {
      const result: DeploymentOrchestrationResult = {
        totalTargets: targets.length,
        successfulDeployments: 0,
        failedDeployments: 0,
        deployedHoneytokens: [],
        errors: [],
      };

      for (const target of targets) {
        // Deploy to each pod in the target service
        for (const podId of target.podIdentifiers) {
          const honeytokenSpecs = generateDefaultHoneytokenSpecs(podId);

          const request: DeploymentRequest = {
            podId,
            namespace: target.namespace,
            honeytokens: honeytokenSpecs,
          };

          try {
            const response = await deployer.deploy(request);

            if (response.success) {
              result.successfulDeployments++;

              // Update registry and register paths with Tetragon for each deployed honeytoken
              for (const deployed of response.deployedHoneytokens) {
                const registryEntry: HoneytokenRegistryEntry = {
                  honeytokenId: deployed.honeytokenId,
                  podId: deployed.podId,
                  namespace: deployed.namespace,
                  type: deployed.type,
                  filePath: deployed.filePath,
                  deploymentTimestamp: deployed.deploymentTimestamp,
                  status: "active",
                  accessCount: 0,
                };

                registry.addEntry(registryEntry);
                result.deployedHoneytokens.push(registryEntry);

                // Register the honeytoken path with Tetragon Monitor
                const honeytokenPath: HoneytokenPath = {
                  podId: deployed.podId,
                  namespace: deployed.namespace,
                  filePath: deployed.filePath,
                  honeytokenId: deployed.honeytokenId,
                };

                await tetragonMonitor.registerHoneytokenPath(honeytokenPath);
              }

              logger.info(
                `Successfully deployed ${response.deployedHoneytokens.length} honeytokens to pod ${podId} in namespace ${target.namespace}`
              );
            } else {
              // Deployment returned success=false with errors
              result.failedDeployments++;

              for (const error of response.errors) {
                const errorEntry = {
                  podId: error.podId,
                  namespace: target.namespace,
                  reason: error.failureReason,
                  remediationActions: [...error.remediationActions],
                };
                result.errors.push(errorEntry);

                logger.error(
                  `Deployment failed for pod ${error.podId} in namespace ${target.namespace}: ${error.failureReason}`
                );
              }
            }
          } catch (err) {
            // Unexpected error during deployment
            result.failedDeployments++;

            const reason = err instanceof Error ? err.message : String(err);
            const errorEntry = {
              podId,
              namespace: target.namespace,
              reason,
              remediationActions: ["retry_deployment", "escalate_to_operator"],
            };
            result.errors.push(errorEntry);

            logger.error(
              `Unexpected deployment error for pod ${podId} in namespace ${target.namespace}: ${reason}`
            );
          }
        }
      }

      logger.info(
        `Deployment orchestration complete: ${result.successfulDeployments} successful, ${result.failedDeployments} failed out of ${result.totalTargets} targets`
      );

      return result;
    },
  };
}
