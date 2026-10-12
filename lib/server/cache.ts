/**
 * In-process TTL cache with in-flight de-duplication.
 *
 * Deliberately behind a tiny interface: a single Node process is today's
 * deployment, but a shared store (Redis, KV) can implement the same shape.
 */
export interface AsyncCache<T> {
	get(key: string, load: () => Promise<T>): Promise<T>;
	peek(key: string): T | undefined;
	invalidate(key: string): void;
	clear(): void;
}

type Entry<T> = {
	value?: T;
	expiresAt: number;
	pending?: Promise<T>;
};

export function createTtlCache<T>({
	ttlMs,
	maxEntries = 50,
	now = Date.now,
}: {
	ttlMs: number;
	maxEntries?: number;
	now?: () => number;
}): AsyncCache<T> {
	const entries = new Map<string, Entry<T>>();

	function touch(key: string, entry: Entry<T>) {
		entries.delete(key);
		entries.set(key, entry);
		while (entries.size > maxEntries) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) break;
			entries.delete(oldest);
		}
	}

	return {
		get(key, load) {
			const existing = entries.get(key);
			if (existing?.pending) return existing.pending;
			if (existing && "value" in existing && existing.expiresAt > now()) {
				touch(key, existing);
				return Promise.resolve(existing.value as T);
			}

			const pending = load().then(
				(value) => {
					if (entries.get(key)?.pending === pending) {
						touch(key, { value, expiresAt: now() + ttlMs });
					}
					return value;
				},
				(err: unknown) => {
					if (entries.get(key)?.pending === pending) entries.delete(key);
					throw err;
				},
			);
			touch(key, { pending, expiresAt: Number.POSITIVE_INFINITY });
			return pending;
		},
		peek(key) {
			const entry = entries.get(key);
			if (!entry || entry.pending || entry.expiresAt <= now()) return undefined;
			return entry.value;
		},
		invalidate(key) {
			entries.delete(key);
		},
		clear() {
			entries.clear();
		},
	};
}
