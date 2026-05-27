/**
 * Real HTTP client for production use.
 * Replaces the mock fetch with actual HTTP calls to Dynatrace APIs.
 *
 * Uses Node.js native fetch (available in Node 18+).
 */

import { FetchFn, FetchOptions, FetchResponse } from '../dynatrace/client.js';

/**
 * Creates a real HTTP fetch function compatible with the FetchFn interface.
 * Uses Node.js native fetch API.
 */
export function createHttpClient(): FetchFn {
  return async (url: string, options: FetchOptions): Promise<FetchResponse> => {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: options.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json() as Promise<unknown>,
    };
  };
}
