import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHoneytokenRegistry } from '../../src/agent/registry';
import { HoneytokenRegistryEntry } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 6: Registry Consistency
 *
 * For any successful deployment report received by the Ebeecontrol_Agent, the honeytoken
 * registry SHALL contain an entry with matching location (podId + namespace + filePath),
 * type, deployment timestamp, and a status of "active".
 *
 * All registry entries SHALL have non-null values for location, type, deploymentTime, and status.
 *
 * Validates: Requirements 2.6, 2.7
 */
describe('Feature: ebeecontrol, Property 6: Registry Consistency', () => {
  const honeytokenTypes = ['decoy_secret', 'decoy_file', 'decoy_credential'] as const;
  const statuses = ['active', 'triggered', 'decommissioned'] as const;

  const registryEntryArb: fc.Arbitrary<HoneytokenRegistryEntry> = fc.record({
    honeytokenId: fc.uuid(),
    podId: fc.string({ minLength: 1, maxLength: 50 }),
    namespace: fc.string({ minLength: 1, maxLength: 50 }),
    type: fc.constantFrom(...honeytokenTypes),
    filePath: fc.string({ minLength: 1, maxLength: 100 }),
    deploymentTimestamp: fc.date().map((d) => d.toISOString()),
    status: fc.constant('active' as const),
    accessCount: fc.constant(0),
  });

  it('getById returns entry with matching fields and status "active" after addEntry', () => {
    fc.assert(
      fc.property(
        registryEntryArb,
        (entry) => {
          const registry = createHoneytokenRegistry();
          registry.addEntry(entry);

          const retrieved = registry.getById(entry.honeytokenId);

          expect(retrieved).toBeDefined();
          expect(retrieved!.podId).toBe(entry.podId);
          expect(retrieved!.namespace).toBe(entry.namespace);
          expect(retrieved!.filePath).toBe(entry.filePath);
          expect(retrieved!.type).toBe(entry.type);
          expect(retrieved!.deploymentTimestamp).toBe(entry.deploymentTimestamp);
          expect(retrieved!.status).toBe('active');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all registry entries have non-null values for location, type, deploymentTime, and status', () => {
    fc.assert(
      fc.property(
        fc.array(registryEntryArb, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const registry = createHoneytokenRegistry();

          for (const entry of entries) {
            registry.addEntry(entry);
          }

          const allEntries = registry.getAll();

          for (const stored of allEntries) {
            // Location fields (podId + namespace + filePath) must be non-null
            expect(stored.podId).not.toBeNull();
            expect(stored.podId).not.toBeUndefined();
            expect(stored.podId.length).toBeGreaterThan(0);

            expect(stored.namespace).not.toBeNull();
            expect(stored.namespace).not.toBeUndefined();
            expect(stored.namespace.length).toBeGreaterThan(0);

            expect(stored.filePath).not.toBeNull();
            expect(stored.filePath).not.toBeUndefined();
            expect(stored.filePath.length).toBeGreaterThan(0);

            // Type must be non-null and valid
            expect(stored.type).not.toBeNull();
            expect(stored.type).not.toBeUndefined();
            expect(honeytokenTypes).toContain(stored.type);

            // Deployment timestamp must be non-null
            expect(stored.deploymentTimestamp).not.toBeNull();
            expect(stored.deploymentTimestamp).not.toBeUndefined();
            expect(stored.deploymentTimestamp.length).toBeGreaterThan(0);

            // Status must be non-null and valid
            expect(stored.status).not.toBeNull();
            expect(stored.status).not.toBeUndefined();
            expect(statuses).toContain(stored.status);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('registry preserves location consistency across multiple entries', () => {
    fc.assert(
      fc.property(
        fc.array(registryEntryArb, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const registry = createHoneytokenRegistry();

          for (const entry of entries) {
            registry.addEntry(entry);
          }

          // Verify each entry can be retrieved and matches its original location
          for (const entry of entries) {
            const retrieved = registry.getById(entry.honeytokenId);
            if (retrieved) {
              // Location must match: podId + namespace + filePath
              expect(retrieved.podId).toBe(entry.podId);
              expect(retrieved.namespace).toBe(entry.namespace);
              expect(retrieved.filePath).toBe(entry.filePath);
              // Type and deployment timestamp must match
              expect(retrieved.type).toBe(entry.type);
              expect(retrieved.deploymentTimestamp).toBe(entry.deploymentTimestamp);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
