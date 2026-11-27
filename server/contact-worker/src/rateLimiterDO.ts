import { DurableObject } from "cloudflare:workers";
import {
  claimMessageCheck,
  finishMessageCheck,
  slidingWindowCheck,
  type ClaimState,
  type LedgerResult,
  type WindowDecision
} from "./guards.ts";

/**
 * One instance per key: a visitor IP (rate limit) or a message id (duplicate
 * guard). Durable Objects are single-threaded and globally unique per id, so
 * state is consistent across every Worker instance and Cloudflare location.
 * All logic lives in guards.ts (unit-tested in Node); this class only wires it
 * to storage.
 */
export class ContactRateLimiter extends DurableObject {
  async check(max: number, windowMs: number): Promise<WindowDecision> {
    return slidingWindowCheck(this.ctx.storage, max, windowMs, Date.now());
  }

  async claimMessage(inflightTtlMs: number): Promise<ClaimState> {
    return claimMessageCheck(this.ctx.storage, Date.now(), inflightTtlMs);
  }

  async finishMessage(result: LedgerResult | boolean): Promise<void> {
    return finishMessageCheck(this.ctx.storage, result, Date.now());
  }

  /** Fires once the key's window has passed: forget it. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/**
 * Same logic, separate class, so Ash AI usage lives in its own Durable
 * Object namespace and can never exhaust the contact form's limits.
 */
export class ChatRateLimiter extends ContactRateLimiter {}
