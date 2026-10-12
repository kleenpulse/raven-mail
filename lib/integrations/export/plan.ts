import { compressUids } from "./uid-set";

export type ExportChunk = { uids: string; count: number; bytes: number };

export const CHUNK_MAX_COUNT = 100;
export const CHUNK_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Splits a folder into requests small enough to fetch, encode and send well
 * inside one function timeout. A message bigger than the byte cap rides alone.
 */
export function planChunks(
	messages: readonly { uid: number; size: number }[],
	{ maxCount = CHUNK_MAX_COUNT, maxBytes = CHUNK_MAX_BYTES }: { maxCount?: number; maxBytes?: number } = {},
): ExportChunk[] {
	const sorted = [...messages].sort((a, b) => a.uid - b.uid);
	const chunks: ExportChunk[] = [];
	let uids: number[] = [];
	let bytes = 0;

	const flush = () => {
		if (uids.length === 0) return;
		chunks.push({ uids: compressUids(uids), count: uids.length, bytes });
		uids = [];
		bytes = 0;
	};

	for (const { uid, size } of sorted) {
		const weight = Math.max(0, size);
		if (uids.length > 0 && (uids.length >= maxCount || bytes + weight > maxBytes)) flush();
		uids.push(uid);
		bytes += weight;
	}
	flush();
	return chunks;
}
