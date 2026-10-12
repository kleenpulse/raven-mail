import type { TourVoice } from "./types";

/** Bump to force full regeneration on a voice/model change even when step copy is untouched. */
export const AUDIO_VERSION = 1;

/** djb2-xor, base36 — same function rawstash uses. */
function djb2(text: string): string {
	let h = 5381;
	for (let i = 0; i < text.length; i++) {
		h = (((h << 5) + h) ^ text.charCodeAt(i)) & 0x7fffffff;
	}
	return h.toString(36);
}

/** A clip's identity: changes whenever its copy, accent or AUDIO_VERSION does. */
export function clipHash(voice: TourVoice, body: string): string {
	return djb2(`${AUDIO_VERSION}|${voice}|${body}`);
}
