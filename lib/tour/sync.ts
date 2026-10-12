import { isNewer, tourStateSchema, type TourState } from "./types";

/*
 * Pure halves of the tour sync, kept apart from the store so they test
 * without a DOM. The device blob is the source of truth; the Neon row is a
 * replica reconciled by last-write-wins on `updatedAt`.
 */

export const TOUR_STORAGE_KEY = "raven-tour:v1";

type Blob = { owner: string; state: TourState };

/** The saved state, only if it belongs to `owner` — a shared device never leaks one mailbox's tour into another. */
export function parseBlob(raw: string | null, owner: string): TourState | null {
	if (!raw) return null;
	try {
		const blob = JSON.parse(raw) as Partial<Blob>;
		if (blob?.owner !== owner) return null;
		const parsed = tourStateSchema.safeParse(blob.state);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function serializeBlob(owner: string, state: TourState): string {
	return JSON.stringify({ owner, state } satisfies Blob);
}

export type Reconcile = { kind: "adopt"; state: TourState } | { kind: "push" } | { kind: "none" };

/** What to do after reading the replica: take its newer state, send ours up, or nothing. */
export function reconcile(local: TourState, remote: TourState | null): Reconcile {
	if (!remote) return local.updatedAt ? { kind: "push" } : { kind: "none" };
	if (isNewer(remote.updatedAt, local.updatedAt)) return { kind: "adopt", state: remote };
	if (isNewer(local.updatedAt, remote.updatedAt)) return { kind: "push" };
	return { kind: "none" };
}

export function stamp(state: TourState, patch: Partial<Omit<TourState, "updatedAt">>, now = new Date()): TourState {
	return { ...state, ...patch, updatedAt: now.toISOString() };
}
