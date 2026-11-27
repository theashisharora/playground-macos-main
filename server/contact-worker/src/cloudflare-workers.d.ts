// Minimal ambient types for the Workers runtime modules, so this project needs
// no @cloudflare/workers-types dependency. Only what this Worker uses.
declare module "cloudflare:sockets" {
  interface SocketAddress {
    hostname: string;
    port: number;
  }
  interface SocketOptions {
    secureTransport?: "off" | "on" | "starttls";
    allowHalfOpen?: boolean;
  }
  interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<unknown>;
    closed: Promise<void>;
    close(): Promise<void>;
  }
  export function connect(
    address: SocketAddress | string,
    options?: SocketOptions
  ): Socket;
}

declare module "cloudflare:workers" {
  interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAll(): Promise<void>;
  }
  interface DurableObjectState {
    storage: DurableObjectStorage;
  }
  export class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
