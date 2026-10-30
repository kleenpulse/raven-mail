import { describe, expect, test } from "bun:test";
import { regressions, runKageEval, type KageBaseline } from "@/lib/dev/kage-eval";
import { ece, wilson } from "@/lib/dev/kage-stats";
import baseline from "@/test/fixtures/kage/baseline.json";

/*
 * The gate on Kage's accuracy. A change that drops a dev or holdout metric
 * past the margin fails here; if the drop is a fair trade, re-pin with
 * `bun run eval:kage --write-baseline` and say why in the commit.
 */
describe("Kage eval gate", () => {
	test("dev and holdout hold their baseline", async () => {
		const report = await runKageEval();
		expect(report.jev.status).toBe("missing");
		expect(regressions(report, baseline as KageBaseline)).toEqual([]);
		// And it closes: a baseline a little better than today fails on exactly those metrics.
		const pinned = structuredClone(baseline) as KageBaseline;
		pinned.metrics.holdout.urgencyMae = report.metrics.holdout.kage!.urgencyMae - 0.05;
		const intent = report.metrics.dev.kage!.intent;
		pinned.metrics.dev.intent = { hits: intent.total, total: intent.total };
		expect(regressions(report, pinned)).toEqual([
			expect.stringContaining("dev intent:"),
			expect.stringContaining("holdout urgencyMae:"),
		]);
	}, 60_000);

	test("blind cases stay out of the report unless asked for", async () => {
		const report = await runKageEval();
		expect(report.blindHidden).toBe(true);
		expect(report.cases.some((c) => c.split === "blind")).toBe(false);
		expect(report.metrics.blind.kage?.intent.total).toBeGreaterThan(0);
	}, 60_000);
});

describe("kage-stats", () => {
	test("wilson brackets the observed rate", () => {
		const [lo, hi] = wilson({ hits: 17, total: 20 })!;
		expect(lo).toBeCloseTo(0.64, 2);
		expect(hi).toBeCloseTo(0.948, 2);
		expect(wilson({ hits: 0, total: 0 })).toBeNull();
	});

	test("ece is 0 when confidence matches accuracy and grows when it doesn't", () => {
		const honest = [true, true, true, false].map((ok) => ({ confidence: 0.75, ok }));
		expect(ece(honest)).toBeCloseTo(0, 5);
		expect(ece([{ confidence: 0.9, ok: false }])).toBeCloseTo(0.9, 5);
	});
});
