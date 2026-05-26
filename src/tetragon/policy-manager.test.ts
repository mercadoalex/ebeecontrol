/**
 * Unit tests for the Tetragon Policy Manager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPolicyManager,
  PolicyManager,
  K8sPolicyClient,
  TracingPolicyPaths,
} from './policy-manager';
import { HoneytokenRegistryEntry } from '../types/index';

function makeEntry(overrides: Partial<HoneytokenRegistryEntry> = {}): HoneytokenRegistryEntry {
  return {
    honeytokenId: 'ht-001',
    podId: 'pod-abc',
    namespace: 'production',
    type: 'decoy_secret',
    filePath: '/var/run/secrets/kubernetes.io/serviceaccount/decoy-token-pod-abc',
    deploymentTimestamp: '2024-01-15T09:00:00.000Z',
    status: 'active',
    accessCount: 0,
    ...overrides,
  };
}

function createMockK8sClient(): K8sPolicyClient {
  let currentPolicy: TracingPolicyPaths | null = null;

  return {
    getTracingPolicy: vi.fn(async () => currentPolicy),
    applyTracingPolicy: vi.fn(async (policy: TracingPolicyPaths) => {
      currentPolicy = policy;
    }),
  };
}

describe('PolicyManager', () => {
  let k8sClient: K8sPolicyClient;
  let manager: PolicyManager;

  beforeEach(() => {
    k8sClient = createMockK8sClient();
    manager = createPolicyManager(k8sClient);
  });

  describe('addPaths', () => {
    it('should add honeytoken paths to the TracingPolicy', async () => {
      const entries = [
        makeEntry({ filePath: '/etc/secrets/decoy-key-1' }),
        makeEntry({ honeytokenId: 'ht-002', filePath: '/tmp/.config/creds.json' }),
      ];

      await manager.addPaths(entries);

      expect(k8sClient.applyTracingPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          paths: expect.arrayContaining([
            '/etc/secrets/decoy-key-1',
            '/tmp/.config/creds.json',
          ]),
        })
      );
    });

    it('should merge with existing paths', async () => {
      // First add
      await manager.addPaths([makeEntry({ filePath: '/path/a' })]);

      // Second add
      await manager.addPaths([makeEntry({ filePath: '/path/b' })]);

      const paths = await manager.getCurrentPaths();
      expect(paths).toContain('/path/a');
      expect(paths).toContain('/path/b');
    });

    it('should deduplicate paths', async () => {
      const entries = [
        makeEntry({ honeytokenId: 'ht-1', filePath: '/same/path' }),
        makeEntry({ honeytokenId: 'ht-2', filePath: '/same/path' }),
      ];

      await manager.addPaths(entries);

      const paths = await manager.getCurrentPaths();
      expect(paths.filter(p => p === '/same/path')).toHaveLength(1);
    });

    it('should skip decommissioned entries', async () => {
      const entries = [
        makeEntry({ filePath: '/active/path', status: 'active' }),
        makeEntry({ honeytokenId: 'ht-2', filePath: '/decom/path', status: 'decommissioned' }),
      ];

      await manager.addPaths(entries);

      const paths = await manager.getCurrentPaths();
      expect(paths).toContain('/active/path');
      expect(paths).not.toContain('/decom/path');
    });

    it('should do nothing for empty entries', async () => {
      await manager.addPaths([]);
      expect(k8sClient.applyTracingPolicy).not.toHaveBeenCalled();
    });
  });

  describe('removePaths', () => {
    it('should remove specified paths from the TracingPolicy', async () => {
      // Add paths first
      await manager.addPaths([
        makeEntry({ filePath: '/path/a' }),
        makeEntry({ honeytokenId: 'ht-2', filePath: '/path/b' }),
        makeEntry({ honeytokenId: 'ht-3', filePath: '/path/c' }),
      ]);

      // Remove one
      await manager.removePaths([makeEntry({ filePath: '/path/b' })]);

      const paths = await manager.getCurrentPaths();
      expect(paths).toContain('/path/a');
      expect(paths).not.toContain('/path/b');
      expect(paths).toContain('/path/c');
    });
  });

  describe('syncWithRegistry', () => {
    it('should replace all paths with the current registry state', async () => {
      // Add some paths
      await manager.addPaths([
        makeEntry({ filePath: '/old/path-1' }),
        makeEntry({ honeytokenId: 'ht-2', filePath: '/old/path-2' }),
      ]);

      // Sync with new registry state
      await manager.syncWithRegistry([
        makeEntry({ filePath: '/new/path-a' }),
        makeEntry({ honeytokenId: 'ht-2', filePath: '/new/path-b' }),
      ]);

      const paths = await manager.getCurrentPaths();
      expect(paths).toContain('/new/path-a');
      expect(paths).toContain('/new/path-b');
      expect(paths).not.toContain('/old/path-1');
      expect(paths).not.toContain('/old/path-2');
    });

    it('should only include active and triggered entries', async () => {
      await manager.syncWithRegistry([
        makeEntry({ filePath: '/active', status: 'active' }),
        makeEntry({ honeytokenId: 'ht-2', filePath: '/triggered', status: 'triggered' }),
        makeEntry({ honeytokenId: 'ht-3', filePath: '/decom', status: 'decommissioned' }),
      ]);

      const paths = await manager.getCurrentPaths();
      expect(paths).toContain('/active');
      expect(paths).toContain('/triggered');
      expect(paths).not.toContain('/decom');
    });
  });

  describe('getCurrentPaths', () => {
    it('should return empty array when no policy exists', async () => {
      const paths = await manager.getCurrentPaths();
      expect(paths).toEqual([]);
    });

    it('should return current monitored paths', async () => {
      await manager.addPaths([
        makeEntry({ filePath: '/path/x' }),
        makeEntry({ honeytokenId: 'ht-2', filePath: '/path/y' }),
      ]);

      const paths = await manager.getCurrentPaths();
      expect(paths).toHaveLength(2);
      expect(paths).toContain('/path/x');
      expect(paths).toContain('/path/y');
    });

    it('should not include the placeholder path', async () => {
      // Sync with empty registry (will set placeholder)
      await manager.syncWithRegistry([]);

      const paths = await manager.getCurrentPaths();
      expect(paths).not.toContain('/ebeecontrol/placeholder');
    });
  });
});
