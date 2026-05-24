import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { searchForensicReports } from '../../src/dynatrace-ingestion/query-support';
import { ForensicReport } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 20: Forensic Report Search Correctness
 *
 * For any set of stored ForensicReports and any non-empty search text, the filtered
 * results SHALL contain only reports where the search text appears as a substring
 * (case-insensitive) in at least one of: reportId, podId, or namespace.
 *
 * Validates: Requirements 9.9
 */
describe('Feature: ebeecontrol, Property 20: Forensic Report Search Correctness', () => {
  const classifications = ['low', 'medium', 'high', 'critical'] as const;
  const accessTypes = ['open', 'read', 'write', 'stat'] as const;

  const forensicReportArb: fc.Arbitrary<ForensicReport> = fc.record({
    reportId: fc.uuid(),
    generationTimestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
    triggeringAccessEventId: fc.uuid(),
    retentionDays: fc.integer({ min: 1, max: 365 }),
    accessEventDetails: fc.record({
      processId: fc.integer({ min: 1, max: 65535 }),
      userId: fc.integer({ min: 0, max: 65535 }),
      podId: fc.stringMatching(/^pod-[a-z0-9]{3,10}$/),
      namespace: fc.stringMatching(/^ns-[a-z0-9]{3,10}$/),
      honeytokenPath: fc.stringMatching(/^\/[a-z][a-z0-9/]{2,20}$/),
      accessType: fc.constantFrom(...accessTypes),
      timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
    }),
    contextualAssessment: fc.record({
      threatClassification: fc.constantFrom(...classifications),
      podCriticality: fc.integer({ min: 1, max: 5 }),
      anomalyScore: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    responseActions: fc.array(
      fc.record({
        actionType: fc.constantFrom('pod_isolation', 'ip_block', 'additional_honeytokens'),
        target: fc.stringMatching(/^[a-z][a-z0-9-]{2,10}$/),
        timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
        result: fc.constantFrom('success' as const, 'failure' as const),
      }),
      { minLength: 1, maxLength: 3 }
    ),
    timeline: fc.array(
      fc.record({
        eventDescription: fc.stringMatching(/^[A-Za-z ]{5,30}$/),
        timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
      }),
      { minLength: 2, maxLength: 5 }
    ),
    recommendedFollowUpActions: fc.array(
      fc.stringMatching(/^[A-Za-z ]{5,30}$/),
      { minLength: 1, maxLength: 3 }
    ),
  });

  const searchTextArb = fc.stringMatching(/^[a-z0-9-]{1,8}$/);

  it('all search results contain the search text in reportId, podId, or namespace (case-insensitive)', () => {
    fc.assert(
      fc.property(
        fc.array(forensicReportArb, { minLength: 1, maxLength: 20 }),
        searchTextArb,
        (reports, searchText) => {
          const result = searchForensicReports(reports, { searchText, page: 1, pageSize: 1000 });

          const searchLower = searchText.toLowerCase();

          // Every returned result must match the search criteria
          for (const item of result.items) {
            const matchesReportId = item.reportId.toLowerCase().includes(searchLower);
            const matchesPodId = item.affectedPodId.toLowerCase().includes(searchLower);
            const matchesNamespace = item.namespace.toLowerCase().includes(searchLower);

            expect(matchesReportId || matchesPodId || matchesNamespace).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('search results are a subset of all reports (no false positives)', () => {
    fc.assert(
      fc.property(
        fc.array(forensicReportArb, { minLength: 1, maxLength: 20 }),
        searchTextArb,
        (reports, searchText) => {
          const result = searchForensicReports(reports, { searchText, page: 1, pageSize: 1000 });

          // Total count should not exceed the number of input reports
          expect(result.totalCount).toBeLessThanOrEqual(reports.length);

          // All returned report IDs should exist in the original set
          const originalIds = new Set(reports.map(r => r.reportId));
          for (const item of result.items) {
            expect(originalIds.has(item.reportId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('search finds all matching reports (no false negatives)', () => {
    fc.assert(
      fc.property(
        fc.array(forensicReportArb, { minLength: 1, maxLength: 20 }),
        searchTextArb,
        (reports, searchText) => {
          const result = searchForensicReports(reports, { searchText, page: 1, pageSize: 1000 });
          const searchLower = searchText.toLowerCase();

          // Manually compute expected matches
          const expectedMatches = reports.filter(report =>
            report.reportId.toLowerCase().includes(searchLower) ||
            report.accessEventDetails.podId.toLowerCase().includes(searchLower) ||
            report.accessEventDetails.namespace.toLowerCase().includes(searchLower)
          );

          expect(result.totalCount).toBe(expectedMatches.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
