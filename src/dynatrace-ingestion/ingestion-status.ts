/**
 * Ingestion Status - Combines buffer status from metrics and log clients
 * to report overall ingestion health.
 *
 * Reports:
 * - healthy: no retries in progress and no discards
 * - degraded: retries in progress but no discards occurring
 * - unhealthy: discards are occurring (data loss)
 *
 * Validates: Requirements 9.16, 9.17
 */

import { IngestionBufferStatus } from '../types/dynatrace-ingestion';

/**
 * Overall ingestion health status.
 */
export type IngestionHealth = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Combined ingestion status summary.
 */
export interface IngestionStatusSummary {
  health: IngestionHealth;
  healthLabel: string;
  healthIcon: string;
  metricsBufferStatus: IngestionBufferStatus;
  logsBufferStatus: IngestionBufferStatus;
  totalBufferedItems: number;
  totalRetryInProgress: number;
  totalDiscarded: number;
  summary: string;
}

/**
 * Computes the overall ingestion health based on combined buffer statuses.
 *
 * - healthy: no retries in progress and no discards
 * - degraded: retries in progress but no new discards since last check
 * - unhealthy: discards are occurring (totalDiscardedCount > 0)
 */
export function computeIngestionHealth(
  metricsStatus: IngestionBufferStatus,
  logsStatus: IngestionBufferStatus
): IngestionHealth {
  const totalDiscarded = metricsStatus.totalDiscardedCount + logsStatus.totalDiscardedCount;
  const totalRetries = metricsStatus.retryInProgressCount + logsStatus.retryInProgressCount;

  if (totalDiscarded > 0) {
    return 'unhealthy';
  }
  if (totalRetries > 0) {
    return 'degraded';
  }
  return 'healthy';
}

/**
 * Maps ingestion health to a human-readable label.
 */
function getHealthLabel(health: IngestionHealth): string {
  switch (health) {
    case 'healthy':
      return 'All ingestion pipelines operating normally';
    case 'degraded':
      return 'Ingestion retries in progress - data delivery delayed';
    case 'unhealthy':
      return 'Data loss occurring - ingestion retries exhausted';
  }
}

/**
 * Maps ingestion health to a display icon.
 */
function getHealthIcon(health: IngestionHealth): string {
  switch (health) {
    case 'healthy':
      return '✅';
    case 'degraded':
      return '⚠️';
    case 'unhealthy':
      return '❌';
  }
}

/**
 * Generates a concise summary string for monitoring.
 */
function generateSummary(
  health: IngestionHealth,
  totalBuffered: number,
  totalRetries: number,
  totalDiscarded: number
): string {
  if (health === 'healthy') {
    return 'Ingestion healthy. No buffered items.';
  }
  if (health === 'degraded') {
    return `Ingestion degraded. ${totalBuffered} items buffered, ${totalRetries} retries in progress.`;
  }
  return `Ingestion unhealthy. ${totalBuffered} items buffered, ${totalRetries} retries in progress, ${totalDiscarded} items discarded.`;
}

/**
 * Combines buffer status from both metrics and log clients to produce
 * an overall ingestion status summary for monitoring.
 */
export function getIngestionStatus(
  metricsBufferStatus: IngestionBufferStatus,
  logsBufferStatus: IngestionBufferStatus
): IngestionStatusSummary {
  const health = computeIngestionHealth(metricsBufferStatus, logsBufferStatus);
  const totalBufferedItems = metricsBufferStatus.bufferedItemCount + logsBufferStatus.bufferedItemCount;
  const totalRetryInProgress = metricsBufferStatus.retryInProgressCount + logsBufferStatus.retryInProgressCount;
  const totalDiscarded = metricsBufferStatus.totalDiscardedCount + logsBufferStatus.totalDiscardedCount;

  return {
    health,
    healthLabel: getHealthLabel(health),
    healthIcon: getHealthIcon(health),
    metricsBufferStatus,
    logsBufferStatus,
    totalBufferedItems,
    totalRetryInProgress,
    totalDiscarded,
    summary: generateSummary(health, totalBufferedItems, totalRetryInProgress, totalDiscarded),
  };
}
