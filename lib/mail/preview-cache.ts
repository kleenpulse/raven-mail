/**
 * Attachment bytes already fetched for a preview, so opening the same file again
 * (or stepping back to it in the gallery) doesn't download it again, and a click
 * joins a download already running for the same file. Memory only: a reload starts
 * empty, and sign-out empties it. Oldest files go first once the total passes the budget.
 */

/** A few large photos, or one video at the preview limit plus some images. */
export const PREVIEW_CACHE_BYTES = 64 * 1024 * 1024;

const blobs = new Map<string, Blob>();
let total = 0;

export function recallPreview(key: string): Blob | undefined {
	const blob = blobs.get(key);
	if (!blob) return undefined;
	// Re-insert: Map order is the eviction order, so this marks it recently used.
	blobs.delete(key);
	blobs.set(key, blob);
	return blob;
}

export function rememberPreview(key: string, blob: Blob, budget = PREVIEW_CACHE_BYTES): void {
	const old = blobs.get(key);
	if (old) {
		total -= old.size;
		blobs.delete(key);
	}
	// Bigger than the whole budget: keeping it would push out everything else.
	if (blob.size > budget) return;
	blobs.set(key, blob);
	total += blob.size;
	for (const [oldest, b] of blobs) {
		if (total <= budget) break;
		blobs.delete(oldest);
		total -= b.size;
	}
}

type Pending = { promise: Promise<Blob>; controller: AbortController; waiters: number };
const pending = new Map<string, Pending>();

/**
 * The file under `key`: from memory, from a download already running for it (a hover
 * prefetch, say), or from `load`. A caller whose `signal` aborts stops waiting; the
 * download itself is cancelled only once nobody is waiting. With no `signal` the
 * caller waits to the end, so a prefetch is never cancelled by a viewer moving on.
 */
export function loadPreview(
	key: string,
	load: (signal: AbortSignal) => Promise<Blob>,
	signal?: AbortSignal,
): Promise<Blob> {
	const cached = recallPreview(key);
	if (cached) return Promise.resolve(cached);
	if (signal?.aborted) return Promise.reject(signal.reason);

	let entry = pending.get(key);
	if (!entry) {
		const controller = new AbortController();
		const started: Pending = { controller, waiters: 0, promise: load(controller.signal) };
		started.promise.then(
			(blob) => {
				// Forgotten mid-flight (sign-out): the bytes must not land after the clear.
				if (pending.get(key) !== started) return;
				pending.delete(key);
				rememberPreview(key, blob);
			},
			() => {
				if (pending.get(key) === started) pending.delete(key);
			},
		);
		pending.set(key, started);
		entry = started;
	}

	const shared = entry;
	shared.waiters += 1;
	if (!signal) return shared.promise;
	return new Promise<Blob>((resolve, reject) => {
		const leave = () => {
			shared.waiters -= 1;
			if (shared.waiters === 0 && pending.get(key) === shared) {
				pending.delete(key);
				shared.controller.abort();
			}
			reject(signal.reason);
		};
		signal.addEventListener("abort", leave, { once: true });
		shared.promise.then(
			(blob) => {
				signal.removeEventListener("abort", leave);
				resolve(blob);
			},
			(err) => {
				signal.removeEventListener("abort", leave);
				reject(err);
			},
		);
	});
}

/** Sign-out, and tests. Downloads still running are cancelled. */
export function forgetPreviews(): void {
	blobs.clear();
	total = 0;
	for (const { controller } of pending.values()) controller.abort();
	pending.clear();
}
