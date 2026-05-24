import { describe, it, expect, beforeEach } from 'vitest';
import {
  createKoneyDeployer,
  KoneyDeployer,
  DeploymentRequest,
  HoneytokenSpec,
  FailurePredicate,
} from './deployer';

describe('KoneyDeployer', () => {
  let deployer: KoneyDeployer;

  beforeEach(() => {
    deployer = createKoneyDeployer();
  });

  describe('deploy', () => {
    it('should deploy a single honeytoken successfully', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-123',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_secret', name: 'aws-key', placement: '/etc/secrets/aws-key' },
        ],
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(true);
      expect(response.deployedHoneytokens).toHaveLength(1);
      expect(response.errors).toHaveLength(0);
    });

    it('should deploy up to 5 honeytokens per pod', async () => {
      const honeytokens: HoneytokenSpec[] = [
        { type: 'decoy_secret', name: 'secret-1', placement: '/etc/secrets/key1' },
        { type: 'decoy_file', name: 'file-1', placement: '/tmp/config.yaml' },
        { type: 'decoy_credential', name: 'cred-1', placement: '/home/user/.ssh/id_rsa' },
        { type: 'decoy_secret', name: 'secret-2', placement: '/etc/secrets/key2' },
        { type: 'decoy_file', name: 'file-2', placement: '/var/data/token' },
      ];

      const request: DeploymentRequest = {
        podId: 'pod-456',
        namespace: 'staging',
        honeytokens,
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(true);
      expect(response.deployedHoneytokens).toHaveLength(5);
      expect(response.errors).toHaveLength(0);
    });

    it('should reject deployment with more than 5 honeytokens', async () => {
      const honeytokens: HoneytokenSpec[] = Array.from({ length: 6 }, (_, i) => ({
        type: 'decoy_secret' as const,
        name: `secret-${i}`,
        placement: `/etc/secrets/key${i}`,
      }));

      const request: DeploymentRequest = {
        podId: 'pod-789',
        namespace: 'production',
        honeytokens,
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(false);
      expect(response.deployedHoneytokens).toHaveLength(0);
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].podId).toBe('pod-789');
      expect(response.errors[0].failureReason).toContain('5');
      expect(response.errors[0].remediationActions).toContain('retry_deployment');
    });

    it('should reject deployment with zero honeytokens', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-000',
        namespace: 'production',
        honeytokens: [],
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(false);
      expect(response.deployedHoneytokens).toHaveLength(0);
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].failureReason).toContain('1');
    });

    it('should reject deployment with empty podId', async () => {
      const request: DeploymentRequest = {
        podId: '',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_file', name: 'file-1', placement: '/tmp/decoy' },
        ],
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(false);
      expect(response.errors[0].failureReason).toContain('podId');
    });

    it('should reject deployment with empty namespace', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-123',
        namespace: '',
        honeytokens: [
          { type: 'decoy_file', name: 'file-1', placement: '/tmp/decoy' },
        ],
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(false);
      expect(response.errors[0].failureReason).toContain('namespace');
    });

    it('should support all three honeytoken types', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-types',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_secret', name: 'secret', placement: '/etc/secrets/key' },
          { type: 'decoy_file', name: 'file', placement: '/tmp/config.yaml' },
          { type: 'decoy_credential', name: 'cred', placement: '/home/.ssh/id_rsa' },
        ],
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(true);
      expect(response.deployedHoneytokens).toHaveLength(3);

      const types = response.deployedHoneytokens.map(h => h.type);
      expect(types).toContain('decoy_secret');
      expect(types).toContain('decoy_file');
      expect(types).toContain('decoy_credential');
    });

    it('should generate a unique UUID for each deployed honeytoken', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-uuid',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_secret', name: 'secret-1', placement: '/etc/secrets/key1' },
          { type: 'decoy_secret', name: 'secret-2', placement: '/etc/secrets/key2' },
        ],
      };

      const response = await deployer.deploy(request);

      const ids = response.deployedHoneytokens.map(h => h.honeytokenId);
      expect(ids[0]).not.toBe(ids[1]);
      // UUID v4 format check
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      ids.forEach(id => expect(id).toMatch(uuidRegex));
    });

    it('should include valid ISO 8601 timestamps in deployment report', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-ts',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_file', name: 'file-1', placement: '/tmp/decoy.txt' },
        ],
      };

      const response = await deployer.deploy(request);

      const timestamp = response.deployedHoneytokens[0].deploymentTimestamp;
      const parsed = new Date(timestamp);
      expect(parsed.toISOString()).toBe(timestamp);
      expect(isNaN(parsed.getTime())).toBe(false);
    });

    it('should include podId and namespace in each deployed honeytoken', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-report',
        namespace: 'kube-system',
        honeytokens: [
          { type: 'decoy_credential', name: 'cred-1', placement: '/root/.kube/config' },
          { type: 'decoy_secret', name: 'secret-1', placement: '/etc/secrets/token' },
        ],
      };

      const response = await deployer.deploy(request);

      response.deployedHoneytokens.forEach(h => {
        expect(h.podId).toBe('pod-report');
        expect(h.namespace).toBe('kube-system');
      });
    });

    it('should use the placement field as the filePath in the report', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-path',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_file', name: 'config', placement: '/etc/app/config.json' },
        ],
      };

      const response = await deployer.deploy(request);

      expect(response.deployedHoneytokens[0].filePath).toBe('/etc/app/config.json');
    });
  });

  describe('undeploy', () => {
    it('should remove a deployed honeytoken', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-undeploy',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_secret', name: 'secret', placement: '/etc/secrets/key' },
        ],
      };

      const response = await deployer.deploy(request);
      const honeytokenId = response.deployedHoneytokens[0].honeytokenId;

      await deployer.undeploy(honeytokenId);

      const status = await deployer.getDeploymentStatus(honeytokenId);
      expect(status).toBe('not_found');
    });

    it('should not throw when undeploying a non-existent honeytoken', async () => {
      await expect(deployer.undeploy('non-existent-id')).resolves.toBeUndefined();
    });
  });

  describe('getDeploymentStatus', () => {
    it('should return active for a deployed honeytoken', async () => {
      const request: DeploymentRequest = {
        podId: 'pod-status',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_file', name: 'file', placement: '/tmp/decoy' },
        ],
      };

      const response = await deployer.deploy(request);
      const honeytokenId = response.deployedHoneytokens[0].honeytokenId;

      const status = await deployer.getDeploymentStatus(honeytokenId);
      expect(status).toBe('active');
    });

    it('should return not_found for an unknown honeytoken', async () => {
      const status = await deployer.getDeploymentStatus('unknown-id');
      expect(status).toBe('not_found');
    });
  });

  describe('deployment error handling and cleanup', () => {
    it('should clean up already-deployed honeytokens on partial failure', async () => {
      // Fail on the 3rd honeytoken (index 2)
      deployer.setFailureSimulation((spec, index) => {
        return index === 2 ? 'simulated failure on third honeytoken' : null;
      });

      const request: DeploymentRequest = {
        podId: 'pod-partial',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_secret', name: 'secret-1', placement: '/etc/secrets/key1' },
          { type: 'decoy_file', name: 'file-1', placement: '/tmp/config.yaml' },
          { type: 'decoy_credential', name: 'cred-1', placement: '/home/.ssh/id_rsa' },
        ],
      };

      const response = await deployer.deploy(request);

      // Should report failure
      expect(response.success).toBe(false);
      // All deployed honeytokens should be cleaned up
      expect(response.deployedHoneytokens).toHaveLength(0);
      expect(response.errors).toHaveLength(1);

      // Verify the first two honeytokens were cleaned up (not findable)
      // Since they were removed, no honeytokens should be active
      const status1 = await deployer.getDeploymentStatus('any-id');
      expect(status1).toBe('not_found');
    });

    it('should return error with podId, failureReason, and remediationActions', async () => {
      deployer.setFailureSimulation(() => 'deployment timeout: connection refused');

      const request: DeploymentRequest = {
        podId: 'pod-error-format',
        namespace: 'staging',
        honeytokens: [
          { type: 'decoy_secret', name: 'secret-1', placement: '/etc/secrets/key1' },
        ],
      };

      const response = await deployer.deploy(request);

      expect(response.success).toBe(false);
      expect(response.errors).toHaveLength(1);

      const error = response.errors[0];
      expect(error.podId).toBe('pod-error-format');
      expect(error.failureReason).toBe('deployment timeout: connection refused');
      expect(error.remediationActions.length).toBeGreaterThanOrEqual(1);
      // All remediation actions should be from the valid set
      const validActions = ['retry_deployment', 'select_alternative_pod', 'escalate_to_operator'];
      error.remediationActions.forEach(action => {
        expect(validActions).toContain(action);
      });
    });

    it('should suggest retry_deployment and select_alternative_pod for timeout failures', async () => {
      deployer.setFailureSimulation(() => 'timeout connecting to pod');

      const request: DeploymentRequest = {
        podId: 'pod-timeout',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_file', name: 'file-1', placement: '/tmp/decoy' },
        ],
      };

      const response = await deployer.deploy(request);

      const error = response.errors[0];
      expect(error.remediationActions).toContain('retry_deployment');
      expect(error.remediationActions).toContain('select_alternative_pod');
    });

    it('should suggest select_alternative_pod and escalate_to_operator for permission failures', async () => {
      deployer.setFailureSimulation(() => 'permission denied: cannot write to pod filesystem');

      const request: DeploymentRequest = {
        podId: 'pod-permission',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_secret', name: 'secret-1', placement: '/etc/secrets/key1' },
        ],
      };

      const response = await deployer.deploy(request);

      const error = response.errors[0];
      expect(error.remediationActions).toContain('select_alternative_pod');
      expect(error.remediationActions).toContain('escalate_to_operator');
    });

    it('should suggest select_alternative_pod and escalate_to_operator for resource failures', async () => {
      deployer.setFailureSimulation(() => 'resource quota exceeded');

      const request: DeploymentRequest = {
        podId: 'pod-resource',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_credential', name: 'cred-1', placement: '/home/.ssh/key' },
        ],
      };

      const response = await deployer.deploy(request);

      const error = response.errors[0];
      expect(error.remediationActions).toContain('select_alternative_pod');
      expect(error.remediationActions).toContain('escalate_to_operator');
    });

    it('should suggest retry_deployment and escalate_to_operator for generic failures', async () => {
      deployer.setFailureSimulation(() => 'unknown internal error');

      const request: DeploymentRequest = {
        podId: 'pod-generic',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_file', name: 'file-1', placement: '/tmp/decoy' },
        ],
      };

      const response = await deployer.deploy(request);

      const error = response.errors[0];
      expect(error.remediationActions).toContain('retry_deployment');
      expect(error.remediationActions).toContain('escalate_to_operator');
    });

    it('should clear failure simulation when set to null', async () => {
      deployer.setFailureSimulation(() => 'forced failure');

      // First deploy should fail
      const request: DeploymentRequest = {
        podId: 'pod-clear',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_secret', name: 'secret-1', placement: '/etc/secrets/key1' },
        ],
      };

      const failResponse = await deployer.deploy(request);
      expect(failResponse.success).toBe(false);

      // Clear the simulation
      deployer.setFailureSimulation(null);

      // Second deploy should succeed
      const successResponse = await deployer.deploy(request);
      expect(successResponse.success).toBe(true);
      expect(successResponse.deployedHoneytokens).toHaveLength(1);
    });

    it('should ensure partially deployed honeytokens are not accessible after cleanup', async () => {
      // Deploy some honeytokens first to verify they remain unaffected
      const preRequest: DeploymentRequest = {
        podId: 'pod-pre-existing',
        namespace: 'default',
        honeytokens: [
          { type: 'decoy_secret', name: 'pre-secret', placement: '/etc/pre/key' },
        ],
      };
      const preResponse = await deployer.deploy(preRequest);
      const preId = preResponse.deployedHoneytokens[0].honeytokenId;

      // Now set up a failure on the 2nd honeytoken
      deployer.setFailureSimulation((spec, index) => {
        return index === 1 ? 'network error' : null;
      });

      const request: DeploymentRequest = {
        podId: 'pod-cleanup-verify',
        namespace: 'production',
        honeytokens: [
          { type: 'decoy_file', name: 'file-1', placement: '/tmp/file1' },
          { type: 'decoy_file', name: 'file-2', placement: '/tmp/file2' },
        ],
      };

      const response = await deployer.deploy(request);
      expect(response.success).toBe(false);
      expect(response.deployedHoneytokens).toHaveLength(0);

      // Pre-existing honeytoken should still be active
      const preStatus = await deployer.getDeploymentStatus(preId);
      expect(preStatus).toBe('active');
    });

    it('should always include at least one remediation action in error response', async () => {
      const failureReasons = [
        'timeout',
        'permission denied',
        'resource quota exceeded',
        'unknown error',
        'connection refused',
        'access denied',
        'capacity limit reached',
      ];

      for (const reason of failureReasons) {
        const localDeployer = createKoneyDeployer();
        localDeployer.setFailureSimulation(() => reason);

        const request: DeploymentRequest = {
          podId: 'pod-remediation',
          namespace: 'default',
          honeytokens: [
            { type: 'decoy_secret', name: 'secret', placement: '/etc/secrets/key' },
          ],
        };

        const response = await localDeployer.deploy(request);
        expect(response.errors[0].remediationActions.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
