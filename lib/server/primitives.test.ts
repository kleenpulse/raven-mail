import { describe, expect, test } from "bun:test";
import { createTtlCache } from "@/lib/server/cache";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { createKeyedSemaphore } from "@/lib/server/semaphore";

describe("createTtlCache", () => {
	test("dedupes concurrent loads and serves fresh values", async () => {
		let t = 0;
		let calls = 0;
		const cache = createTtlCache<number>({ ttlMs: 100, now: () => t });
		const load = async () => ++calls;
		const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
		expect([a, b]).toEqual([1, 1]);
		expect(await cache.get("k", load)).toBe(1);
		t = 150;
		expect(await cache.get("k", load)).toBe(2);
		expect(calls).toBe(2);
	});

	test("failed loads are not cached", async () => {
		const cache = createTtlCache<number>({ ttlMs: 1000 });
		await expect(cache.get("k", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
		expect(await cache.get("k", async () => 7)).toBe(7);
	});

	test("evicts oldest beyond maxEntries", async () => {
		const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 2 });
		await cache.get("a", async () => "a");
		await cache.get("b", async () => "b");
		await cache.get("c", async () => "c");
		expect(cache.peek("a")).toBeUndefined();
		expect(cache.peek("c")).toBe("c");
	});
});

describe("createRateLimiter", () => {
	test("blocks past the limit until the window resets", () => {
		let t = 0;
		const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
		expect(limiter.take("s").ok).toBe(true);
		expect(limiter.take("s").ok).toBe(true);
		const blocked = limiter.take("s");
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) expect(blocked.retryAfterMs).toBe(1000);
		expect(limiter.take("other").ok).toBe(true);
		t = 1000;
		expect(limiter.take("s").ok).toBe(true);
	});
});

describe("createKeyedSemaphore", () => {
	test("caps concurrency per key", async () => {
		const sem = createKeyedSemaphore(2);
		let active = 0;
		let peak = 0;
		const task = () =>
			sem.run("mailbox", async () => {
				active += 1;
				peak = Math.max(peak, active);
				await new Promise((r) => setTimeout(r, 5));
				active -= 1;
			});
		await Promise.all([task(), task(), task(), task(), task()]);
		expect(peak).toBe(2);
	});

	test("release is idempotent", async () => {
		const sem = createKeyedSemaphore(1);
		const release = await sem.acquire("k");
		release();
		release();
		const again = await sem.acquire("k");
		again();
	});
});
