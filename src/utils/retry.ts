/**
 * Exponential backoff and retry utilities for ebeecontrol.
 * Used for Dynatrace MCP Server connectivity, Dynatrace API ingestion,
 * and other retry-able operations throughout the system.
 */

/**
 * Computes the backoff delay for a given retry attempt using exponential backoff.
 * The delay follows the formula 2^(n+1) seconds, producing the sequence:
 * attempt 0 → 2s, attempt 1 → 4s, attempt 2 → 8s, attempt 3 → 16s, attempt 4 → 32s
 *
 * @param attempt - The zero-based retry attempt number (0 to 4)
 * @returns The delay in seconds for the given attempt
 */
export function computeBackoffDelay(attempt: number): number {
  return Math.pow(2, attempt + 1);
}

/**
 * Options for the retryWithBackoff function.
 */
export interface RetryWithBackoffOptions<T> {
  /** The async operation to retry */
  operation: () => Promise<T>;
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
  /** Function to compute delay in seconds for a given attempt (default: computeBackoffDelay) */
  computeDelay?: (attempt: number) => number;
  /** Optional callback invoked before each retry with the attempt number and error */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Retries an async operation with exponential backoff.
 * The operation is attempted once initially, then retried up to maxRetries times
 * with increasing delays between attempts.
 *
 * @param options - Configuration for the retry behavior
 * @returns The result of the successful operation
 * @throws The last error if all retry attempts are exhausted
 */
export async function retryWithBackoff<T>(options: RetryWithBackoffOptions<T>): Promise<T> {
  const {
    operation,
    maxRetries = 5,
    computeDelay = computeBackoffDelay,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        if (onRetry) {
          onRetry(attempt, lastError);
        }
        const delaySeconds = computeDelay(attempt);
        await sleep(delaySeconds * 1000);
      }
    }
  }

  throw lastError;
}

/**
 * Options for the retryWithFixedInterval function.
 */
export interface RetryWithFixedIntervalOptions<T> {
  /** The async operation to retry */
  operation: () => Promise<T>;
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Fixed interval between retries in seconds */
  intervalSeconds: number;
  /** Optional callback invoked before each retry with the attempt number and error */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Retries an async operation with a fixed interval between attempts.
 * Used for scenarios like Tetragon event forwarding (10-second intervals)
 * and pod isolation retries (5-second intervals).
 *
 * @param options - Configuration for the retry behavior
 * @returns The result of the successful operation
 * @throws The last error if all retry attempts are exhausted
 */
export async function retryWithFixedInterval<T>(options: RetryWithFixedIntervalOptions<T>): Promise<T> {
  const {
    operation,
    maxRetries,
    intervalSeconds,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        if (onRetry) {
          onRetry(attempt, lastError);
        }
        await sleep(intervalSeconds * 1000);
      }
    }
  }

  throw lastError;
}

/**
 * Utility function to sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
