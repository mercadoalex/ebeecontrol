import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createDeploymentOrchestrator,
  DeploymentOrchestrator,
  DeploymentOrchestratorDependencies,
} from "./deployment-orchestrator";
import { KoneyDeployer, DeploymentRequest, DeploymentResponse } from "../koney/deployer";
import { HoneytokenRegistry } from "./registry";
import { TetragonMonitor, HoneytokenPath } from "../tetragon/monitor";
import { HighRiskService } from "../types/index";

// --- Test Helpers ---

function createMockDeployer(overrides: Partial<KoneyDeployer> = {}): KoneyDeployer {
  return {
    deploy: vi.fn().mockImplementation(async (request: DeploymentRequest): Promise<DeploymentResponse> => {
      const deployedHoneytokens = request.honeytokens.map((spec, i) => ({
        honeytokenId: `ht-${request.podId}-${i}`,
        podId: request.podId,
        namespace: request.namespace,
        type: spec.type,
        filePath: spec.placement,
        deploymentTimestamp: new Date().toISOString(),
      }));
      return {
        success: true,
        deployedHoneytokens,
        errors: [],
      };
    }),
    undeploy: vi.fn().mockResolvedValue(undefined),
    getDeploymentStatus: vi.fn().mockResolvedValue("active"),
    setFailureSimulation: vi.fn(),
    ...overrides,
  };
}

function createMockRegistry(overrides: Partial<HoneytokenRegistry> = {}): HoneytokenRegistry {
  const entries = new Map();
  return {
    addEntry: vi.fn((entry) => entries.set(entry.honeytokenId, entry)),
    updateStatus: vi.fn().mockReturnValue(true),
    recordAccess: vi.fn().mockReturnValue(true),
    getById: vi.fn((id) => entries.get(id)),
    getByPod: vi.fn().mockReturnValue([]),
    getByNamespace: vi.fn().mockReturnValue([]),
    getAll: vi.fn(() => Array.from(entries.values())),
    getActive: vi.fn().mockReturnValue([]),
    remove: vi.fn().mockReturnValue(true),
    getSize: vi.fn(() => entries.size),
    ...overrides,
  };
}

function createMockTetragonMonitor(overrides: Partial<TetragonMonitor> = {}): TetragonMonitor {
  const paths: HoneytokenPath[] = [];
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    registerHoneytokenPath: vi.fn(async (path: HoneytokenPath) => { paths.push(path); }),
    unregisterHoneytokenPath: vi.fn().mockResolvedValue(undefined),
    getRegisteredPaths: vi.fn(async () => [...paths]),
    generateAccessEvent: vi.fn().mockReturnValue({
      eventId: "evt-1",
      processId: 1,
      processBinaryPath: "/bin/cat",
      userId: 0,
      podId: "pod-1",
      namespace: "default",
      honeytokenPath: "/tmp/decoy",
      accessType: "read",
      timestamp: new Date().toISOString(),
    }),
    getBufferStatus: vi.fn().mockReturnValue({
      currentSize: 0,
      maxCapacity: 1000,
      overflowCount: 0,
    }),
    ...overrides,
  };
}

function createTestTargets(count: number): HighRiskService[] {
  return Array.from({ length: count }, (_, i) => ({
    serviceId: `svc-${i}`,
    serviceName: `service-${i}`,
    namespace: `ns-${i}`,
    podIdentifiers: [`pod-${i}-a`],
    riskScore: 80 - i * 10,
  }));
}

function createTestDependencies(
  overrides: Partial<DeploymentOrchestratorDependencies> = {}
): DeploymentOrchestratorDependencies {
  return {
    deployer: createMockDeployer(),
    registry: createMockRegistry(),
    tetragonMonitor: createMockTetragonMonitor(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

// --- Tests ---

describe("DeploymentOrchestrator", () => {
  let orchestrator: DeploymentOrchestrator;
  let deps: DeploymentOrchestratorDependencies;

  beforeEach(() => {
    deps = createTestDependencies();
    orchestrator = createDeploymentOrchestrator(deps);
  });

  describe("deployToTargets", () => {
    it("should return correct totalTargets count", async () => {
      const targets = createTestTargets(3);
      const result = await orchestrator.deployToTargets(targets);

      expect(result.totalTargets).toBe(3);
    });

    it("should deploy honeytokens to each pod in each target", async () => {
      const targets = createTestTargets(2);
      await orchestrator.deployToTargets(targets);

      expect(deps.deployer.deploy).toHaveBeenCalledTimes(2);
    });

    it("should deploy to multiple pods within a single target service", async () => {
      const targets: HighRiskService[] = [{
        serviceId: "svc-multi",
        serviceName: "multi-pod-service",
        namespace: "production",
        podIdentifiers: ["pod-a", "pod-b", "pod-c"],
        riskScore: 90,
      }];

      await orchestrator.deployToTargets(targets);

      expect(deps.deployer.deploy).toHaveBeenCalledTimes(3);
    });

    it("should count successful deployments correctly", async () => {
      const targets = createTestTargets(3);
      const result = await orchestrator.deployToTargets(targets);

      expect(result.successfulDeployments).toBe(3);
      expect(result.failedDeployments).toBe(0);
    });

    it("should update registry for each deployed honeytoken", async () => {
      const targets = createTestTargets(1);
      const result = await orchestrator.deployToTargets(targets);

      // Default specs generate 3 honeytokens per pod
      expect(deps.registry.addEntry).toHaveBeenCalledTimes(3);
      expect(result.deployedHoneytokens).toHaveLength(3);

      // Verify registry entries have correct structure
      for (const entry of result.deployedHoneytokens) {
        expect(entry.honeytokenId).toBeDefined();
        expect(entry.podId).toBe("pod-0-a");
        expect(entry.namespace).toBe("ns-0");
        expect(entry.status).toBe("active");
        expect(entry.accessCount).toBe(0);
        expect(entry.type).toMatch(/^(decoy_secret|decoy_file|decoy_credential)$/);
        expect(entry.filePath).toBeTruthy();
        expect(entry.deploymentTimestamp).toBeTruthy();
      }
    });

    it("should register honeytoken paths with Tetragon Monitor", async () => {
      const targets = createTestTargets(1);
      await orchestrator.deployToTargets(targets);

      // 3 honeytokens per pod = 3 path registrations
      expect(deps.tetragonMonitor.registerHoneytokenPath).toHaveBeenCalledTimes(3);

      const calls = (deps.tetragonMonitor.registerHoneytokenPath as ReturnType<typeof vi.fn>).mock.calls;
      for (const [path] of calls) {
        expect(path.podId).toBe("pod-0-a");
        expect(path.namespace).toBe("ns-0");
        expect(path.filePath).toBeTruthy();
        expect(path.honeytokenId).toBeTruthy();
      }
    });

    it("should handle deployment failures with error details", async () => {
      const failingDeployer = createMockDeployer({
        deploy: vi.fn().mockResolvedValue({
          success: false,
          deployedHoneytokens: [],
          errors: [{
            podId: "pod-0-a",
            failureReason: "Permission denied: cannot write to pod filesystem",
            remediationActions: ["select_alternative_pod", "escalate_to_operator"],
          }],
        }),
      });

      deps = createTestDependencies({ deployer: failingDeployer });
      orchestrator = createDeploymentOrchestrator(deps);

      const targets = createTestTargets(1);
      const result = await orchestrator.deployToTargets(targets);

      expect(result.failedDeployments).toBe(1);
      expect(result.successfulDeployments).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].podId).toBe("pod-0-a");
      expect(result.errors[0].namespace).toBe("ns-0");
      expect(result.errors[0].reason).toContain("Permission denied");
      expect(result.errors[0].remediationActions).toContain("select_alternative_pod");
      expect(result.errors[0].remediationActions).toContain("escalate_to_operator");
    });

    it("should handle unexpected exceptions during deployment", async () => {
      const throwingDeployer = createMockDeployer({
        deploy: vi.fn().mockRejectedValue(new Error("Network timeout")),
      });

      deps = createTestDependencies({ deployer: throwingDeployer });
      orchestrator = createDeploymentOrchestrator(deps);

      const targets = createTestTargets(1);
      const result = await orchestrator.deployToTargets(targets);

      expect(result.failedDeployments).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toBe("Network timeout");
      expect(result.errors[0].remediationActions).toContain("retry_deployment");
      expect(result.errors[0].remediationActions).toContain("escalate_to_operator");
    });

    it("should handle mixed success and failure across targets", async () => {
      let callCount = 0;
      const mixedDeployer = createMockDeployer({
        deploy: vi.fn().mockImplementation(async (request: DeploymentRequest) => {
          callCount++;
          if (callCount === 2) {
            return {
              success: false,
              deployedHoneytokens: [],
              errors: [{
                podId: request.podId,
                failureReason: "Resource quota exceeded",
                remediationActions: ["select_alternative_pod", "escalate_to_operator"],
              }],
            };
          }
          return {
            success: true,
            deployedHoneytokens: request.honeytokens.map((spec, i) => ({
              honeytokenId: `ht-${request.podId}-${i}`,
              podId: request.podId,
              namespace: request.namespace,
              type: spec.type,
              filePath: spec.placement,
              deploymentTimestamp: new Date().toISOString(),
            })),
            errors: [],
          };
        }),
      });

      deps = createTestDependencies({ deployer: mixedDeployer });
      orchestrator = createDeploymentOrchestrator(deps);

      const targets = createTestTargets(3);
      const result = await orchestrator.deployToTargets(targets);

      expect(result.successfulDeployments).toBe(2);
      expect(result.failedDeployments).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.deployedHoneytokens.length).toBeGreaterThan(0);
    });

    it("should handle empty targets list", async () => {
      const result = await orchestrator.deployToTargets([]);

      expect(result.totalTargets).toBe(0);
      expect(result.successfulDeployments).toBe(0);
      expect(result.failedDeployments).toBe(0);
      expect(result.deployedHoneytokens).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle target with empty podIdentifiers", async () => {
      const targets: HighRiskService[] = [{
        serviceId: "svc-empty",
        serviceName: "empty-pods-service",
        namespace: "default",
        podIdentifiers: [],
        riskScore: 70,
      }];

      const result = await orchestrator.deployToTargets(targets);

      expect(result.totalTargets).toBe(1);
      expect(result.successfulDeployments).toBe(0);
      expect(result.failedDeployments).toBe(0);
      expect(deps.deployer.deploy).not.toHaveBeenCalled();
    });

    it("should not update registry on failed deployment", async () => {
      const failingDeployer = createMockDeployer({
        deploy: vi.fn().mockResolvedValue({
          success: false,
          deployedHoneytokens: [],
          errors: [{
            podId: "pod-0-a",
            failureReason: "Timeout",
            remediationActions: ["retry_deployment"],
          }],
        }),
      });

      deps = createTestDependencies({ deployer: failingDeployer });
      orchestrator = createDeploymentOrchestrator(deps);

      const targets = createTestTargets(1);
      await orchestrator.deployToTargets(targets);

      expect(deps.registry.addEntry).not.toHaveBeenCalled();
    });

    it("should not register paths with Tetragon on failed deployment", async () => {
      const failingDeployer = createMockDeployer({
        deploy: vi.fn().mockResolvedValue({
          success: false,
          deployedHoneytokens: [],
          errors: [{
            podId: "pod-0-a",
            failureReason: "Access denied",
            remediationActions: ["escalate_to_operator"],
          }],
        }),
      });

      deps = createTestDependencies({ deployer: failingDeployer });
      orchestrator = createDeploymentOrchestrator(deps);

      const targets = createTestTargets(1);
      await orchestrator.deployToTargets(targets);

      expect(deps.tetragonMonitor.registerHoneytokenPath).not.toHaveBeenCalled();
    });

    it("should log errors on deployment failure", async () => {
      const failingDeployer = createMockDeployer({
        deploy: vi.fn().mockResolvedValue({
          success: false,
          deployedHoneytokens: [],
          errors: [{
            podId: "pod-0-a",
            failureReason: "Connection refused",
            remediationActions: ["retry_deployment"],
          }],
        }),
      });

      deps = createTestDependencies({ deployer: failingDeployer });
      orchestrator = createDeploymentOrchestrator(deps);

      const targets = createTestTargets(1);
      await orchestrator.deployToTargets(targets);

      expect(deps.logger!.error).toHaveBeenCalledWith(
        expect.stringContaining("Deployment failed")
      );
    });

    it("should log success on successful deployment", async () => {
      const targets = createTestTargets(1);
      await orchestrator.deployToTargets(targets);

      expect(deps.logger!.info).toHaveBeenCalledWith(
        expect.stringContaining("Successfully deployed")
      );
    });

    it("should work without a logger", async () => {
      const depsNoLogger: DeploymentOrchestratorDependencies = {
        deployer: createMockDeployer(),
        registry: createMockRegistry(),
        tetragonMonitor: createMockTetragonMonitor(),
      };
      const orch = createDeploymentOrchestrator(depsNoLogger);

      const targets = createTestTargets(1);
      const result = await orch.deployToTargets(targets);

      expect(result.successfulDeployments).toBe(1);
    });

    it("should pass correct namespace from target to deployment request", async () => {
      const targets: HighRiskService[] = [{
        serviceId: "svc-prod",
        serviceName: "prod-service",
        namespace: "production",
        podIdentifiers: ["pod-prod-1"],
        riskScore: 95,
      }];

      await orchestrator.deployToTargets(targets);

      expect(deps.deployer.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          podId: "pod-prod-1",
          namespace: "production",
        })
      );
    });
  });
});
