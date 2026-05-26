/**
 * Dynatrace Metrics API v2 client for pushing custom metrics.
 * Buffers items locally on delivery failure and retries with exponential backoff.
 *
 * Validates: Requirements 9.1, 9.7, 9.16, 9.17
 */

import { DynatraceIngestionConfig } from '../config';
import {
  HoneytokenRegistryMetricPayload,
  ComponentHealthMetricPayload,
  LearningMetricPayload,
  IngestionBufferStatus,
  IngestionRetryState,
} from '../types/dynatrace-ingestion';
import { FetchFn, FetchOptions } from '../dynatrace/client';

/**
 * Interface for the Dynatrace Metrics ingestion client.
 */
export interface DynatraceMetricsClient {
  pushHoneytokenRegistryMetric(payload: HoneytokenRegistryMetricPayload): Promise<void>;
  pushComponentHealthMetric(payload: ComponentHealthMetricPayload): Promise<void>;
  pushLearningMetrics(payload: LearningMetricPayload): Promise<void>;
  flush(): Promise<void>;
  getBufferStatus(): IngestionBufferStatus;
}

/**
 * Computes exponential backoff delay for a given attempt.
 * Sequence: 2s, 4s, 8s, 16s, 32s (capped at maxBackoffSeconds).
 */
function computeIngestionBackoff(
  attempt: number,
  initialBackoffSeconds: number,
  backoffMultiplier: number,
  maxBackoffSeconds: number
): number {
  const delay = initialBackoffSeconds * Math.pow(backoffMultiplier, attempt);
  return Math.min(delay, maxBackoffSeconds);
}

/**
 * Dynatrace Metrics API v2 client implementation.
 * Accepts metrics payloads, batches them, and flushes to the Dynatrace endpoint.
 * On failure, buffers items locally and retries with exponential backoff (5 retries).
 * Discards buffered data after retry exhaustion.
 */
export class DynatraceMetricsIngestionClient implements DynatraceMetricsClient {
  private readonly config: DynatraceIngestionConfig;
  private readonly fetch: FetchFn;
  private readonly pendingBatch: IngestionRetryState[] = [];
  private readonly retryBuffer: IngestionRetryState[] = [];
  private totalDiscardedCount = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly getNow: () => string;

  constructor(
    config: DynatraceIngestionConfig,
    fetchFn: FetchFn,
    options?: { getNow?: () => string }
  ) {
    this.config = config;
    this.fetch = fetchFn;
    this.getNow = options?.getNow ?? (() => new Date().toISOString());
  }

  /**
   * Starts the periodic flush timer based on batchConfig.flushIntervalSeconds.
   */
  startPeriodicFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(
      () => { void this.flush(); },
      this.config.batchConfig.flushIntervalSeconds * 1000
    );
  }

  /**
   * Stops the periodic flush timer.
   */
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Pushes a honeytoken registry metric to the batch queue.
   *
   * Validates: Requirements 9.1
   */
  async pushHoneytokenRegistryMetric(payload: HoneytokenRegistryMetricPayload): Promise<void> {
    this.enqueue(payload);
    if (this.pendingBatch.length >= this.config.batchConfig.maxBatchSize) {
      await this.flush();
    }
  }

  /**
   * Pushes a component health metric to the batch queue.
   *
   * Validates: Requirements 9.7
   */
  async pushComponentHealthMetric(payload: ComponentHealthMetricPayload): Promise<void> {
    this.enqueue(payload);
    if (this.pendingBatch.length >= this.config.batchConfig.maxBatchSize) {
      await this.flush();
    }
  }

  /**
   * Pushes adaptive learning metrics to the batch queue.
   */
  async pushLearningMetrics(payload: LearningMetricPayload): Promise<void> {
    this.enqueue(payload);
    if (this.pendingBatch.length >= this.config.batchConfig.maxBatchSize) {
      await this.flush();
    }
  }

  /**
   * Flushes all pending and retry-buffered items to the Dynatrace Metrics API.
   * Items that fail are moved to the retry buffer with incremented attempt count.
   * Items that exceed maxRetries are discarded.
   *
   * Validates: Requirements 9.16, 9.17
   */
  async flush(): Promise<void> {
    // Combine pending batch and retry buffer items ready for retry
    const now = this.getNow();
    const itemsToSend = [
      ...this.pendingBatch.splice(0),
      ...this.retryBuffer.filter(item => item.nextRetryTimestamp <= now),
    ];

    // Remove items from retry buffer that we're about to attempt
    const retryingIds = new Set(itemsToSend.filter(i => i.attemptCount > 0).map(i => i.itemId));
    for (let i = this.retryBuffer.length - 1; i >= 0; i--) {
      if (retryingIds.has(this.retryBuffer[i].itemId)) {
        this.retryBuffer.splice(i, 1);
      }
    }

    if (itemsToSend.length === 0) return;

    // Send in batches of maxBatchSize
    for (let i = 0; i < itemsToSend.length; i += this.config.batchConfig.maxBatchSize) {
      const batch = itemsToSend.slice(i, i + this.config.batchConfig.maxBatchSize);
      const payloads = batch.map(item => item.payload) as (HoneytokenRegistryMetricPayload | ComponentHealthMetricPayload | LearningMetricPayload)[];

      try {
        await this.sendToApi(payloads);
        // Success — items are delivered, nothing to do
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Move failed items to retry buffer or discard
        for (const item of batch) {
          const newAttemptCount = item.attemptCount + 1;
          if (newAttemptCount >= this.config.retryConfig.maxRetries) {
            // Discard after exhausting retries
            this.totalDiscardedCount++;
          } else {
            // Buffer for retry with exponential backoff
            const delay = computeIngestionBackoff(
              newAttemptCount - 1,
              this.config.retryConfig.initialBackoffSeconds,
              this.config.retryConfig.backoffMultiplier,
              this.config.retryConfig.maxBackoffSeconds
            );
            const nextRetry = new Date(new Date(now).getTime() + delay * 1000).toISOString();
            this.retryBuffer.push({
              ...item,
              attemptCount: newAttemptCount,
              nextRetryTimestamp: nextRetry,
              lastErrorMessage: errorMessage,
            });
          }
        }
      }
    }
  }

  /**
   * Returns the current buffer status.
   *
   * Validates: Requirements 9.16
   */
  getBufferStatus(): IngestionBufferStatus {
    const allBuffered = [...this.pendingBatch, ...this.retryBuffer];
    const timestamps = allBuffered
      .map(item => item.firstAttemptTimestamp)
      .filter(Boolean)
      .sort();

    return {
      bufferedItemCount: allBuffered.length,
      oldestBufferedTimestamp: timestamps[0] || undefined,
      retryInProgressCount: this.retryBuffer.length,
      totalDiscardedCount: this.totalDiscardedCount,
    };
  }

  /**
   * Enqueues a payload into the pending batch.
   */
  private enqueue(
    payload: HoneytokenRegistryMetricPayload | ComponentHealthMetricPayload | LearningMetricPayload
  ): void {
    const now = this.getNow();
    this.pendingBatch.push({
      itemId: `metric-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      payload,
      targetApi: 'metrics',
      firstAttemptTimestamp: now,
      attemptCount: 0,
      nextRetryTimestamp: now,
    });
  }

  /**
   * Sends a batch of metric payloads to the Dynatrace Metrics API v2.
   */
  private async sendToApi(
    payloads: (HoneytokenRegistryMetricPayload | ComponentHealthMetricPayload | LearningMetricPayload)[]
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutSeconds * 1000
    );

    try {
      const options: FetchOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Api-Token ${this.config.apiToken}`,
        },
        body: JSON.stringify(payloads),
        signal: controller.signal,
      };

      const response = await this.fetch(this.config.metricsEndpoint, options);

      if (!response.ok) {
        throw new Error(`Dynatrace Metrics API returned status ${response.status}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Dynatrace Metrics API request timed out after ${this.config.requestTimeoutSeconds}s`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
