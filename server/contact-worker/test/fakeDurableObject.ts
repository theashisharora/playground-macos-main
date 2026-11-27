// Test double for the ContactRateLimiter Durable Object namespace.
// Mirrors the two platform guarantees the limiter relies on:
//   1. one object (and one storage) per id, shared by every caller/isolate;
//   2. calls into a single object run one at a time.
import {
  claimMessageCheck,
  finishMessageCheck,
  slidingWindowCheck,
  type LedgerResult,
  type RateLimiterNamespace
} from "../src/guards.ts";

export class FakeStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  writes = 0;
  async get<T>(key: string): Promise<T | undefined> {
    await Promise.resolve(); // async like the real thing, so races would show up
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    await Promise.resolve();
    this.writes++;
    this.data.set(key, structuredClone(value));
  }
  async setAlarm(t: number): Promise<void> {
    this.alarm = t;
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
    this.alarm = null;
  }
}

export function createFakeRateLimiterNamespace(clock: () => number = Date.now) {
  const objects = new Map<string, { storage: FakeStorage; queue: Promise<unknown> }>();
  let fail = false;
  let calls = 0;

  const ns: RateLimiterNamespace & {
    objects: typeof objects;
    calls: () => number;
    setFail: (v: boolean) => void;
    runDueAlarms: () => Promise<void>;
  } = {
    objects,
    calls: () => calls,
    setFail: (v) => {
      fail = v;
    },
    idFromName: (name: string) => `id:${name}`,
    get(id: unknown) {
      const key = String(id);
      // Runs `fn` against this object's storage, one call at a time.
      const serial = <T>(fn: (s: FakeStorage) => Promise<T>): Promise<T> => {
        calls++;
        if (fail) return Promise.reject(new Error("Durable Object unavailable"));
        let obj = objects.get(key);
        if (!obj) {
          obj = { storage: new FakeStorage(), queue: Promise.resolve() };
          objects.set(key, obj);
        }
        const o = obj;
        const run = o.queue.then(() => fn(o.storage));
        o.queue = run.catch(() => {});
        return run;
      };
      return {
        check: (max: number, windowMs: number) =>
          serial((s) => slidingWindowCheck(s, max, windowMs, clock())),
        claimMessage: (ttl: number) => serial((s) => claimMessageCheck(s, clock(), ttl)),
        finishMessage: (result: LedgerResult | boolean) =>
          serial((s) => finishMessageCheck(s, result, clock()))
      };
    },
    // Simulates ContactRateLimiter.alarm() firing for objects whose alarm is due.
    async runDueAlarms() {
      for (const { storage } of objects.values())
        if (storage.alarm !== null && storage.alarm <= clock()) await storage.deleteAll();
    }
  };
  return ns;
}
