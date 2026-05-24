import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  getEmptyStateMessage,
  DashboardSection,
} from '../../src/dynatrace-ingestion/view-models';

/**
 * Feature: ebeecontrol, Property 23: Dashboard Empty State Messages
 *
 * For any dashboard section type with an empty data set, the dashboard SHALL
 * produce a non-empty, non-null empty state message string specific to that section.
 *
 * Validates: Requirements 9.17
 */
describe('Feature: ebeecontrol, Property 23: Dashboard Empty State Messages', () => {
  const sectionArb = fc.constantFrom(
    'honeytoken_registry' as const,
    'access_event_feed' as const,
    'response_actions' as const,
    'forensic_reports' as const,
    'incident_timeline' as const
  );

  it('every section type produces a non-empty, non-null message', () => {
    fc.assert(
      fc.property(sectionArb, (section: DashboardSection) => {
        const message = getEmptyStateMessage(section);

        // Must not be null or undefined
        expect(message).not.toBeNull();
        expect(message).not.toBeUndefined();

        // Must be a non-empty string
        expect(typeof message).toBe('string');
        expect(message.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('each section type produces a distinct message from all other sections', () => {
    fc.assert(
      fc.property(sectionArb, (section: DashboardSection) => {
        const allSections: DashboardSection[] = [
          'honeytoken_registry',
          'access_event_feed',
          'response_actions',
          'forensic_reports',
          'incident_timeline',
        ];

        const currentMessage = getEmptyStateMessage(section);
        const otherSections = allSections.filter((s) => s !== section);

        for (const otherSection of otherSections) {
          const otherMessage = getEmptyStateMessage(otherSection);
          expect(currentMessage).not.toBe(otherMessage);
        }
      }),
      { numRuns: 100 }
    );
  });
});
