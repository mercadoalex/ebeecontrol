import { describe, it, expect, vi } from 'vitest';
import {
  computeBackoffDelay,
  retryWithBackoff,
  retryWithFixedInterval,
} from './retry';

describe('computeBackoffDelay', () => {
  it('should return 2 for attempt 0', () => {
    expect(computeBackoffDelay(0)).toBe(2);
  });

  it('should return 4 for attempt 1', () => {
    expect(computeBackoffDelay(1)).toBe(4);
  });

  it('should return 8 for attempt 2', () => {
    expect(computeBackoffDelay(2)).toBe(8);
  });

  it('should return 16 for attempt 3', () => {
    expect(computeBackoffDelay(3)).toBe(16);
  });

  it('should return 32 for attempt 4', () => {
    expect(computeBackoffDelay(4)).toBe(32);
  });

  it('should produce the sequence [2, 4, 8, 16, 32] for attempts 0-4', () => {
    const sequence = [0, 1, 2, 3, 4].map(computeBackoffDelay);
    expect(sequence).toEqual([2, 4, 8, 16, 32]);
  });
});

describe('retryWithBackoff', () => {
  it('should return immediately on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await retryWithBackoff({ operation, computeDelay: () => 0 });

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed on subsequent attempt', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');
    const onRetry = vi.fn();

    const result = await retryWithBackoff({
      operation,
      onRetry,
      computeDelay: () => 0,
    });

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(0, expect.any(Error));
  });

  it('should throw the last error after exhausting all retries', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('persistent failure'));

    await expect(
      retryWithBackoff({ operation, maxRetries: 3, computeDelay: () => 0 })
    ).rejects.toThrow('persistent failure');

    expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('should use custom computeDelay function', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('done');
    const customDelay = vi.fn().mockReturnValue(0);

    await retryWithBackoff({
      operation,
      computeDelay: customDelay,
    });

    expect(customDelay).toHaveBeenCalledWith(0);
  });

  it('should default to 5 max retries', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      retryWithBackoff({ operation, computeDelay: () => 0 })
    ).rejects.toThrow('fail');

    expect(operation).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
  });

  it('should handle non-Error throws by wrapping them', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce('string error')
      .mockResolvedValue('ok');
    const onRetry = vi.fn();

    await retryWithBackoff({ operation, onRetry, computeDelay: () => 0 });

    expect(onRetry).toHaveBeenCalledWith(0, expect.objectContaining({
      message: 'string error',
    }));
  });

  it('should call onRetry for each failed attempt except the last', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('fail'));
    const onRetry = vi.fn();

    await expect(
      retryWithBackoff({ operation, maxRetries: 3, computeDelay: () => 0, onRetry })
    ).rejects.toThrow('fail');

    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledWith(0, expect.any(Error));
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error));
  });
});

describe('retryWithFixedInterval', () => {
  it('should return immediately on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await retryWithFixedInterval({
      operation,
      maxRetries: 3,
      intervalSeconds: 0,
    });

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry with fixed interval on failure', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');
    const onRetry = vi.fn();

    const result = await retryWithFixedInterval({
      operation,
      maxRetries: 5,
      intervalSeconds: 0,
      onRetry,
    });

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('should throw after exhausting all retries', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      retryWithFixedInterval({
        operation,
        maxRetries: 3,
        intervalSeconds: 0,
      })
    ).rejects.toThrow('always fails');

    expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('should call onRetry with attempt number and error', async () => {
    const errors = [new Error('err1'), new Error('err2')];
    const operation = vi.fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockResolvedValue('ok');
    const onRetry = vi.fn();

    await retryWithFixedInterval({
      operation,
      maxRetries: 5,
      intervalSeconds: 0,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledWith(0, errors[0]);
    expect(onRetry).toHaveBeenCalledWith(1, errors[1]);
  });

  it('should not call onRetry on the final failed attempt', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('fail'));
    const onRetry = vi.fn();

    await expect(
      retryWithFixedInterval({
        operation,
        maxRetries: 2,
        intervalSeconds: 0,
        onRetry,
      })
    ).rejects.toThrow('fail');

    // onRetry called for attempts 0 and 1, but NOT for the final attempt (2)
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
