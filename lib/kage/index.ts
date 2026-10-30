import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { decide, KAGE_MODEL } from "@/lib/kage/engine";

export { KAGE_MODEL };

/** The slice of a TypeSafe client that callers use; Kage and Jev both fit it. */
export type DecisionClient = {
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: { signal?: AbortSignal },
  ): Promise<SystemOneResult<Q>>;
};

/** On unless the deployment sets KAGE=off (or false/0). */
export function kageEnabled(): boolean {
  const flag = process.env.KAGE?.trim().toLowerCase();
  return !(flag === "off" || flag === "false" || flag === "0");
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

export const kage: DecisionClient = {
  async systemOne(request, options) {
    if (options?.signal?.aborted) throw abortError();
    return decide(request);
  },
};

export type FallbackOptions = {
  /**
   * How long one call may wait for Jev, retries included, before Kage answers.
   * After one miss the same client skips Jev, so a request that asks twice
   * waits once. Without it, the client's own timeout and retries apply.
   */
  deadlineMs?: number;
  /** Called when Kage answers for a failed Jev call; `timedOut` means the deadline hit. */
  onFallback?: (err: unknown, timedOut: boolean) => void;
};

/**
 * A rejected key, a rate limit or an outage shouldn't drop a keyed user to
 * keyword rules: Kage answers the same questions instead. Aborts still abort.
 */
export function withKageFallback(client: DecisionClient, { deadlineMs, onFallback }: FallbackOptions = {}): DecisionClient {
  let missed = false;
  return {
    async systemOne(request, options) {
      const caller = options?.signal;
      if (missed && kageEnabled()) {
        if (caller?.aborted) throw abortError();
        return decide(request);
      }
      const deadline = deadlineMs ? AbortSignal.timeout(deadlineMs) : null;
      const signal = deadline ? (caller ? AbortSignal.any([caller, deadline]) : deadline) : caller;
      try {
        return await client.systemOne(request, { ...options, signal });
      } catch (err) {
        if (caller?.aborted || !kageEnabled()) throw err;
        const timedOut = deadline?.aborted === true;
        if (timedOut) missed = true;
        onFallback?.(err, timedOut);
        return decide(request);
      }
    },
  };
}

/** Which engine produced a result: Kage stamps its own model name. */
export function answeredBy(result: { model?: string }): "kage" | "jev" {
  return result.model?.startsWith("kage") ? "kage" : "jev";
}
