/**
 * Dynatrace MCP Server client implementation.
 * Provides service discovery, pod context queries, event subscription,
 * and forensic report submission capabilities.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6
 */

import {
  HighRiskService,
  PodContext,
  AccessEvent,
  ForensicReport,
} from '../types/index';
import { retryWithBackoff } from '../utils/retry';

/**
 * Interface for the Dynatrace MCP Server client.
 */
export interface DynatraceMcpServer {
  queryHighRiskServices(): Promise<HighRiskService[]>;
  getPodContext(podId: string, namespace: string): Promise<PodContext | null>;
  onAccessEvent(callback: (event: AccessEvent) => void): void;
  submitForensicReport(report: ForensicReport): Promise<void>;
}

/**
 * Configuration for the Dynatrace MCP Server client.
 */
export interface DynatraceClientConfig {
  /** Base URL of the Dynatrace MCP Server endpoint */
  endpointUrl: string;
  /** Timeout for high-risk service discovery queries in milliseconds (default: 30000) */
  discoveryTimeoutMs?: number;
  /** Maximum number of retries for discovery queries (default: 5) */
  maxRetries?: number;
  /** Timeout for pod context queries in milliseconds (default: 3000) */
  contextTimeoutMs?: number;
}

/**
 * HTTP fetch function type for dependency injection.
 * Allows testing without real HTTP calls.
 */
export type FetchFn = (url: string, options: FetchOptions) => Promise<FetchResponse>;

export interface FetchOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Dynatrace MCP Server client implementing high-risk service discovery,
 * pod context queries, access event subscription, and forensic report submission
 * with configurable timeouts and exponential backoff retry.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 3.3, 6.4, 6.6
 */
export class DynatraceClient implements Pick<DynatraceMcpServer, 'queryHighRiskServices' | 'getPodContext' | 'onAccessEvent' | 'submitForensicReport'> {
  private readonly config: Required<DynatraceClientConfig>;
  private readonly fetch: FetchFn;
  private readonly computeDelay?: (attempt: number) => number;
  private readonly accessEventCallbacks: Array<(event: AccessEvent) => void> = [];

  constructor(
    config: DynatraceClientConfig,
    fetchFn: FetchFn,
    computeDelay?: (attempt: number) => number
  ) {
    this.config = {
      endpointUrl: config.endpointUrl,
      discoveryTimeoutMs: config.discoveryTimeoutMs ?? 30_000,
      maxRetries: config.maxRetries ?? 5,
      contextTimeoutMs: config.contextTimeoutMs ?? 3_000,
    };
    this.fetch = fetchFn;
    this.computeDelay = computeDelay;
  }

  /**
   * Queries the Dynatrace MCP Server for high-risk services.
   *
   * - Applies a 30-second timeout per request attempt
   * - Retries with exponential backoff (5 retries starting at 2s)
   * - Returns empty array when no services found (not an error)
   * - Throws after all retries are exhausted
   *
   * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6
   */
  async queryHighRiskServices(): Promise<HighRiskService[]> {
    return retryWithBackoff<HighRiskService[]>({
      operation: () => this.fetchHighRiskServices(),
      maxRetries: this.config.maxRetries,
      ...(this.computeDelay && { computeDelay: this.computeDelay }),
    });
  }

  /**
   * Single attempt to fetch high-risk services with timeout.
   */
  private async fetchHighRiskServices(): Promise<HighRiskService[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.discoveryTimeoutMs
    );

    try {
      const url = `${this.config.endpointUrl}/api/v1/services/high-risk`;
      const response = await this.fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Dynatrace MCP Server returned status ${response.status}`
        );
      }

      const data = (await response.json()) as { services?: HighRiskService[] };

      // Return empty array when no services found (not an error)
      if (!data.services || data.services.length === 0) {
        return [];
      }

      return data.services;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Dynatrace MCP Server query timed out after ${this.config.discoveryTimeoutMs}ms`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Queries the Dynatrace MCP Server for pod context information.
   *
   * - Applies a 3-second timeout (configurable via contextTimeoutMs)
   * - No retries (context queries need to be fast)
   * - Returns null on timeout or HTTP error (caller defaults to high classification)
   *
   * Validates: Requirements 4.1, 4.2, 4.5
   */
  async getPodContext(podId: string, namespace: string): Promise<PodContext | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.contextTimeoutMs
    );

    try {
      const url = `${this.config.endpointUrl}/api/v1/pods/${podId}/context?namespace=${namespace}`;
      const response = await this.fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as PodContext;
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Registers a callback to be invoked when access events are received
   * from Tetragon via the Dynatrace MCP Server.
   *
   * Validates: Requirements 3.3
   */
  onAccessEvent(callback: (event: AccessEvent) => void): void {
    this.accessEventCallbacks.push(callback);
  }

  /**
   * Emits an access event to all registered callbacks.
   * Used for testing/simulation purposes to trigger event processing
   * as if the event was received from Tetragon via Dynatrace.
   */
  emitAccessEvent(event: AccessEvent): void {
    for (const callback of this.accessEventCallbacks) {
      callback(event);
    }
  }

  /**
   * Submits a forensic report to the Dynatrace MCP Server for correlation
   * with other observability data.
   *
   * - Applies a 30-second timeout per request attempt
   * - Retries with exponential backoff (5 retries starting at 2s)
   * - Throws after all retries are exhausted
   *
   * Validates: Requirements 6.4, 6.6
   */
  async submitForensicReport(report: ForensicReport): Promise<void> {
    await retryWithBackoff<void>({
      operation: () => this.postForensicReport(report),
      maxRetries: this.config.maxRetries,
      ...(this.computeDelay && { computeDelay: this.computeDelay }),
    });
  }

  /**
   * Single attempt to POST a forensic report with 30-second timeout.
   */
  private async postForensicReport(report: ForensicReport): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.discoveryTimeoutMs
    );

    try {
      const url = `${this.config.endpointUrl}/api/v1/reports`;
      const response = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(report),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Dynatrace MCP Server returned status ${response.status}`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Forensic report submission timed out after ${this.config.discoveryTimeoutMs}ms`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
