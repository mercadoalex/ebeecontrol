/**
 * Tetragon Policy Manager — Dynamically updates TracingPolicy resources
 * when new honeytokens are deployed or decommissioned.
 *
 * When the agent deploys honeytokens to a pod, this manager:
 * 1. Reads the current dynamic TracingPolicy from the cluster
 * 2. Adds the new honeytoken file paths to the selector values
 * 3. Applies the updated policy via kubectl/K8s API
 *
 * This ensures Tetragon's eBPF probes always monitor the latest set of
 * honeytoken paths without requiring a full policy redeploy.
 *
 * Validates: Requirements 3.4 (detect newly registered honeytokens within 30s)
 */

import { HoneytokenRegistryEntry } from '../types/index.js';

/**
 * The structure of a Tetragon TracingPolicy's kprobe selector values.
 */
export interface TracingPolicyPaths {
  policyName: string;
  namespace: string;
  paths: string[];
  lastUpdated: string;
}

/**
 * Interface for Kubernetes API operations on TracingPolicy resources.
 * Injected for testability.
 */
export interface K8sPolicyClient {
  getTracingPolicy(name: string, namespace: string): Promise<TracingPolicyPaths | null>;
  applyTracingPolicy(policy: TracingPolicyPaths): Promise<void>;
}

/**
 * Configuration for the policy manager.
 */
export interface PolicyManagerConfig {
  /** Name of the dynamic TracingPolicy resource */
  policyName: string;
  /** Namespace where the policy lives */
  namespace: string;
  /** Debounce interval in ms to batch multiple path additions (default: 5000) */
  debounceMs: number;
}

const DEFAULT_CONFIG: PolicyManagerConfig = {
  policyName: 'ebeecontrol-dynamic-honeytokens',
  namespace: 'ebeecontrol',
  debounceMs: 5000,
};

/**
 * Interface for the Tetragon Policy Manager.
 */
export interface PolicyManager {
  /** Add honeytoken paths to the TracingPolicy */
  addPaths(entries: HoneytokenRegistryEntry[]): Promise<void>;
  /** Remove honeytoken paths from the TracingPolicy */
  removePaths(entries: HoneytokenRegistryEntry[]): Promise<void>;
  /** Sync the TracingPolicy with the full registry state */
  syncWithRegistry(entries: HoneytokenRegistryEntry[]): Promise<void>;
  /** Get the current monitored paths */
  getCurrentPaths(): Promise<string[]>;
}

/**
 * Extracts unique file paths from honeytoken registry entries.
 */
function extractPaths(entries: HoneytokenRegistryEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.status === 'active' || entry.status === 'triggered') {
      paths.add(entry.filePath);
    }
  }
  return Array.from(paths).sort();
}

/**
 * Creates a PolicyManager that dynamically updates Tetragon TracingPolicy
 * resources when honeytokens are deployed or decommissioned.
 */
export function createPolicyManager(
  k8sClient: K8sPolicyClient,
  config: Partial<PolicyManagerConfig> = {}
): PolicyManager {
  const resolvedConfig: PolicyManagerConfig = { ...DEFAULT_CONFIG, ...config };
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPaths: string[] = [];

  async function applyPaths(paths: string[]): Promise<void> {
    const policy: TracingPolicyPaths = {
      policyName: resolvedConfig.policyName,
      namespace: resolvedConfig.namespace,
      paths: paths.length > 0 ? paths : ['/ebeecontrol/placeholder'],
      lastUpdated: new Date().toISOString(),
    };

    await k8sClient.applyTracingPolicy(policy);
  }

  async function addPaths(entries: HoneytokenRegistryEntry[]): Promise<void> {
    const newPaths = extractPaths(entries);
    if (newPaths.length === 0) return;

    // Get current paths
    const current = await k8sClient.getTracingPolicy(
      resolvedConfig.policyName,
      resolvedConfig.namespace
    );

    const existingPaths = current?.paths.filter(p => p !== '/ebeecontrol/placeholder') ?? [];
    const allPaths = Array.from(new Set([...existingPaths, ...newPaths])).sort();

    await applyPaths(allPaths);
  }

  async function removePaths(entries: HoneytokenRegistryEntry[]): Promise<void> {
    const pathsToRemove = new Set(entries.map(e => e.filePath));

    const current = await k8sClient.getTracingPolicy(
      resolvedConfig.policyName,
      resolvedConfig.namespace
    );

    if (!current) return;

    const remainingPaths = current.paths.filter(p => !pathsToRemove.has(p));
    await applyPaths(remainingPaths);
  }

  async function syncWithRegistry(entries: HoneytokenRegistryEntry[]): Promise<void> {
    const activePaths = extractPaths(entries);
    await applyPaths(activePaths);
  }

  async function getCurrentPaths(): Promise<string[]> {
    const current = await k8sClient.getTracingPolicy(
      resolvedConfig.policyName,
      resolvedConfig.namespace
    );
    return current?.paths.filter(p => p !== '/ebeecontrol/placeholder') ?? [];
  }

  return {
    addPaths,
    removePaths,
    syncWithRegistry,
    getCurrentPaths,
  };
}
