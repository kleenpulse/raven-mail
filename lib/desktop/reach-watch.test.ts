import { describe, expect, test } from "bun:test";
import { createReachWatch, RECHECK_MS, type Timers } from "./reach-watch";

/** Timers you fire by hand, and a probe that answers from a script. */
function harness(answers: (boolean | null)[]) {
	const pending = new Map<number, () => void>();
	let next = 1;
	const delays: number[] = [];
	const timers: Timers = {
		set(run, ms) {
			delays.push(ms);
			pending.set(next, run);
			return next++;
		},
		clear: (id) => void pending.delete(id as number),
	};
	let probes = 0;
	const watch = createReachWatch(async () => {
		probes++;
		return answers.shift() ?? null;
	}, timers);
	const fire = async () => {
		const runs = [...pending.values()];
		pending.clear();
		for (const run of runs) run();
		await Bun.sleep(0);
	};
	return { watch, fire, pending, delays, probes: () => probes };
}

const settle = () => Bun.sleep(0);

describe("createReachWatch", () => {
	test("starts online and doesn't probe on its own", async () => {
		const h = harness([]);
		await settle();
		expect(h.watch.get()).toBe(false);
		expect(h.probes()).toBe(0);
	});

	test("an unreachable mail request goes offline only if the probe agrees", async () => {
		const h = harness([true]);
		h.watch.mailUnreachable();
		await settle();
		expect(h.watch.get()).toBe(false);
		expect(h.pending.size).toBe(0);

		const g = harness([false]);
		g.watch.mailUnreachable();
		await settle();
		expect(g.watch.get()).toBe(true);
		expect(g.delays).toEqual([RECHECK_MS]);
	});

	test("the window's offline event goes offline at once, then rechecks until the server answers", async () => {
		const h = harness([false, null, true]);
		const seen: boolean[] = [];
		h.watch.subscribe(() => seen.push(h.watch.get()));
		h.watch.browserOffline();
		expect(h.watch.get()).toBe(true);
		await h.fire(); // false: still offline
		expect(h.watch.get()).toBe(true);
		await h.fire(); // null: can't tell, stay offline
		expect(h.watch.get()).toBe(true);
		await h.fire(); // true: back
		expect(h.watch.get()).toBe(false);
		expect(h.pending.size).toBe(0);
		expect(seen).toEqual([true, false]);
	});

	test("the online event checks at once and cancels the recheck", async () => {
		const h = harness([true]);
		h.watch.browserOffline();
		h.watch.browserOnline();
		await settle();
		expect(h.watch.get()).toBe(false);
		expect(h.pending.size).toBe(0);
	});

	test("an unanswered probe while online changes nothing", async () => {
		const h = harness([null]);
		h.watch.mailUnreachable();
		await settle();
		expect(h.watch.get()).toBe(false);
		expect(h.pending.size).toBe(0);
	});

	test("a probe that throws counts as can't tell", async () => {
		const watch = createReachWatch(async () => {
			throw new Error("down");
		});
		watch.mailUnreachable();
		await settle();
		expect(watch.get()).toBe(false);
	});

	test("one check at a time", async () => {
		const h = harness([false]);
		h.watch.mailUnreachable();
		h.watch.mailUnreachable();
		h.watch.mailUnreachable();
		await settle();
		expect(h.probes()).toBe(1);
	});

	test("stop cancels the recheck; unsubscribe stops updates", async () => {
		const h = harness([]);
		let calls = 0;
		const off = h.watch.subscribe(() => calls++);
		h.watch.browserOffline();
		off();
		h.watch.stop();
		expect(h.pending.size).toBe(0);
		expect(calls).toBe(1);
	});
});
