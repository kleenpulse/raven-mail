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

/**
 * A rejected key, a rate limit or an outage shouldn't drop a keyed user to
 * keyword rules: Kage answers the same questions instead. Aborts still abort.
 */
export function withKageFallback(client: DecisionClient): DecisionClient {
  return {
    async systemOne(request, options) {
      try {
        return await client.systemOne(request, options);
      } catch (err) {
        if (options?.signal?.aborted || !kageEnabled()) throw err;
        return decide(request);
      }
    },
  };
}

/** Which engine produced a result: Kage stamps its own model name. */
export function answeredBy(result: { model?: string }): "kage" | "jev" {
  return result.model?.startsWith("kage") ? "kage" : "jev";
}
