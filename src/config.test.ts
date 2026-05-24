import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  loadConfig,
  validateConfig,
  ConfigValidationError,
  EbeecontrolConfig,
} from './config.js';

describe('EbeecontrolConfig', () => {
  describe('DEFAULT_CONFIG', () => {
    it('has correct discovery defaults', () => {
      expect(DEFAULT_CONFIG.discovery.intervalMinutes).toBe(60);
    });

    it('has correct healthCheck defaults', () => {
      expect(DEFAULT_CONFIG.healthCheck.intervalSeconds).toBe(30);
      expect(DEFAULT_CONFIG.healthCheck.responseTimeoutSeconds).toBe(5);
      expect(DEFAULT_CONFIG.healthCheck.componentTimeoutSeconds).toBe(10);
    });

    it('has correct deployment defaults', () => {
      expect(DEFAULT_CONFIG.deployment.maxHoneytokensPerPod).toBe(5);
      expect(DEFAULT_CONFIG.deployment.deploymentTimeoutSeconds).toBe(30);
    });

    it('has correct response defaults', () => {
      expect(DEFAULT_CONFIG.response.isolationTimeoutSeconds).toBe(10);
      expect(DEFAULT_CONFIG.response.isolationMaxRetries).toBe(3);
      expect(DEFAULT_CONFIG.response.isolationRetryIntervalSeconds).toBe(5);
      expect(DEFAULT_CONFIG.response.ipBlockMaxRetries).toBe(3);
      expect(DEFAULT_CONFIG.response.ipBlockRetryIntervalSeconds).toBe(5);
    });

    it('has correct reporting defaults', () => {
      expect(DEFAULT_CONFIG.reporting.reportRetentionDays).toBe(90);
      expect(DEFAULT_CONFIG.reporting.reportGenerationTimeoutSeconds).toBe(60);
      expect(DEFAULT_CONFIG.reporting.reportGenerationMaxRetries).toBe(3);
    });

    it('has correct learning defaults', () => {
      expect(DEFAULT_CONFIG.learning.retrainingIntervalHours).toBe(24);
      expect(DEFAULT_CONFIG.learning.minimumOutcomeRecords).toBe(50);
      expect(DEFAULT_CONFIG.learning.outcomeSubmissionTimeoutSeconds).toBe(60);
    });

    it('has correct auditLog defaults', () => {
      expect(DEFAULT_CONFIG.auditLog.retentionDays).toBe(90);
    });

    it('has correct notifications defaults', () => {
      expect(DEFAULT_CONFIG.notifications.channelEndpoint).toBe('');
    });

    it('has correct dynatraceIngestion defaults', () => {
      expect(DEFAULT_CONFIG.dynatraceIngestion.metricsEndpoint).toBe('');
      expect(DEFAULT_CONFIG.dynatraceIngestion.logEndpoint).toBe('');
      expect(DEFAULT_CONFIG.dynatraceIngestion.apiToken).toBe('');
      expect(DEFAULT_CONFIG.dynatraceIngestion.requestTimeoutSeconds).toBe(10);
      expect(DEFAULT_CONFIG.dynatraceIngestion.retryConfig.maxRetries).toBe(5);
      expect(DEFAULT_CONFIG.dynatraceIngestion.retryConfig.initialBackoffSeconds).toBe(2);
      expect(DEFAULT_CONFIG.dynatraceIngestion.retryConfig.backoffMultiplier).toBe(2);
      expect(DEFAULT_CONFIG.dynatraceIngestion.retryConfig.maxBackoffSeconds).toBe(32);
      expect(DEFAULT_CONFIG.dynatraceIngestion.batchConfig.maxBatchSize).toBe(100);
      expect(DEFAULT_CONFIG.dynatraceIngestion.batchConfig.flushIntervalSeconds).toBe(5);
    });
  });

  describe('loadConfig', () => {
    it('returns default config when called with no arguments', () => {
      const config = loadConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('merges partial overrides with defaults', () => {
      const config = loadConfig({ discovery: { intervalMinutes: 120 } });
      expect(config.discovery.intervalMinutes).toBe(120);
      // Other defaults remain
      expect(config.healthCheck.intervalSeconds).toBe(30);
      expect(config.learning.retrainingIntervalHours).toBe(24);
    });

    it('deep merges nested objects', () => {
      const config = loadConfig({
        dynatraceIngestion: {
          metricsEndpoint: 'https://example.com/metrics',
          retryConfig: { maxRetries: 3 },
        },
      });
      expect(config.dynatraceIngestion.metricsEndpoint).toBe('https://example.com/metrics');
      expect(config.dynatraceIngestion.retryConfig.maxRetries).toBe(3);
      // Other nested defaults remain
      expect(config.dynatraceIngestion.retryConfig.initialBackoffSeconds).toBe(2);
      expect(config.dynatraceIngestion.logEndpoint).toBe('');
    });

    it('throws on invalid discovery interval (too low)', () => {
      expect(() => loadConfig({ discovery: { intervalMinutes: 4 } })).toThrow(
        ConfigValidationError
      );
    });

    it('throws on invalid discovery interval (too high)', () => {
      expect(() => loadConfig({ discovery: { intervalMinutes: 1441 } })).toThrow(
        ConfigValidationError
      );
    });

    it('throws on invalid retraining interval (too low)', () => {
      expect(() => loadConfig({ learning: { retrainingIntervalHours: 0 } })).toThrow(
        ConfigValidationError
      );
    });

    it('throws on invalid retraining interval (too high)', () => {
      expect(() => loadConfig({ learning: { retrainingIntervalHours: 169 } })).toThrow(
        ConfigValidationError
      );
    });

    it('accepts boundary values for discovery interval', () => {
      expect(() => loadConfig({ discovery: { intervalMinutes: 5 } })).not.toThrow();
      expect(() => loadConfig({ discovery: { intervalMinutes: 1440 } })).not.toThrow();
    });

    it('accepts boundary values for retraining interval', () => {
      expect(() => loadConfig({ learning: { retrainingIntervalHours: 1 } })).not.toThrow();
      expect(() => loadConfig({ learning: { retrainingIntervalHours: 168 } })).not.toThrow();
    });
  });

  describe('validateConfig', () => {
    it('passes for default config', () => {
      expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
    });

    it('throws for non-positive healthCheck.intervalSeconds', () => {
      const config = { ...DEFAULT_CONFIG, healthCheck: { ...DEFAULT_CONFIG.healthCheck, intervalSeconds: 0 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for non-positive healthCheck.responseTimeoutSeconds', () => {
      const config = { ...DEFAULT_CONFIG, healthCheck: { ...DEFAULT_CONFIG.healthCheck, responseTimeoutSeconds: -1 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for non-positive healthCheck.componentTimeoutSeconds', () => {
      const config = { ...DEFAULT_CONFIG, healthCheck: { ...DEFAULT_CONFIG.healthCheck, componentTimeoutSeconds: 0 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for deployment.maxHoneytokensPerPod out of range', () => {
      const config = { ...DEFAULT_CONFIG, deployment: { ...DEFAULT_CONFIG.deployment, maxHoneytokensPerPod: 0 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);

      const config2 = { ...DEFAULT_CONFIG, deployment: { ...DEFAULT_CONFIG.deployment, maxHoneytokensPerPod: 6 } };
      expect(() => validateConfig(config2)).toThrow(ConfigValidationError);
    });

    it('throws for non-positive deployment.deploymentTimeoutSeconds', () => {
      const config = { ...DEFAULT_CONFIG, deployment: { ...DEFAULT_CONFIG.deployment, deploymentTimeoutSeconds: 0 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for non-positive response.isolationTimeoutSeconds', () => {
      const config = { ...DEFAULT_CONFIG, response: { ...DEFAULT_CONFIG.response, isolationTimeoutSeconds: 0 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for auditLog.retentionDays below 90', () => {
      const config = { ...DEFAULT_CONFIG, auditLog: { retentionDays: 89 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('accepts auditLog.retentionDays of exactly 90', () => {
      const config = { ...DEFAULT_CONFIG, auditLog: { retentionDays: 90 } };
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('throws for non-positive reporting.reportRetentionDays', () => {
      const config = { ...DEFAULT_CONFIG, reporting: { ...DEFAULT_CONFIG.reporting, reportRetentionDays: 0 } };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for negative dynatraceIngestion.retryConfig.maxRetries', () => {
      const config: EbeecontrolConfig = {
        ...DEFAULT_CONFIG,
        dynatraceIngestion: {
          ...DEFAULT_CONFIG.dynatraceIngestion,
          retryConfig: { ...DEFAULT_CONFIG.dynatraceIngestion.retryConfig, maxRetries: -1 },
        },
      };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for non-positive dynatraceIngestion.retryConfig.initialBackoffSeconds', () => {
      const config: EbeecontrolConfig = {
        ...DEFAULT_CONFIG,
        dynatraceIngestion: {
          ...DEFAULT_CONFIG.dynatraceIngestion,
          retryConfig: { ...DEFAULT_CONFIG.dynatraceIngestion.retryConfig, initialBackoffSeconds: 0 },
        },
      };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for backoffMultiplier less than 1', () => {
      const config: EbeecontrolConfig = {
        ...DEFAULT_CONFIG,
        dynatraceIngestion: {
          ...DEFAULT_CONFIG.dynatraceIngestion,
          retryConfig: { ...DEFAULT_CONFIG.dynatraceIngestion.retryConfig, backoffMultiplier: 0.5 },
        },
      };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for non-positive batchConfig.maxBatchSize', () => {
      const config: EbeecontrolConfig = {
        ...DEFAULT_CONFIG,
        dynatraceIngestion: {
          ...DEFAULT_CONFIG.dynatraceIngestion,
          batchConfig: { ...DEFAULT_CONFIG.dynatraceIngestion.batchConfig, maxBatchSize: 0 },
        },
      };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    it('throws for non-positive batchConfig.flushIntervalSeconds', () => {
      const config: EbeecontrolConfig = {
        ...DEFAULT_CONFIG,
        dynatraceIngestion: {
          ...DEFAULT_CONFIG.dynatraceIngestion,
          batchConfig: { ...DEFAULT_CONFIG.dynatraceIngestion.batchConfig, flushIntervalSeconds: 0 },
        },
      };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });
  });
});
