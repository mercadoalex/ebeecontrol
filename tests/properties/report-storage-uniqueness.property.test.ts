import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createReportGenerator,
  GeminiGenerateFn,
  IncidentData,
} from '../../src/agent/report-generator';
import { AccessEvent, ThreatAssessment, ResponseAction } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 13: Report Storage Uniqueness
 *
 * For any set of stored ForensicReports, all report IDs SHALL be unique,
 * each report SHALL have a non-null generation timestamp and a non-null
 * association to a triggering access event ID.
 *
 * Validates: Requirements 6.3
 */
describe('Feature: ebeecontrol, Property 13: Report Storage Uniqueness', () => {
  const mockGemini: GeminiGenerateFn = async () => 'Generated forensic report content';

  const accessTypeArb = fc.constantFrom('open' as const, 'read' as const, 'write' as const, 'stat' as const);
  const classificationArb = fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const);
  const namespaceClassArb = fc.constantFrom('production' as const, 'non-production' as const);
  const resultArb = fc.constantFrom('success' as const, 'failure' as const);
  const actionTypeArb = fc.constantFrom(
    'pod_isolation' as const,
    'ip_block' as const,
    'additional_honeytokens' as const,
    'alert' as const
  );

  const accessEventArb: fc.Arbitrary<AccessEvent> = fc.record({
    eventId: fc.uuid(),
    processId: fc.integer({ min: 1, max: 65535 }),
    processBinaryPath: fc.stringMatching(/^\/[a-z][a-z0-9/]{1,30}$/),
    userId: fc.integer({ min: 0, max: 65535 }),
    podId: fc.stringMatching(/^pod-[a-z0-9]{3,10}$/),
    namespace: fc.stringMatching(/^[a-z][a-z0-9-]{2,15}$/),
    honeytokenPath: fc.stringMatching(/^\/[a-z][a-z0-9/.]{2,30}$/),
    accessType: accessTypeArb,
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
  });

  const threatAssessmentArb: fc.Arbitrary<ThreatAssessment> = fc.record({
    assessmentId: fc.uuid(),
    accessEventId: fc.uuid(),
    classification: classificationArb,
    inputs: fc.record({
      namespaceClassification: namespaceClassArb,
      serviceCriticality: fc.integer({ min: 1, max: 5 }),
      davisAnomalyScore: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    assessmentTimestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
    assessmentLatencyMs: fc.integer({ min: 1, max: 5000 }),
  });

  const responseActionArb: fc.Arbitrary<ResponseAction> = fc.record({
    actionId: fc.uuid(),
    actionType: actionTypeArb,
    target: fc.stringMatching(/^[a-z][a-z0-9-]{2,15}$/),
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
    threatClassification: classificationArb,
    result: resultArb,
    retryCount: fc.integer({ min: 0, max: 5 }),
  });

  const incidentDataArb: fc.Arbitrary<IncidentData> = fc.record({
    accessEvent: accessEventArb,
    threatAssessment: threatAssessmentArb,
    responseActions: fc.array(responseActionArb, { minLength: 1, maxLength: 5 }),
  });

  it('all stored report IDs are unique, with non-null timestamps and triggering event IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(incidentDataArb, { minLength: 2, maxLength: 5 }),
        async (incidents) => {
          const generator = createReportGenerator(mockGemini);

          // Generate multiple reports
          for (const incident of incidents) {
            await generator.generate(incident);
          }

          const storedReports = generator.getStoredReports();

          // All report IDs are unique
          const reportIds = storedReports.map(r => r.reportId);
          const uniqueIds = new Set(reportIds);
          expect(uniqueIds.size).toBe(reportIds.length);

          // Each report has non-null generation timestamp and triggering event ID
          for (const report of storedReports) {
            expect(report.reportId).toBeTruthy();
            expect(report.reportId.trim().length).toBeGreaterThan(0);

            expect(report.generationTimestamp).toBeTruthy();
            expect(report.generationTimestamp).not.toBeNull();
            expect(new Date(report.generationTimestamp).getTime()).not.toBeNaN();

            expect(report.triggeringAccessEventId).toBeTruthy();
            expect(report.triggeringAccessEventId).not.toBeNull();
            expect(report.triggeringAccessEventId.trim().length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
