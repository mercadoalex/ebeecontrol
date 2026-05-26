/**
 * Unit tests for the Tetragon gRPC client and event transformation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  transformTetragonEvent,
  createTetragonEventClient,
  TetragonKprobeEvent,
  TetragonGrpcStream,
} from './tetragon-client';

describe('transformTetragonEvent', () => {
  function makeRawEvent(overrides: Partial<TetragonKprobeEvent> = {}): TetragonKprobeEvent {
    return {
      process: {
        pid: 1234,
        binary: '/usr/bin/cat',
        uid: 1000,
        pod: {
          name: 'pod-target-1',
          namespace: 'production',
        },
      },
      args: {
        file_arg: '/var/run/secrets/kubernetes.io/serviceaccount/decoy-token-pod-1',
      },
      function_name: 'fd_install',
      action: 'KPROBE_ACTION_POST',
      time: '2024-01-15T10:00:00.123Z',
      ...overrides,
    };
  }

  it('should transform a Tetragon event into an AccessEvent', () => {
    const raw = makeRawEvent();
    const event = transformTetragonEvent(raw);

    expect(event.eventId).toBeTruthy();
    expect(event.processId).toBe(1234);
    expect(event.processBinaryPath).toBe('/usr/bin/cat');
    expect(event.userId).toBe(1000);
    expect(event.podId).toBe('pod-target-1');
    expect(event.namespace).toBe('production');
    expect(event.honeytokenPath).toBe('/var/run/secrets/kubernetes.io/serviceaccount/decoy-token-pod-1');
    expect(event.accessType).toBe('open');
    expect(event.timestamp).toBe('2024-01-15T10:00:00.123Z');
  });

  it('should map fd_install to "open" access type', () => {
    const event = transformTetragonEvent(makeRawEvent({ function_name: 'fd_install' }));
    expect(event.accessType).toBe('open');
  });

  it('should map sys_read to "read" access type', () => {
    const event = transformTetragonEvent(makeRawEvent({ function_name: 'sys_read' }));
    expect(event.accessType).toBe('read');
  });

  it('should map sys_write to "write" access type', () => {
    const event = transformTetragonEvent(makeRawEvent({ function_name: 'sys_write' }));
    expect(event.accessType).toBe('write');
  });

  it('should map sys_newstat to "stat" access type', () => {
    const event = transformTetragonEvent(makeRawEvent({ function_name: 'sys_newstat' }));
    expect(event.accessType).toBe('stat');
  });

  it('should use string_arg when file_arg is not present', () => {
    const event = transformTetragonEvent(makeRawEvent({
      args: { string_arg: '/etc/secrets/decoy-key' },
    }));
    expect(event.honeytokenPath).toBe('/etc/secrets/decoy-key');
  });

  it('should generate unique event IDs', () => {
    const raw = makeRawEvent();
    const event1 = transformTetragonEvent(raw);
    const event2 = transformTetragonEvent(raw);
    expect(event1.eventId).not.toBe(event2.eventId);
  });

  it('should produce a valid ISO 8601 timestamp', () => {
    const event = transformTetragonEvent(makeRawEvent());
    const parsed = new Date(event.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

describe('createTetragonEventClient', () => {
  it('should start in disconnected state', () => {
    const client = createTetragonEventClient();
    expect(client.isConnected()).toBe(false);
  });

  it('should connect in simulation mode when no gRPC function provided', async () => {
    const client = createTetragonEventClient();
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });

  it('should disconnect cleanly', async () => {
    const client = createTetragonEventClient();
    await client.connect();
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('should invoke callbacks when events are received via gRPC stream', async () => {
    let dataCallback: ((event: TetragonKprobeEvent) => void) | null = null;

    const mockStream: TetragonGrpcStream = {
      onData: (cb) => { dataCallback = cb; },
      onError: vi.fn(),
      onEnd: vi.fn(),
      cancel: vi.fn(),
    };

    const mockGrpcConnect = vi.fn().mockReturnValue(mockStream);
    const client = createTetragonEventClient({}, mockGrpcConnect);

    const receivedEvents: any[] = [];
    client.onEvent((event) => receivedEvents.push(event));

    await client.connect();

    // Simulate receiving an event
    dataCallback!({
      process: { pid: 42, binary: '/bin/sh', uid: 0, pod: { name: 'pod-x', namespace: 'ns-y' } },
      args: { file_arg: '/tmp/.config/credentials-pod-x.json' },
      function_name: 'fd_install',
      action: 'KPROBE_ACTION_POST',
      time: '2024-06-01T12:00:00.000Z',
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].podId).toBe('pod-x');
    expect(receivedEvents[0].namespace).toBe('ns-y');
    expect(receivedEvents[0].honeytokenPath).toBe('/tmp/.config/credentials-pod-x.json');
    expect(receivedEvents[0].accessType).toBe('open');
  });

  it('should support multiple event callbacks', async () => {
    let dataCallback: ((event: TetragonKprobeEvent) => void) | null = null;

    const mockStream: TetragonGrpcStream = {
      onData: (cb) => { dataCallback = cb; },
      onError: vi.fn(),
      onEnd: vi.fn(),
      cancel: vi.fn(),
    };

    const client = createTetragonEventClient({}, vi.fn().mockReturnValue(mockStream));

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    client.onEvent(cb1);
    client.onEvent(cb2);

    await client.connect();

    dataCallback!({
      process: { pid: 1, binary: '/bin/ls', uid: 0, pod: { name: 'p', namespace: 'n' } },
      args: { file_arg: '/path' },
      function_name: 'sys_read',
      action: 'KPROBE_ACTION_POST',
      time: '2024-01-01T00:00:00.000Z',
    });

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('should not crash if a callback throws', async () => {
    let dataCallback: ((event: TetragonKprobeEvent) => void) | null = null;

    const mockStream: TetragonGrpcStream = {
      onData: (cb) => { dataCallback = cb; },
      onError: vi.fn(),
      onEnd: vi.fn(),
      cancel: vi.fn(),
    };

    const client = createTetragonEventClient({}, vi.fn().mockReturnValue(mockStream));

    client.onEvent(() => { throw new Error('callback error'); });
    const cb2 = vi.fn();
    client.onEvent(cb2);

    await client.connect();

    // Should not throw
    dataCallback!({
      process: { pid: 1, binary: '/bin/ls', uid: 0, pod: { name: 'p', namespace: 'n' } },
      args: { file_arg: '/path' },
      function_name: 'sys_read',
      action: 'KPROBE_ACTION_POST',
      time: '2024-01-01T00:00:00.000Z',
    });

    // Second callback should still be called
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
