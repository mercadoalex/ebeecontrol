/**
 * Tetragon gRPC Client — Connects to the Tetragon agent to receive
 * real-time eBPF events when honeytoken files are accessed.
 *
 * This client:
 * 1. Connects to the Tetragon gRPC server (localhost:54321 by default)
 * 2. Subscribes to kprobe events matching honeytoken file paths
 * 3. Transforms Tetragon events into eBeeControl AccessEvent objects
 * 4. Forwards events to the agent's event processing pipeline
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import { AccessEvent } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Raw event received from Tetragon's gRPC stream.
 * This represents the structure of a kprobe event from Tetragon.
 */
export interface TetragonKprobeEvent {
  process: {
    pid: number;
    binary: string;
    uid: number;
    pod: {
      name: string;
      namespace: string;
    };
  };
  args: {
    file_arg?: string;
    string_arg?: string;
  };
  function_name: string;
  action: string;
  time: string; // RFC3339 timestamp
}

/**
 * Configuration for the Tetragon client.
 */
export interface TetragonClientConfig {
  /** gRPC server address (default: localhost:54321) */
  grpcAddress: string;
  /** Reconnect interval in milliseconds (default: 5000) */
  reconnectIntervalMs: number;
  /** Maximum reconnect attempts (default: unlimited = -1) */
  maxReconnectAttempts: number;
}

const DEFAULT_CONFIG: TetragonClientConfig = {
  grpcAddress: 'localhost:54321',
  reconnectIntervalMs: 5000,
  maxReconnectAttempts: -1,
};

/**
 * Maps a Tetragon function name to an eBeeControl access type.
 */
function mapFunctionToAccessType(functionName: string): AccessEvent['accessType'] {
  if (functionName.includes('fd_install') || functionName.includes('sys_open')) {
    return 'open';
  }
  if (functionName.includes('sys_read') || functionName.includes('vfs_read')) {
    return 'read';
  }
  if (functionName.includes('sys_write') || functionName.includes('vfs_write')) {
    return 'write';
  }
  if (functionName.includes('sys_newstat') || functionName.includes('stat')) {
    return 'stat';
  }
  return 'read'; // default fallback
}

/**
 * Extracts the file path from a Tetragon kprobe event.
 */
function extractFilePath(event: TetragonKprobeEvent): string {
  return event.args.file_arg || event.args.string_arg || 'unknown';
}

/**
 * Transforms a raw Tetragon kprobe event into an eBeeControl AccessEvent.
 */
export function transformTetragonEvent(event: TetragonKprobeEvent): AccessEvent {
  return {
    eventId: uuidv4(),
    processId: event.process.pid,
    processBinaryPath: event.process.binary,
    userId: event.process.uid,
    podId: event.process.pod.name,
    namespace: event.process.pod.namespace,
    honeytokenPath: extractFilePath(event),
    accessType: mapFunctionToAccessType(event.function_name),
    timestamp: new Date(event.time).toISOString(),
  };
}

/**
 * Interface for the Tetragon event stream client.
 */
export interface TetragonEventClient {
  /** Start listening for events */
  connect(): Promise<void>;
  /** Stop listening and disconnect */
  disconnect(): Promise<void>;
  /** Register a callback for access events */
  onEvent(callback: (event: AccessEvent) => void): void;
  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Creates a Tetragon event client that connects to the Tetragon gRPC server
 * and streams kprobe events as AccessEvent objects.
 *
 * In production, this uses the @grpc/grpc-js library to connect to Tetragon.
 * For now, it provides the interface and event transformation logic.
 * The actual gRPC connection will be wired when deploying with Tetragon.
 *
 * @param config - Client configuration
 * @param grpcConnect - Injected gRPC connection function (for testing)
 */
export function createTetragonEventClient(
  config: Partial<TetragonClientConfig> = {},
  grpcConnect?: (address: string) => TetragonGrpcStream
): TetragonEventClient {
  const resolvedConfig: TetragonClientConfig = { ...DEFAULT_CONFIG, ...config };
  const callbacks: Array<(event: AccessEvent) => void> = [];
  let connected = false;
  let stream: TetragonGrpcStream | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function handleRawEvent(rawEvent: TetragonKprobeEvent): void {
    const accessEvent = transformTetragonEvent(rawEvent);
    for (const callback of callbacks) {
      try {
        callback(accessEvent);
      } catch (error) {
        // Don't let callback errors crash the stream
        console.error('[TetragonClient] Callback error:', error);
      }
    }
  }

  async function connect(): Promise<void> {
    if (connected) return;

    if (grpcConnect) {
      stream = grpcConnect(resolvedConfig.grpcAddress);
      stream.onData(handleRawEvent);
      stream.onError((error) => {
        console.error('[TetragonClient] Stream error:', error.message);
        connected = false;
        scheduleReconnect();
      });
      stream.onEnd(() => {
        connected = false;
        scheduleReconnect();
      });
      connected = true;
      console.log(`[TetragonClient] Connected to Tetragon at ${resolvedConfig.grpcAddress}`);
    } else {
      // No gRPC connection provided — running in simulation mode
      connected = true;
      console.log('[TetragonClient] Running in simulation mode (no gRPC connection)');
    }
  }

  async function disconnect(): Promise<void> {
    connected = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (stream) {
      stream.cancel();
      stream = null;
    }
    console.log('[TetragonClient] Disconnected');
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      console.log('[TetragonClient] Attempting reconnect...');
      try {
        await connect();
      } catch (error) {
        console.error('[TetragonClient] Reconnect failed:', error);
        scheduleReconnect();
      }
    }, resolvedConfig.reconnectIntervalMs);
  }

  return {
    connect,
    disconnect,
    onEvent(callback: (event: AccessEvent) => void): void {
      callbacks.push(callback);
    },
    isConnected(): boolean {
      return connected;
    },
  };
}

/**
 * Interface for the gRPC stream (abstracted for dependency injection).
 * In production, this wraps a @grpc/grpc-js ClientReadableStream.
 */
export interface TetragonGrpcStream {
  onData(callback: (event: TetragonKprobeEvent) => void): void;
  onError(callback: (error: Error) => void): void;
  onEnd(callback: () => void): void;
  cancel(): void;
}
