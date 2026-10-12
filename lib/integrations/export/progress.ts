/*
 * Export progress, computed from the plan rather than the wire: the bar moves by
 * each finished chunk's *planned* bytes, so it only ever goes up and lands on
 * exactly 100%. Rate and ETA come from bytes actually received.
 */

export type ExportProgress = {
	total: number;
	totalBytes: number;
	chunks: number;
	chunksDone: number;
	done: number;
	doneBytes: number;
	receivedBytes: number;
	missing: number;
	/** Wall-clock ms spent transferring (pauses excluded). */
	activeMs: number;
	rateBps: number | null;
	etaMs: number | null;
};

export function startProgress(plan: { total: number; bytes: number; chunks: number }): ExportProgress {
	return {
		total: plan.total,
		totalBytes: plan.bytes,
		chunks: plan.chunks,
		chunksDone: 0,
		done: 0,
		doneBytes: 0,
		receivedBytes: 0,
		missing: 0,
		activeMs: 0,
		rateBps: null,
		etaMs: null,
	};
}

export function advance(
	p: ExportProgress,
	chunk: { plannedBytes: number; plannedCount: number; count: number; receivedBytes: number; missing: number; ms: number },
): ExportProgress {
	const receivedBytes = p.receivedBytes + chunk.receivedBytes;
	const activeMs = p.activeMs + Math.max(0, chunk.ms);
	const doneBytes = Math.min(p.totalBytes, p.doneBytes + chunk.plannedBytes);
	const rateBps = activeMs > 0 ? (receivedBytes / activeMs) * 1000 : null;
	const remaining = Math.max(0, p.totalBytes - doneBytes);
	return {
		...p,
		chunksDone: p.chunksDone + 1,
		done: p.done + chunk.count,
		doneBytes,
		receivedBytes,
		missing: p.missing + chunk.missing,
		activeMs,
		rateBps,
		etaMs: rateBps && rateBps > 0 ? Math.round((remaining / rateBps) * 1000) : null,
	};
}

/** 0–100, monotonic; exactly 100 once every chunk is in. */
export function percent(p: ExportProgress): number {
	if (p.chunks > 0 && p.chunksDone >= p.chunks) return 100;
	if (p.totalBytes <= 0) return p.chunks > 0 ? Math.round((p.chunksDone / p.chunks) * 100) : 0;
	return Math.min(99, Math.floor((p.doneBytes / p.totalBytes) * 100));
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatEta(ms: number | null): string | null {
	if (ms === null) return null;
	const s = Math.max(1, Math.round(ms / 1000));
	if (s < 60) return `${s}s left`;
	const m = Math.round(s / 60);
	return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
}
