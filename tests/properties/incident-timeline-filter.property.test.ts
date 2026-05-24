import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { queryIncidentTimeline, IncidentTimelineFilter } from '../../src/dynatrace-ingestion/query-support';
import { IncidentTimelineLogPayload } from '../../src/types/dynatrace-ingestion';

/**
 * Feature: ebeecontrol, Property 21: Incident Timeline Filter and Pagination
 *
 * For any set of incident timeline entries and any valid filter combination, the filtered
 * result set SHALL contain only entries matching ALL specified filter criteria, each page
 * SHALL contain at most 500 entries, and the union of all pages SHALL equal the complete
 * set of matching entries.
 *
 * Validates: Requirements 9.14
 */
describe('Feature: ebeecontrol, Property 21: Incident Timeline Filter and Pagination', () => {
  const classifications = ['low', 'medium', 'high', 'critical'] as const;
  const outcomes = ['contained', 'escalated', 'false_positive'] as const;
  const actionOutcomes = ['success', 'failure'] as const;

  const incidentArb: fc.Arbitrary<IncidentTimelineLogPayload> = fc.record({
    incidentId: fc.uuid(),
    timestamp: fc.date({ min: new Date('2023-01-01'), max: new Date('2024-12-31') }).map(d => d.toISOString()),
    threatClassification: fc.constantFrom(...classifications),
    affectedPodId: fc.stringMatching(/^pod-[a-z0-9]{3,8}$/),
    namespace: fc.constantFrom('production', 'staging', 'development', 'monitoring'),
    responseActions: fc.array(
      fc.record({
        actionType: fc.constantFrom('pod_isolation', 'ip_block', 'additional_honeytokens'),
        outcome: fc.constantFrom(...actionOutcomes),
      }),
      { minLength: 1, maxLength: 3 }
    ),
    finalOutcome: fc.constantFrom(...outcomes),
  });

  const filterArb: fc.Arbitrary<IncidentTimelineFilter> = fc.record({
    dateRangeStart: fc.option(
      fc.date({ min: new Date('2023-01-01'), max: new Date('2024-06-30') }).map(d => d.toISOString()),
      { nil: undefined }
    ),
    dateRangeEnd: fc.option(
      fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') }).map(d => d.toISOString()),
      { nil: undefined }
    ),
    threatClassification: fc.option(
      fc.subarray([...classifications], { minLength: 1 }),
      { nil: undefined }
    ),
    namespace: fc.option(
      fc.constantFrom('production', 'staging', 'development', 'monitoring'),
      { nil: undefined }
    ),
    responseOutcome: fc.option(
      fc.subarray([...outcomes], { minLength: 1 }),
      { nil: undefined }
    ),
    page: fc.integer({ min: 1, max: 5 }),
    pageSize: fc.option(fc.integer({ min: 10, max: 500 }), { nil: undefined }),
  });

  /**
   * Helper: manually check if an incident matches all filter criteria.
   */
  function matchesFilter(incident: IncidentTimelineLogPayload, filter: IncidentTimelineFilter): boolean {
    if (filter.dateRangeStart) {
      if (new Date(incident.timestamp).getTime() < new Date(filter.dateRangeStart).getTime()) {
        return false;
      }
    }
    if (filter.dateRangeEnd) {
      if (new Date(incident.timestamp).getTime() > new Date(filter.dateRangeEnd).getTime()) {
        return false;
      }
    }
    if (filter.threatClassification && filter.threatClassification.length > 0) {
      if (!filter.threatClassification.includes(incident.threatClassification)) {
        return false;
      }
    }
    if (filter.namespace) {
      if (incident.namespace !== filter.namespace) {
        return false;
      }
    }
    if (filter.responseOutcome && filter.responseOutcome.length > 0) {
      if (!filter.responseOutcome.includes(incident.finalOutcome)) {
        return false;
      }
    }
    return true;
  }

  it('all results match ALL specified filter criteria', () => {
    fc.assert(
      fc.property(
        fc.array(incidentArb, { minLength: 0, maxLength: 30 }),
        filterArb,
        (incidents, filter) => {
          const result = queryIncidentTimeline(incidents, filter);

          for (const item of result.items) {
            expect(matchesFilter(item, filter)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('each page contains at most 500 entries', () => {
    fc.assert(
      fc.property(
        fc.array(incidentArb, { minLength: 0, maxLength: 30 }),
        filterArb,
        (incidents, filter) => {
          const result = queryIncidentTimeline(incidents, filter);

          expect(result.items.length).toBeLessThanOrEqual(500);
          expect(result.pageSize).toBeLessThanOrEqual(500);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('union of all pages equals the complete set of matching entries (no duplicates, no missing)', () => {
    fc.assert(
      fc.property(
        fc.array(incidentArb, { minLength: 0, maxLength: 30 }),
        filterArb.map(f => ({ ...f, page: 1 })), // start from page 1
        (incidents, baseFilter) => {
          // Collect all items across all pages
          const allItems: IncidentTimelineLogPayload[] = [];
          let page = 1;
          let totalPages = 1;

          do {
            const filter = { ...baseFilter, page };
            const result = queryIncidentTimeline(incidents, filter);
            totalPages = result.totalPages;
            allItems.push(...result.items);
            page++;
          } while (page <= totalPages);

          // Manually compute expected matches
          const expectedMatches = incidents.filter(i => matchesFilter(i, baseFilter));

          // Total items across all pages should equal total matching entries
          expect(allItems.length).toBe(expectedMatches.length);

          // No duplicates
          const ids = allItems.map(i => i.incidentId);
          const uniqueIds = new Set(ids);
          expect(uniqueIds.size).toBe(ids.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
