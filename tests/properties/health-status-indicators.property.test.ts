import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  toHealthStatusViewModel,
} from '../../src/dynatrace-ingestion/view-models';
import { ComponentHealthMetricPayload } from '../../src/types/dynatrace-ingestion';

/**
 * Feature: ebeecontrol, Property 22: Health Status Distinct Indicators
 *
 * For any component health status value (healthy, unhealthy, or degraded),
 * the dashboard view model SHALL produce a statusIcon and statusLabel pair
 * that is distinct from the pairs produced for the other two status values.
 *
 * Validates: Requirements 9.8
 */
describe('Feature: ebeecontrol, Property 22: Health Status Distinct Indicators', () => {
  const statusArb = fc.constantFrom(
    'healthy' as const,
    'unhealthy' as const,
    'degraded' as const
  );

  const componentNameArb = fc.constantFrom(
    'Tetragon_Monitor' as const,
    'Koney_Deployer' as const,
    'Dynatrace_MCP_Server' as const,
    'Vertex_AI_Trainer' as const
  );

  const timestampArb = fc
    .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString());

  it('each status value produces a unique (icon, label) pair distinct from the other two', () => {
    fc.assert(
      fc.property(componentNameArb, timestampArb, (componentName, timestamp) => {
        const statuses: ComponentHealthMetricPayload['status'][] = [
          'healthy',
          'unhealthy',
          'degraded',
        ];

        const pairs = statuses.map((status) => {
          const vm = toHealthStatusViewModel({
            componentName,
            status,
            lastSuccessfulCheckTimestamp: timestamp,
          });
          return `${vm.statusIcon}|${vm.statusLabel}`;
        });

        // All 3 pairs must be distinct
        const uniquePairs = new Set(pairs);
        expect(uniquePairs.size).toBe(3);
      }),
      { numRuns: 100 }
    );
  });

  it('statusIcon is non-empty for any status value', () => {
    fc.assert(
      fc.property(statusArb, componentNameArb, timestampArb, (status, componentName, timestamp) => {
        const vm = toHealthStatusViewModel({
          componentName,
          status,
          lastSuccessfulCheckTimestamp: timestamp,
        });

        expect(vm.statusIcon).toBeTruthy();
        expect(vm.statusIcon.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('statusLabel is non-empty for any status value', () => {
    fc.assert(
      fc.property(statusArb, componentNameArb, timestampArb, (status, componentName, timestamp) => {
        const vm = toHealthStatusViewModel({
          componentName,
          status,
          lastSuccessfulCheckTimestamp: timestamp,
        });

        expect(vm.statusLabel).toBeTruthy();
        expect(vm.statusLabel.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
