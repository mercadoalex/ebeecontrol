import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createReportGenerator,
  GeminiGenerateFn,
  IncidentData,
} from '../../src/agent/report-generator';
import { AccessEvent, ThreatAssessment, ResponseAction } from '../../src/types/index';

/**
 * Feature: ebeecontrol, Property 12: Forensic Report Content Completeness
 *
 * For any generated ForensicReport, the report SHALL contain: access event details
 * (processId, userId, podId, namespace, honeytokenPath, accessType, timestamp),
 * contextual assessment (threatClassification, podCriticality, anomalyScore),
 * at least one response action with timestamp, a chronological timeline with at
 * least 2 entries, and at least one recommended follow-up action.
 *
 * Validates: Requirements 6.2
 */
describe('Feature: ebeecontrol, Property 12: Forensic Report Content Completeness', () => {
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

  it('generated report contains all required sections with non-empty content', async () => {
    await fc.assert(
      fc.asyncProperty(incidentDataArb, async (incident) => {
        const generator = createReportGenerator(mockGemini);
        const report = await generator.generate(incident);

        // Access event details
        expect(typeof report.accessEventDetails.processId).toBe('number');
        expect(report.accessEventDetails.processId).toBeGreaterThan(0);
        expect(typeof report.accessEventDetails.userId).toBe('number');
        expect(report.accessEventDetails.userId).toBeGreaterThanOrEqual(0);
        expect(report.accessEventDetails.podId).toBeTruthy();
        expect(report.accessEventDetails.podId.trim().length).toBeGreaterThan(0);
        expect(report.accessEventDetails.namespace).toBeTruthy();
        expect(report.accessEventDetails.namespace.trim().length).toBeGreaterThan(0);
        expect(report.accessEventDetails.honeytokenPath).toBeTruthy();
        expect(report.accessEventDetails.honeytokenPath.trim().length).toBeGreaterThan(0);
        expect(['open', 'read', 'write', 'stat']).toContain(report.accessEventDetails.accessType);
        expect(report.accessEventDetails.timestamp).toBeTruthy();
        expect(new Date(report.accessEventDetails.timestamp).getTime()).not.toBeNaN();

        // Contextual assessment
        expect(['low', 'medium', 'high', 'critical']).toContain(report.contextualAssessment.threatClassification);
        expect(typeof report.contextualAssessment.podCriticality).toBe('number');
        expect(typeof report.contextualAssessment.anomalyScore).toBe('number');

        // At least one response action with timestamp
        expect(report.responseActions.length).toBeGreaterThanOrEqual(1);
        for (const action of report.responseActions) {
          expect(action.timestamp).toBeTruthy();
          expect(new Date(action.timestamp).getTime()).not.toBeNaN();
          expect(action.actionType).toBeTruthy();
          expect(action.target).toBeTruthy();
          expect(['success', 'failure']).toContain(action.result);
        }

        // Chronological timeline with at least 2 entries
        expect(report.timeline.length).toBeGreaterThanOrEqual(2);
        for (const entry of report.timeline) {
          expect(entry.eventDescription).toBeTruthy();
          expect(entry.eventDescription.trim().length).toBeGreaterThan(0);
          expect(entry.timestamp).toBeTruthy();
          expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
        }

        // At least one recommended follow-up action
        expect(report.recommendedFollowUpActions.length).toBeGreaterThanOrEqual(1);
        for (const action of report.recommendedFollowUpActions) {
          expect(action.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});
