import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { clipHash } from "@/lib/tour/clip-hash";
import { TOUR_VOICES } from "@/lib/tour/types";
import { TOUR_TARGET, tourSelector } from "./anchors";
import { TOUR_AUDIO } from "./tour-audio.manifest";
import { TOUR_STEPS } from "./tour.config";

const PROVIDER = { us: "elevenlabs", gb: "mistral" } as const;

describe("tour narration manifest", () => {
	for (const voice of TOUR_VOICES) {
		test(`${voice}: every narrated step has a clip for its current copy`, () => {
			for (const step of TOUR_STEPS.filter((s) => s.tts)) {
				const entry = TOUR_AUDIO[voice][step.id];
				// A miss here means step copy changed without `bun run tour:audio`.
				expect(entry, `${voice}/${step.id}`).toBeDefined();
				expect(entry!.hash, `${voice}/${step.id} is stale — run bun run tour:audio`).toBe(clipHash(voice, step.body));
				expect(entry!.provider).toBe(PROVIDER[voice]);
				expect(existsSync(path.join(process.cwd(), "public", entry!.file))).toBe(true);
			}
		});
	}
});

describe("tour steps", () => {
	test("ids are unique", () => {
		const ids = TOUR_STEPS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("selectors only use minted anchors", () => {
		const minted = new Set(Object.values(TOUR_TARGET).map(tourSelector));
		for (const step of TOUR_STEPS) if (step.selector) expect(minted.has(step.selector)).toBe(true);
	});

	test("the accent picker opens the tour", () => {
		expect(TOUR_STEPS[0]!.voicePicker).toBe(true);
	});
});
