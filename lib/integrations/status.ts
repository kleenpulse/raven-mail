import type { IntegrationError } from "./errors";
import type { ConnectionStatus } from "./types";

/** Consecutive transient failures before a connection is flagged for attention. */
export const FAILURE_LIMIT = 5;

export type ConnectionHealth = { status: ConnectionStatus; failureStreak: number };

/**
 * The connection status machine. Success heals; a failure only the user can fix
 * (revoked, archived, auth…) flags it at once; transient failures flag it after
 * a streak; our own bad payloads don't count against the user's webhook.
 */
export function nextHealth(prev: ConnectionHealth, outcome: { ok: true } | { ok: false; error: IntegrationError }): ConnectionHealth {
	if (prev.status === "paused") return prev;
	if (outcome.ok) return { status: "active", failureStreak: 0 };

	const { error } = outcome;
	// Our own bad payloads, and sends that may have landed, say nothing about the webhook.
	if (error.code === "payload_rejected" || error.code === "internal" || error.code === "unconfirmed") return prev;

	const failureStreak = prev.failureStreak + 1;
	if (error.attention || failureStreak >= FAILURE_LIMIT) return { status: "error", failureStreak };
	return { status: prev.status, failureStreak };
}
