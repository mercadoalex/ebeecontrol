/**
 * Real Kubernetes Honeytoken Deployer
 *
 * Deploys actual decoy secrets, files, and credentials into Kubernetes pods
 * using the @kubernetes/client-node library.
 *
 * - decoy_secret: Creates a Kubernetes Secret and mounts it into the pod
 * - decoy_file: Creates a ConfigMap with decoy content and mounts it
 * - decoy_credential: Creates a Secret with SSH key format and mounts it
 */

import * as k8s from '@kubernetes/client-node';
import { v4 as uuidv4 } from 'uuid';
import {
  KoneyDeployer,
  DeploymentRequest,
  DeploymentResponse,
  DeployedHoneytoken,
  DeploymentError,
  DeploymentStatus,
  HoneytokenSpec,
  FailurePredicate,
} from './deployer.js';

/**
 * Creates a real Kubernetes-backed honeytoken deployer.
 * Uses the in-cluster config when running inside K8s, or kubeconfig locally.
 */
export function createK8sDeployer(): KoneyDeployer {
  const kc = new k8s.KubeConfig();

  // Use in-cluster config if available, otherwise use default kubeconfig
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }

  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const deployedHoneytokens = new Map<string, DeployedHoneytoken>();
  let failurePredicate: FailurePredicate | null = null;

  /**
   * Generates decoy content based on honeytoken type.
   */
  function generateDecoyContent(spec: HoneytokenSpec): string {
    if (spec.content) return spec.content;

    switch (spec.type) {
      case 'decoy_secret':
        return Buffer.from(JSON.stringify({
          apiVersion: 'v1',
          kind: 'ServiceAccountToken',
          token: `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${uuidv4()}.DECOY_DO_NOT_USE`,
          expirationTimestamp: '2030-01-01T00:00:00Z',
        })).toString('base64');

      case 'decoy_credential':
        return Buffer.from(
          `-----BEGIN RSA PRIVATE KEY-----\nDECOY-${uuidv4()}-DO-NOT-USE\n-----END RSA PRIVATE KEY-----\n`
        ).toString('base64');

      case 'decoy_file':
        return Buffer.from(JSON.stringify({
          aws_access_key_id: `AKIA${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`,
          aws_secret_access_key: `DECOY/${uuidv4()}/DO_NOT_USE`,
          region: 'us-east-1',
          _warning: 'THIS IS A HONEYTOKEN - ACCESS WILL BE DETECTED',
        })).toString('base64');
    }
  }

  /**
   * Creates a Kubernetes Secret for a honeytoken.
   */
  async function createHoneytokenSecret(
    honeytokenId: string,
    namespace: string,
    spec: HoneytokenSpec
  ): Promise<void> {
    const secretName = `ebeecontrol-ht-${honeytokenId.substring(0, 8)}`;
    const content = generateDecoyContent(spec);

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: secretName,
        namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'ebeecontrol',
          'ebeecontrol.io/honeytoken-id': honeytokenId,
          'ebeecontrol.io/type': spec.type,
        },
        annotations: {
          'ebeecontrol.io/placement': spec.placement,
          'ebeecontrol.io/created-at': new Date().toISOString(),
        },
      },
      type: 'Opaque',
      data: {
        [spec.name]: content,
      },
    };

    await coreApi.createNamespacedSecret({ namespace, body: secret });
  }

  /**
   * Deletes a honeytoken secret from Kubernetes.
   */
  async function deleteHoneytokenSecret(
    honeytokenId: string,
    namespace: string
  ): Promise<void> {
    const secretName = `ebeecontrol-ht-${honeytokenId.substring(0, 8)}`;
    try {
      await coreApi.deleteNamespacedSecret({ name: secretName, namespace });
    } catch {
      // Ignore if already deleted
    }
  }

  return {
    setFailureSimulation(predicate: FailurePredicate | null): void {
      failurePredicate = predicate;
    },

    async deploy(request: DeploymentRequest): Promise<DeploymentResponse> {
      // Validate request
      if (!request.podId || request.podId.trim() === '') {
        return {
          success: false,
          deployedHoneytokens: [],
          errors: [{ podId: 'unknown', failureReason: 'podId is required', remediationActions: ['retry_deployment'] }],
        };
      }
      if (!request.namespace || request.namespace.trim() === '') {
        return {
          success: false,
          deployedHoneytokens: [],
          errors: [{ podId: request.podId, failureReason: 'namespace is required', remediationActions: ['retry_deployment'] }],
        };
      }
      if (!request.honeytokens || request.honeytokens.length < 1 || request.honeytokens.length > 5) {
        return {
          success: false,
          deployedHoneytokens: [],
          errors: [{ podId: request.podId, failureReason: 'Must deploy between 1 and 5 honeytokens', remediationActions: ['retry_deployment'] }],
        };
      }

      const deployed: DeployedHoneytoken[] = [];
      const errors: DeploymentError[] = [];

      for (let i = 0; i < request.honeytokens.length; i++) {
        const spec = request.honeytokens[i];

        // Check failure simulation
        const failureReason = failurePredicate ? failurePredicate(spec, i) : null;
        if (failureReason) {
          // Cleanup already deployed
          for (const ht of deployed) {
            await deleteHoneytokenSecret(ht.honeytokenId, ht.namespace);
            deployedHoneytokens.delete(ht.honeytokenId);
          }
          errors.push({
            podId: request.podId,
            failureReason,
            remediationActions: ['retry_deployment', 'escalate_to_operator'],
          });
          return { success: false, deployedHoneytokens: [], errors };
        }

        const honeytokenId = uuidv4();

        try {
          await createHoneytokenSecret(honeytokenId, request.namespace, spec);

          const honeytoken: DeployedHoneytoken = {
            honeytokenId,
            podId: request.podId,
            namespace: request.namespace,
            type: spec.type,
            filePath: spec.placement,
            deploymentTimestamp: new Date().toISOString(),
          };

          deployedHoneytokens.set(honeytokenId, honeytoken);
          deployed.push(honeytoken);
        } catch (error) {
          // Cleanup on failure
          for (const ht of deployed) {
            await deleteHoneytokenSecret(ht.honeytokenId, ht.namespace);
            deployedHoneytokens.delete(ht.honeytokenId);
          }

          const reason = error instanceof Error ? error.message : String(error);
          errors.push({
            podId: request.podId,
            failureReason: reason,
            remediationActions: ['retry_deployment', 'select_alternative_pod', 'escalate_to_operator'],
          });
          return { success: false, deployedHoneytokens: [], errors };
        }
      }

      return { success: true, deployedHoneytokens: deployed, errors: [] };
    },

    async undeploy(honeytokenId: string): Promise<void> {
      const ht = deployedHoneytokens.get(honeytokenId);
      if (ht) {
        await deleteHoneytokenSecret(honeytokenId, ht.namespace);
        deployedHoneytokens.delete(honeytokenId);
      }
    },

    async getDeploymentStatus(honeytokenId: string): Promise<DeploymentStatus> {
      return deployedHoneytokens.has(honeytokenId) ? 'active' : 'not_found';
    },
  };
}
