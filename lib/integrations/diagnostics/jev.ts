import "server-only";
import {
	APIConnectionError,
	APITimeoutError,
	AuthenticationError,
	InternalServerError,
	NotFoundError,
	PermissionDeniedError,
	RateLimitError,
	type ModelCard,
} from "@typesafe-ai/sdk";
import { typesafeFor } from "@/lib/jev/client";
import type { MailSession } from "@/lib/session";
import { IntegrationError } from "../errors";
import { warn, type Step } from "../steps";

const LATEST = "jev-latest";

export function pinnedModel(): string {
	return process.env.TYPESAFE_DEFAULT_MODEL?.trim() || LATEST;
}

/** SDK failures → catalog. Jev elsewhere falls back silently; here we say why. */
export function classifyJevError(err: unknown): IntegrationError {
	if (err instanceof IntegrationError) return err;
	if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
		return new IntegrationError("jev_key_rejected", { cause: err });
	}
	if (err instanceof RateLimitError) return new IntegrationError("jev_rate_limited", { retryAfterMs: err.retryAfterMs, cause: err });
	if (err instanceof APITimeoutError) return new IntegrationError("jev_timeout", { cause: err });
	if (err instanceof APIConnectionError) return new IntegrationError("jev_unreachable", { cause: err });
	if (err instanceof NotFoundError) return new IntegrationError("jev_model_missing", { cause: err });
	if (err instanceof InternalServerError) {
		return new IntegrationError("upstream_error", { message: "Jev had an internal error.", cause: err });
	}
	return new IntegrationError("internal", { cause: err });
}

type Ctx = { models?: ModelCard[] };

/**
 * Free checks only: listing models proves the key and the network path; a
 * paid decision call would add nothing the list doesn't already show.
 */
export function jevDiagnostics(session: MailSession): { steps: Step<Ctx>[]; ctx: Ctx } {
	const model = pinnedModel();
	const jev = typesafeFor(session);
	return {
		ctx: {},
		steps: [
			{
				id: "key",
				label: "API key",
				run: async () => {
					if (!jev) throw new IntegrationError("jev_no_key");
					return jev.source === "user" ? "Using your own key" : "Using the server's key (TYPESAFE_API_KEY)";
				},
			},
			{
				id: "reach",
				label: "Reach Jev",
				run: async (ctx, signal) => {
					try {
						ctx.models = await jev!.client.models.list({ signal, timeout: 5_000, retry: { maxRetries: 0 } });
					} catch (err) {
						throw classifyJevError(err);
					}
					return `Key accepted · ${ctx.models.length} ${ctx.models.length === 1 ? "model" : "models"} available`;
				},
			},
			{
				id: "model",
				label: "Model",
				run: async (ctx) => {
					const models = ctx.models ?? [];
					if (model !== LATEST) {
						if (!models.some((m) => m.name === model)) {
							throw new IntegrationError("jev_model_missing", { message: `${model} isn't available to this key.` });
						}
						return `Pinned to ${model}`;
					}
					const newest = [...models].sort((a, b) => b.release_date.localeCompare(a.release_date))[0]?.name;
					if (process.env.NODE_ENV === "production") {
						return warn(`Following ${LATEST}${newest ? ` (${newest})` : ""} — pin TYPESAFE_DEFAULT_MODEL so answers don't shift`);
					}
					return `Following ${LATEST}${newest ? ` · newest is ${newest}` : ""}`;
				},
			},
		],
	};
}
