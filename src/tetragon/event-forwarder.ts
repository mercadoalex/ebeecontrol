/**
 * Event Forwarder - Forwards AccessEvents to Dynatrace MCP Server with retry logic.
 *
 * Attempts to forward events within 2 seconds. On failure, buffers locally
 * and retries at 10-second fixed intervals (max 5 attempts).
 * Emits a buffer overflow warning on next successful connection if overflow occurred.
 *
 * Validates: Requirements 3.3, 3.5
 */

import { AccessEvent } from "../types/index.js";
import { createEventBuffer, EventBuffer } from "./event-buffer.js";
import { retryWithFixedInterval } from "../utils/retry.js";

/**
 * Status of the event forwarder's internal buffer.
 */
export interface BufferStatus {
  currentSize: number;
  maxCapacity: 1000;
  oldestEventTimestamp?: string;
  overflowCount: number;
}

/**
 * Interface for the event forwarder component.
 */
export interface EventForwarder {
  forward(event: AccessEvent): Promise<void>;
  getBufferStatus(): BufferStatus;
  setForwardFn(fn: (event: AccessEvent) => Promise<void>): void;
}

/** Forwarding timeout in milliseconds (2 seconds). */
const FORWARD_TIMEOUT_MS = 2000;

/** Retry interval in seconds (10 seconds). */
const RETRY_INTERVAL_SECONDS = 10;

/** Maximum number of retry attempts. */
const MAX_RETRIES = 5;

/**
 * Wraps a forwarding function with a timeout.
 * Rejects if the forward function does not resolve within the given timeout.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Forward timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Creates an EventForwarder instance.
 *
 * @param initialForwardFn - Optional initial forwarding function (dependency injection).
 * @returns An EventForwarder instance.
 */
export function createEventForwarder(
  initialForwardFn?: (event: AccessEvent) => Promise<void>
): EventForwarder {
  const buffer: EventBuffer = createEventBuffer();
  let forwardFn: ((event: AccessEvent) => Promise<void>) | undefined = initialForwardFn;
  let pendingOverflowWarning = false;

  /**
   * Attempts to forward a single event using the configured forward function.
   * Applies the 2-second timeout constraint.
   */
  async function attemptForward(event: AccessEvent): Promise<void> {
    if (!forwardFn) {
      throw new Error("No forward function configured");
    }
    await withTimeout(forwardFn(event), FORWARD_TIMEOUT_MS);
  }

  /**
   * Emits a buffer overflow warning via the forward function.
   * Called on next successful forward if overflow has occurred.
   */
  async function emitOverflowWarning(overflowCount: number): Promise<void> {
    if (!forwardFn) return;

    const warningEvent: AccessEvent = {
      eventId: `overflow-warning-${Date.now()}`,
      processId: 0,
      processBinaryPath: "ebeecontrol/event-forwarder",
      userId: 0,
      podId: "system",
      namespace: "ebeecontrol",
      honeytokenPath: "buffer-overflow-warning",
      accessType: "stat",
      timestamp: new Date().toISOString(),
    };

    // Best-effort: don't fail the main forward if warning emission fails
    try {
      await forwardFn(warningEvent);
    } catch {
      // Silently ignore warning emission failures
    }
  }

  /**
   * Drains buffered events by attempting to forward them.
   * Called after a successful forward to flush the buffer.
   */
  async function drainBuffer(): Promise<void> {
    const events = buffer.getAll();
    if (events.length === 0) return;

    for (const event of events) {
      try {
        await attemptForward(event);
      } catch {
        // Stop draining on first failure - remaining events stay buffered
        return;
      }
    }

    // All events forwarded successfully, clear the buffer
    buffer.clear();
  }

  return {
    async forward(event: AccessEvent): Promise<void> {
      // First attempt: try to forward within 2 seconds
      try {
        await attemptForward(event);

        // Success - check if we need to emit overflow warning
        if (pendingOverflowWarning) {
          const overflowCount = buffer.getOverflowCount();
          await emitOverflowWarning(overflowCount);
          pendingOverflowWarning = false;
        }

        // Try to drain any buffered events
        await drainBuffer();
        return;
      } catch {
        // Initial forward failed - buffer the event and retry
      }

      // Buffer the event
      const overflowBefore = buffer.getOverflowCount();
      buffer.add(event);
      const overflowAfter = buffer.getOverflowCount();

      if (overflowAfter > overflowBefore) {
        pendingOverflowWarning = true;
      }

      // Schedule retries with fixed interval
      try {
        await retryWithFixedInterval({
          operation: async () => {
            await attemptForward(event);
          },
          maxRetries: MAX_RETRIES - 1, // retryWithFixedInterval does 1 initial + maxRetries
          intervalSeconds: RETRY_INTERVAL_SECONDS,
        });

        // Retry succeeded - remove the event from buffer by draining
        if (pendingOverflowWarning) {
          const overflowCount = buffer.getOverflowCount();
          await emitOverflowWarning(overflowCount);
          pendingOverflowWarning = false;
        }

        await drainBuffer();
      } catch {
        // All retries exhausted - event remains in buffer
        // Mark overflow warning for next successful connection
        if (buffer.getOverflowCount() > 0) {
          pendingOverflowWarning = true;
        }
      }
    },

    getBufferStatus(): BufferStatus {
      return {
        currentSize: buffer.getSize(),
        maxCapacity: 1000,
        oldestEventTimestamp: buffer.getOldestTimestamp(),
        overflowCount: buffer.getOverflowCount(),
      };
    },

    setForwardFn(fn: (event: AccessEvent) => Promise<void>): void {
      forwardFn = fn;
    },
  };
}
