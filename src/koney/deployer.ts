/**
 * Koney Deployer - Honeytoken deployment component for Kubernetes pods.
 *
 * Responsible for deploying decoy secrets, files, and credentials into
 * targeted Kubernetes pods. Currently simulates deployment; actual K8s
 * interaction will be wired in a later task.
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 */

import { v4 as uuidv4 } from 'uuid';

// --- Interfaces ---

export type HoneytokenType = "decoy_secret" | "decoy_file" | "decoy_credential";

export interface HoneytokenSpec {
  type: HoneytokenType;
  name: string;
  placement: string; // file path or secret name
  content?: string; // generated if not provided
}

export interface DeploymentRequest {
  podId: string;
  namespace: string;
  honeytokens: HoneytokenSpec[];
}

export interface DeployedHoneytoken {
  honeytokenId: string;
  podId: string;
  namespace: string;
  type: HoneytokenType;
  filePath: string;
  deploymentTimestamp: string; // ISO 8601
}

export interface DeploymentError {
  podId: string;
  failureReason: string;
  remediationActions: ("retry_deployment" | "select_alternative_pod" | "escalate_to_operator")[];
}

export interface DeploymentResponse {
  success: boolean;
  deployedHoneytokens: DeployedHoneytoken[];
  errors: DeploymentError[];
}

export type DeploymentStatus = "active" | "triggered" | "decommissioned" | "not_found";

export type FailurePredicate = (spec: HoneytokenSpec, index: number) => string | null;

export interface KoneyDeployer {
  deploy(request: DeploymentRequest): Promise<DeploymentResponse>;
  undeploy(honeytokenId: string): Promise<void>;
  getDeploymentStatus(honeytokenId: string): Promise<DeploymentStatus>;
  setFailureSimulation(predicate: FailurePredicate | null): void;
}

// --- Validation ---

const MIN_HONEYTOKENS = 1;
const MAX_HONEYTOKENS = 5;

function validateDeploymentRequest(request: DeploymentRequest): string | null {
  if (!request.podId || request.podId.trim() === '') {
    return 'podId is required';
  }
  if (!request.namespace || request.namespace.trim() === '') {
    return 'namespace is required';
  }
  if (!request.honeytokens || request.honeytokens.length < MIN_HONEYTOKENS) {
    return `At least ${MIN_HONEYTOKENS} honeytoken must be specified`;
  }
  if (request.honeytokens.length > MAX_HONEYTOKENS) {
    return `At most ${MAX_HONEYTOKENS} honeytokens can be deployed per pod`;
  }
  return null;
}

// --- Remediation Action Selection ---

type RemediationAction = "retry_deployment" | "select_alternative_pod" | "escalate_to_operator";

function selectRemediationActions(failureReason: string): RemediationAction[] {
  const reason = failureReason.toLowerCase();

  if (reason.includes('permission') || reason.includes('access denied') || reason.includes('forbidden')) {
    return ['select_alternative_pod', 'escalate_to_operator'];
  }
  if (reason.includes('timeout') || reason.includes('network') || reason.includes('connection')) {
    return ['retry_deployment', 'select_alternative_pod'];
  }
  if (reason.includes('resource') || reason.includes('capacity') || reason.includes('quota')) {
    return ['select_alternative_pod', 'escalate_to_operator'];
  }
  // Default: suggest retry first, then escalate
  return ['retry_deployment', 'escalate_to_operator'];
}

// --- Implementation ---

export function createKoneyDeployer(): KoneyDeployer {
  const deployedHoneytokens = new Map<string, DeployedHoneytoken>();
  let failurePredicate: FailurePredicate | null = null;

  return {
    setFailureSimulation(predicate: FailurePredicate | null): void {
      failurePredicate = predicate;
    },

    async deploy(request: DeploymentRequest): Promise<DeploymentResponse> {
      const validationError = validateDeploymentRequest(request);
      if (validationError) {
        return {
          success: false,
          deployedHoneytokens: [],
          errors: [{
            podId: request.podId || 'unknown',
            failureReason: validationError,
            remediationActions: ['retry_deployment'],
          }],
        };
      }

      const deployed: DeployedHoneytoken[] = [];
      const errors: DeploymentError[] = [];

      for (let i = 0; i < request.honeytokens.length; i++) {
        const spec = request.honeytokens[i];

        // Check if this honeytoken should simulate a failure
        const failureReason = failurePredicate ? failurePredicate(spec, i) : null;

        if (failureReason) {
          // Partial deployment failure: clean up already-deployed honeytokens from this batch
          for (const alreadyDeployed of deployed) {
            deployedHoneytokens.delete(alreadyDeployed.honeytokenId);
          }

          errors.push({
            podId: request.podId,
            failureReason,
            remediationActions: selectRemediationActions(failureReason),
          });

          // Return immediately with cleanup done and error reported
          return {
            success: false,
            deployedHoneytokens: [],
            errors,
          };
        }

        const honeytokenId = uuidv4();
        const deploymentTimestamp = new Date().toISOString();

        const honeytoken: DeployedHoneytoken = {
          honeytokenId,
          podId: request.podId,
          namespace: request.namespace,
          type: spec.type,
          filePath: spec.placement,
          deploymentTimestamp,
        };

        // Simulate deployment (actual K8s interaction will be wired later)
        deployedHoneytokens.set(honeytokenId, honeytoken);
        deployed.push(honeytoken);
      }

      return {
        success: deployed.length > 0 && errors.length === 0,
        deployedHoneytokens: deployed,
        errors,
      };
    },

    async undeploy(honeytokenId: string): Promise<void> {
      deployedHoneytokens.delete(honeytokenId);
    },

    async getDeploymentStatus(honeytokenId: string): Promise<DeploymentStatus> {
      const honeytoken = deployedHoneytokens.get(honeytokenId);
      if (!honeytoken) {
        return 'not_found';
      }
      return 'active';
    },
  };
}
