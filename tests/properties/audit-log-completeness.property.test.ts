import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createAuditLog } from '../../src/agent/audit-log';

/**
 * Feature: ebeecontrol, Property 18: Audit Log Entry Completeness
 *
 * For any autonomous decision made by the Ebeecontrol_Agent, the audit log entry SHALL contain:
 * a valid ISO 8601 timestamp, a decision type from the defined set, a non-empty decision rationale,
 * a non-empty input data summary, and a non-empty outcome description.
 *
 * Validates: Requirements 5.4, 7.5, 8.6
 */
describe('Feature: ebeecontrol, Property 18: Audit Log Entry Completeness', () => {
  const decisionTypes = [
    'discovery',
    'deployment',
    'assessment',
    'response',
    'learning',
    'model_update',
  ] as const;

  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

  it('every audit log entry contains all required fields with valid values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...decisionTypes),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (decisionType, rationale, inputDataSummary, outcome) => {
          const auditLog = createAuditLog();

          const entry = auditLog.log({
            decisionType,
            decisionRationale: rationale,
            inputDataSummary,
            outcome,
          });

          // Timestamp must be a valid ISO 8601 string
          expect(entry.timestamp).toBeDefined();
          expect(typeof entry.timestamp).toBe('string');
          expect(entry.timestamp.length).toBeGreaterThan(0);
          expect(iso8601Regex.test(entry.timestamp)).toBe(true);
          // Verify it parses to a valid date
          const parsedDate = new Date(entry.timestamp);
          expect(parsedDate.getTime()).not.toBeNaN();

          // Decision type must be from the defined set
          expect(entry.decisionType).toBeDefined();
          expect(decisionTypes).toContain(entry.decisionType);
          expect(entry.decisionType).toBe(decisionType);

          // Decision rationale must be non-empty
          expect(entry.decisionRationale).toBeDefined();
          expect(typeof entry.decisionRationale).toBe('string');
          expect(entry.decisionRationale.length).toBeGreaterThan(0);

          // Input data summary must be non-empty
          expect(entry.inputDataSummary).toBeDefined();
          expect(typeof entry.inputDataSummary).toBe('string');
          expect(entry.inputDataSummary.length).toBeGreaterThan(0);

          // Outcome must be non-empty
          expect(entry.outcome).toBeDefined();
          expect(typeof entry.outcome).toBe('string');
          expect(entry.outcome.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
