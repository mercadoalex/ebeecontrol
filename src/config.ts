/**
 * Configuration module for the Ebeecontrol autonomous deception engine.
 * Provides the EbeecontrolConfig interface, default values, and validation.
 */

export interface RetryConfig {
  maxRetries: number;
  initialBackoffSeconds: number;
  backoffMultiplier: number;
  maxBackoffSeconds: number;
}

export interface BatchConfig {
  maxBatchSize: number;
  flushIntervalSeconds: number;
}

export interface DynatraceIngestionConfig {
  metricsEndpoint: string;
  logEndpoint: string;
  apiToken: string;
  requestTimeoutSeconds: number;
  retryConfig: RetryConfig;
  batchConfig: BatchConfig;
}

export interface EbeecontrolConfig {
  discovery: {
    intervalMinutes: number; // 5-1440, default 60
  };
  healthCheck: {
    intervalSeconds: number; // default 30
    responseTimeoutSeconds: number; // default 5
    componentTimeoutSeconds: number; // default 10
  };
  deployment: {
    maxHoneytokensPerPod: number; // 1-5
    deploymentTimeoutSeconds: number; // default 30
  };
  response: {
    isolationTimeoutSeconds: number; // default 10
    isolationMaxRetries: number; // default 3
    isolationRetryIntervalSeconds: number; // default 5
    ipBlockMaxRetries: number; // default 3
    ipBlockRetryIntervalSeconds: number; // default 5
  };
  reporting: {
    reportRetentionDays: number; // default 90
    reportGenerationTimeoutSeconds: number; // default 60
    reportGenerationMaxRetries: number; // default 3
  };
  learning: {
    retrainingIntervalHours: number; // 1-168, default 24
    minimumOutcomeRecords: number; // default 50
    outcomeSubmissionTimeoutSeconds: number; // default 60
  };
  auditLog: {
    retentionDays: number; // minimum 90
  };
  notifications: {
    channelEndpoint: string;
  };
  dynatraceIngestion: DynatraceIngestionConfig;
}

/**
 * Default configuration values for the Ebeecontrol system.
 */
export const DEFAULT_CONFIG: EbeecontrolConfig = {
  discovery: {
    intervalMinutes: 60,
  },
  healthCheck: {
    intervalSeconds: 30,
    responseTimeoutSeconds: 5,
    componentTimeoutSeconds: 10,
  },
  deployment: {
    maxHoneytokensPerPod: 5,
    deploymentTimeoutSeconds: 30,
  },
  response: {
    isolationTimeoutSeconds: 10,
    isolationMaxRetries: 3,
    isolationRetryIntervalSeconds: 5,
    ipBlockMaxRetries: 3,
    ipBlockRetryIntervalSeconds: 5,
  },
  reporting: {
    reportRetentionDays: 90,
    reportGenerationTimeoutSeconds: 60,
    reportGenerationMaxRetries: 3,
  },
  learning: {
    retrainingIntervalHours: 24,
    minimumOutcomeRecords: 50,
    outcomeSubmissionTimeoutSeconds: 60,
  },
  auditLog: {
    retentionDays: 90,
  },
  notifications: {
    channelEndpoint: '',
  },
  dynatraceIngestion: {
    metricsEndpoint: '',
    logEndpoint: '',
    apiToken: '',
    requestTimeoutSeconds: 10,
    retryConfig: {
      maxRetries: 5,
      initialBackoffSeconds: 2,
      backoffMultiplier: 2,
      maxBackoffSeconds: 32,
    },
    batchConfig: {
      maxBatchSize: 100,
      flushIntervalSeconds: 5,
    },
  },
};

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validates the provided configuration, throwing ConfigValidationError
 * if any values are outside their allowed ranges.
 */
export function validateConfig(config: EbeecontrolConfig): void {
  // Discovery interval: 5-1440 minutes
  if (config.discovery.intervalMinutes < 5 || config.discovery.intervalMinutes > 1440) {
    throw new ConfigValidationError(
      `discovery.intervalMinutes must be between 5 and 1440, got ${config.discovery.intervalMinutes}`
    );
  }

  // Learning retraining interval: 1-168 hours
  if (config.learning.retrainingIntervalHours < 1 || config.learning.retrainingIntervalHours > 168) {
    throw new ConfigValidationError(
      `learning.retrainingIntervalHours must be between 1 and 168, got ${config.learning.retrainingIntervalHours}`
    );
  }

  // Health check interval: must be positive
  if (config.healthCheck.intervalSeconds <= 0) {
    throw new ConfigValidationError(
      `healthCheck.intervalSeconds must be positive, got ${config.healthCheck.intervalSeconds}`
    );
  }

  // Health check response timeout: must be positive
  if (config.healthCheck.responseTimeoutSeconds <= 0) {
    throw new ConfigValidationError(
      `healthCheck.responseTimeoutSeconds must be positive, got ${config.healthCheck.responseTimeoutSeconds}`
    );
  }

  // Health check component timeout: must be positive
  if (config.healthCheck.componentTimeoutSeconds <= 0) {
    throw new ConfigValidationError(
      `healthCheck.componentTimeoutSeconds must be positive, got ${config.healthCheck.componentTimeoutSeconds}`
    );
  }

  // Deployment max honeytokens per pod: 1-5
  if (config.deployment.maxHoneytokensPerPod < 1 || config.deployment.maxHoneytokensPerPod > 5) {
    throw new ConfigValidationError(
      `deployment.maxHoneytokensPerPod must be between 1 and 5, got ${config.deployment.maxHoneytokensPerPod}`
    );
  }

  // Deployment timeout: must be positive
  if (config.deployment.deploymentTimeoutSeconds <= 0) {
    throw new ConfigValidationError(
      `deployment.deploymentTimeoutSeconds must be positive, got ${config.deployment.deploymentTimeoutSeconds}`
    );
  }

  // Response isolation timeout: must be positive
  if (config.response.isolationTimeoutSeconds <= 0) {
    throw new ConfigValidationError(
      `response.isolationTimeoutSeconds must be positive, got ${config.response.isolationTimeoutSeconds}`
    );
  }

  // Audit log retention: minimum 90 days
  if (config.auditLog.retentionDays < 90) {
    throw new ConfigValidationError(
      `auditLog.retentionDays must be at least 90, got ${config.auditLog.retentionDays}`
    );
  }

  // Reporting retention: must be positive
  if (config.reporting.reportRetentionDays <= 0) {
    throw new ConfigValidationError(
      `reporting.reportRetentionDays must be positive, got ${config.reporting.reportRetentionDays}`
    );
  }

  // Dynatrace ingestion retry config validation
  if (config.dynatraceIngestion.retryConfig.maxRetries < 0) {
    throw new ConfigValidationError(
      `dynatraceIngestion.retryConfig.maxRetries must be non-negative, got ${config.dynatraceIngestion.retryConfig.maxRetries}`
    );
  }

  if (config.dynatraceIngestion.retryConfig.initialBackoffSeconds <= 0) {
    throw new ConfigValidationError(
      `dynatraceIngestion.retryConfig.initialBackoffSeconds must be positive, got ${config.dynatraceIngestion.retryConfig.initialBackoffSeconds}`
    );
  }

  if (config.dynatraceIngestion.retryConfig.backoffMultiplier < 1) {
    throw new ConfigValidationError(
      `dynatraceIngestion.retryConfig.backoffMultiplier must be at least 1, got ${config.dynatraceIngestion.retryConfig.backoffMultiplier}`
    );
  }

  if (config.dynatraceIngestion.batchConfig.maxBatchSize <= 0) {
    throw new ConfigValidationError(
      `dynatraceIngestion.batchConfig.maxBatchSize must be positive, got ${config.dynatraceIngestion.batchConfig.maxBatchSize}`
    );
  }

  if (config.dynatraceIngestion.batchConfig.flushIntervalSeconds <= 0) {
    throw new ConfigValidationError(
      `dynatraceIngestion.batchConfig.flushIntervalSeconds must be positive, got ${config.dynatraceIngestion.batchConfig.flushIntervalSeconds}`
    );
  }
}

/**
 * Loads configuration by merging a partial config with defaults,
 * then validates the result.
 *
 * @param partial - Optional partial configuration to override defaults
 * @returns A fully populated and validated EbeecontrolConfig
 * @throws ConfigValidationError if the resulting config is invalid
 */
export function loadConfig(partial?: Partial<DeepPartial<EbeecontrolConfig>>): EbeecontrolConfig {
  const config = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, (partial ?? {}) as Record<string, unknown>) as unknown as EbeecontrolConfig;
  validateConfig(config);
  return config;
}

/**
 * Deep partial type utility for nested partial overrides.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Deep merges source into target, returning a new object.
 * Source values override target values at each level.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      targetVal !== undefined &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }

  return result;
}
