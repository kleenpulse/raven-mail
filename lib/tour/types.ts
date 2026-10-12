import { z } from "zod";

/*
 * The welcome tour's durable record: progress plus the narration accent. One
 * shape on the wire, in localStorage and in the `tour_progress` row. Isomorphic
 * — the API route, the client store and the audio script all import it.
 */

export const TOUR_VOICES = ["us", "gb"] as const;
export type TourVoice = (typeof TOUR_VOICES)[number];

export const VOICE_LABELS: Record<TourVoice, string> = { us: "American", gb: "British" };

export const tourStateSchema = z
	.object({
		completed: z.boolean(),
		skipped: z.boolean(),
		lastStep: z.number().int().min(0).max(50),
		voice: z.enum(TOUR_VOICES),
		/** ISO time of the last local change; null = never touched. Last write wins. */
		updatedAt: z.iso.datetime().nullable(),
	})
	.strict();

export type TourState = z.infer<typeof tourStateSchema>;

export const DEFAULT_TOUR_STATE: TourState = {
	completed: false,
	skipped: false,
	lastStep: 0,
	voice: "us",
	updatedAt: null,
};

/** ISO strings compare lexicographically; null loses to any stamp. */
export function isNewer(a: string | null, b: string | null): boolean {
	if (!a) return false;
	if (!b) return true;
	return a > b;
}

/** GET /api/tour. `db: false` = no database configured; the device copy is the only copy. */
export type TourResponse = { ok: true; data: TourState | null; db: boolean };
