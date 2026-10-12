import { describe, expect, test } from "bun:test";
import type { SenderStat } from "@/lib/insights/types";
import type { TriageCategory } from "@/lib/mail/types";
import { orbitEdgeCases, orbitFixtures } from "./fixtures";
import {
	CARD_H,
	CATEGORY_LABEL,
	categoryShares,
	WEEKS,
	activityTicks,
	combinedDaily,
	inSector,
	layoutFocus,
	layoutOrbit,
	sharePercents,
	stackRows,
	type Box,
	type OrbitLayout,
	type WeekIndex,
} from "./layout";
import { formatAgo, formatClock, formatDuration, formatUtcOffset, threadHref } from "./format";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const { senders, categories } = orbitFixtures(NOW);

const SIZES: [number, number][] = [
	[1290, 460],
	[1040, 460],
	[800, 440],
	[640, 420],
	[390, 390],
	[320, 320],
];
const MODES: (WeekIndex | null)[] = [null, ...WEEKS];

function sender(i: number, category: TriageCategory, count: number): SenderStat {
	const daily = Array.from({ length: 30 }, (_, d) => (d % 3 === i % 3 ? Math.ceil(count / 10) : 0));
	return {
		address: `s${i}@example.com`,
		name: `Sender ${i}`,
		domain: "example.com",
		category,
		bucket: i % 2 ? "people" : "notifications",
		count,
		unread: i % 4,
		sentToThem: 0,
		lastAt: new Date(NOW - i * 3_600_000).toISOString(),
		daily,
		weekly: [1, 2, 3, 4].map((w) => Math.round((count * w) / 12)),
		yourReplyMedianMin: null,
		theirReplyMedianMin: null,
		needsReply: 0,
		recent: [],
	};
}

const cats: TriageCategory[] = ["primary", "updates", "receipts", "promotions", "newsletters", "social", "other"];
const many = Array.from({ length: 24 }, (_, i) => sender(i, cats[i % cats.length]!, 60 - i * 2));
const manyCats = cats.map((category) => ({ category, count: 100 }));

function withinBounds(l: OrbitLayout) {
	const eps = 0.51;
	for (const s of l.senders) {
		expect(s.x - s.slotR).toBeGreaterThanOrEqual(-eps);
		expect(s.y - s.slotR).toBeGreaterThanOrEqual(-eps);
		expect(s.x + s.slotR).toBeLessThanOrEqual(l.width + eps);
		expect(s.y + s.slotR).toBeLessThanOrEqual(l.height + eps);
	}
	for (const c of l.categories) {
		expect(c.x - c.slotR).toBeGreaterThanOrEqual(-eps);
		expect(c.y - c.slotR).toBeGreaterThanOrEqual(-eps);
		expect(c.x + c.slotR).toBeLessThanOrEqual(l.width + eps);
		expect(c.y + c.slotR).toBeLessThanOrEqual(l.height + eps);
	}
	const boxes: Box[] = l.senders.flatMap((s) => [s.label.chip, s.label.name?.box].filter((b): b is Box => !!b));
	for (const b of boxes) {
		expect(b.x).toBeGreaterThanOrEqual(0);
		expect(b.y).toBeGreaterThanOrEqual(0);
		expect(b.x + b.w).toBeLessThanOrEqual(l.width);
		expect(b.y + b.h).toBeLessThanOrEqual(l.height);
	}
}

function noSenderOverlap(l: OrbitLayout) {
	for (let i = 0; i < l.senders.length; i++) {
		for (let j = i + 1; j < l.senders.length; j++) {
			const a = l.senders[i]!;
			const b = l.senders[j]!;
			const d = Math.hypot(a.x - b.x, a.y - b.y);
			// slotR is the largest radius any week can take, so this covers every mode.
			expect(d).toBeGreaterThanOrEqual(a.slotR + b.slotR - 0.02);
			expect(d).toBeGreaterThanOrEqual(a.r + b.r);
		}
	}
}

function overlaps(a: Box, b: Box) {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe("layoutOrbit", () => {
	test("is deterministic", () => {
		for (const [w, h] of SIZES) {
			for (const week of MODES) {
				const a = layoutOrbit(senders, categories, w, h, week);
				const b = layoutOrbit(senders.map((s) => ({ ...s })), categories.map((c) => ({ ...c })), w, h, week);
				expect(JSON.stringify(a)).toBe(JSON.stringify(b));
			}
		}
	});

	test("orb positions do not move between weeks", () => {
		const all = layoutOrbit(senders, categories, 1290, 460, null);
		for (const week of WEEKS) {
			const l = layoutOrbit(senders, categories, 1290, 460, week);
			expect(l.senders.map((s) => [s.id, s.x, s.y])).toEqual(all.senders.map((s) => [s.id, s.x, s.y]));
			expect(l.categories.map((c) => [c.id, c.x, c.y])).toEqual(all.categories.map((c) => [c.id, c.x, c.y]));
		}
	});

	test("keeps every node and label inside the viewport", () => {
		for (const [w, h] of SIZES) {
			for (const week of MODES) {
				withinBounds(layoutOrbit(senders, categories, w, h, week));
				withinBounds(layoutOrbit(many, manyCats, w, h, week));
			}
		}
	});

	test("never overlaps two sender orbs", () => {
		for (const [w, h] of SIZES) {
			for (const week of MODES) {
				noSenderOverlap(layoutOrbit(senders, categories, w, h, week));
				noSenderOverlap(layoutOrbit(many, manyCats, w, h, week));
				noSenderOverlap(layoutOrbit(many.map((s) => ({ ...s, category: "primary" as const })), manyCats, w, h, week));
			}
		}
	});

	test("seats each sender inside its category's sector", () => {
		for (const [w, h] of SIZES) {
			for (const input of [senders, many]) {
				const l = layoutOrbit(input, input === many ? manyCats : categories, w, h);
				const byId = new Map(l.categories.map((c) => [c.id, c]));
				for (const s of l.senders) {
					const cat = byId.get(s.category)!;
					expect(inSector(s.angle, cat.sector)).toBe(true);
				}
				// Sectors tile the circle without overlapping.
				const span = l.categories.reduce((a, c) => a + (c.sector.end - c.sector.start), 0);
				expect(span).toBeCloseTo(Math.PI * 2, 6);
				for (let i = 0; i < l.categories.length; i++) {
					const a = l.categories[i]!;
					const b = l.categories[(i + 1) % l.categories.length]!;
					if (l.categories.length > 1) {
						const gap = (((b.sector.start - a.sector.end) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
						expect(Math.min(gap, Math.PI * 2 - gap)).toBeLessThan(1e-6);
					}
				}
			}
		}
	});

	test("spaces categories evenly in a stable clockwise order", () => {
		for (const input of [senders, many]) {
			const l = layoutOrbit(input, input === many ? manyCats : categories, 1290, 460);
			expect(l.categories.map((c) => c.id)).toEqual(["primary", "updates", "receipts", "promotions", "newsletters", "social", "other"]);
			const step = (Math.PI * 2) / l.categories.length;
			l.categories.forEach((c, i) => {
				const next = l.categories[(i + 1) % l.categories.length]!;
				const gap = (((next.angle - c.angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
				expect(gap).toBeCloseTo(step, 9);
			});
		}
	});

	test("rotation keeps busy categories off the flat top and bottom", () => {
		const l = layoutOrbit(senders, categories, 1290, 460);
		const busiest = [...l.categories].sort((a, b) => b.senderCount - a.senderCount)[0]!;
		expect(Math.abs(Math.cos(busiest.angle))).toBeLessThan(0.75);
	});

	test("shares add up to 100 and badges read like the reference", () => {
		for (const week of MODES) {
			const l = layoutOrbit(senders, categories, 1290, 460, week);
			expect(l.categories.reduce((a, c) => a + c.sharePct, 0)).toBe(100);
			for (const c of l.categories) expect(c.shareText).toMatch(/^(<1|\d{1,3})%$/);
		}
	});

	test("orb area follows volume", () => {
		const l = layoutOrbit(senders, categories, 1290, 460);
		const sorted = [...l.senders].sort((a, b) => b.value - a.value);
		for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.r).toBeLessThanOrEqual(sorted[i - 1]!.r + 1e-9);
	});

	test("shown labels never collide", () => {
		for (const [w, h] of SIZES) {
			const l = layoutOrbit(senders, categories, w, h);
			const boxes: Box[] = [
				...l.categories.flatMap((c) => (c.labelPos ? [c.labelPos.box] : [])),
				...l.senders.flatMap((s) => [s.label.chip, s.label.name?.box].filter((b): b is Box => !!b)),
			];
			let collisions = 0;
			for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i]!, boxes[j]!)) collisions++;
			expect(collisions).toBe(0);
		}
	});

	test("labels the biggest senders and every category on desktop stages", () => {
		for (const [w, h] of [[1290, 460], [1040, 460], [800, 440]] as const) {
			const l = layoutOrbit(senders, categories, w, h);
			const top = l.senders.filter((s) => s.rank < 8);
			expect(top.every((s) => s.label.name !== null)).toBe(true);
			expect(l.senders.filter((s) => s.label.chip).length).toBe(l.senders.length);
			expect(l.categories.every((c) => c.labelPos?.chip)).toBe(true);
		}
	});

	test("handles no senders", () => {
		const l = layoutOrbit([], categories, 800, 440);
		expect(l.senders).toHaveLength(0);
		expect(l.categories.length).toBe(7);
		const none = layoutOrbit([], [], 800, 440);
		expect(none.senders).toHaveLength(0);
		expect(none.categories).toHaveLength(0);
		expect(none.sun.r).toBeGreaterThan(0);
	});

	test("handles a single sender", () => {
		const { oneSender } = orbitEdgeCases(NOW);
		for (const [w, h] of SIZES) {
			const l = layoutOrbit(oneSender.senders, oneSender.categories, w, h);
			expect(l.senders).toHaveLength(1);
			expect(l.categories).toHaveLength(1);
			withinBounds(l);
		}
	});

	test("handles a single category with many senders", () => {
		const { singleCategory } = orbitEdgeCases(NOW);
		const single = many.map((s) => ({ ...s, category: "primary" as const }));
		for (const [w, h] of SIZES) {
			for (const input of [singleCategory.senders, single]) {
				const l = layoutOrbit(input, singleCategory.categories, w, h);
				expect(l.categories).toHaveLength(1);
				expect(l.senders).toHaveLength(input.length);
				withinBounds(l);
				noSenderOverlap(l);
			}
		}
	});

	test("caps at 24 senders and dedupes addresses", () => {
		const extra = [...many, sender(99, "primary", 1), { ...many[0]!, name: "Duplicate" }];
		const l = layoutOrbit(extra, manyCats, 1290, 460);
		expect(l.senders).toHaveLength(24);
		expect(new Set(l.senders.map((s) => s.id)).size).toBe(24);
	});

	test("invents a category that only senders mention", () => {
		const l = layoutOrbit([sender(1, "social", 9)], [{ category: "primary", count: 40 }], 800, 440);
		expect(l.categories.map((c) => c.id)).toEqual(["primary", "social"]);
		expect(l.categories[1]!.count).toBe(9);
	});

	test("beams and links are SVG paths", () => {
		const l = layoutOrbit(senders, categories, 1290, 460, 2);
		for (const c of l.categories) {
			expect(c.beam.d).toMatch(/^M[-\d.]+ [-\d.]+Q/);
			expect(c.beam.width).toBeGreaterThan(0);
			expect(c.particles.dur).toBeGreaterThan(0);
		}
		for (const s of l.senders) expect(s.link).toMatch(/^M[-\d.]+ [-\d.]+L/);
	});

	test("fresher categories send faster particles", () => {
		const fresh = sender(1, "primary", 20);
		const stale = { ...sender(2, "updates", 20), lastAt: new Date(NOW - 90 * 3_600_000).toISOString() };
		const l = layoutOrbit([fresh, stale], [], 800, 800);
		const [a, b] = l.categories;
		expect(a!.beam.length / a!.particles.dur).toBeGreaterThan(b!.beam.length / b!.particles.dur);
	});
});

describe("activity ring", () => {
	test("one tick per day, length proportional to volume", () => {
		const daily = [0, 1, 2, 4, 8];
		const ticks = activityTicks(daily, 0, 0, 10, 20);
		expect(ticks).toHaveLength(5);
		const lens = ticks.map((t) => Math.hypot(t.x2 - t.x1, t.y2 - t.y1));
		expect(lens[0]).toBe(0);
		expect(lens[4]).toBeCloseTo(20, 1);
		expect(lens[3]! / lens[4]!).toBeCloseTo(0.5, 1);
		// Oldest day sits just clockwise of 12 o'clock.
		expect(ticks[0]!.y1).toBeLessThan(0);
		expect(ticks[0]!.x1).toBeGreaterThan(0);
	});

	test("combined daily right-aligns ragged series", () => {
		const a = { ...sender(1, "primary", 3), daily: [1, 1, 1] };
		const b = { ...sender(2, "primary", 2), daily: [2] };
		expect(combinedDaily([a, b], 4)).toEqual([0, 1, 1, 3]);
	});
});

describe("layoutFocus", () => {
	test("wide stages fan to cards inside the viewport", () => {
		for (const w of [720, 900, 1290]) {
			const l = layoutFocus(w, 460, ["threads", "unread", "reply", "last", "local"]);
			expect(l.compact).toBe(false);
			expect(l.curves).toHaveLength(5);
			for (const c of l.cards) {
				expect(c.x).toBeGreaterThan(l.orb.x + l.ring.outer);
				expect(c.y).toBeGreaterThanOrEqual(0);
				expect(c.y + CARD_H).toBeLessThanOrEqual(460);
				expect(c.x + c.w).toBeLessThan(l.detail.x);
			}
			expect(l.detail.x + l.detail.w).toBeLessThanOrEqual(w);
			expect(l.detail.w).toBeGreaterThanOrEqual(220);
		}
	});

	test("narrow stages stack", () => {
		const l = layoutFocus(390, 460, ["threads", "unread", "reply", "last"]);
		expect(l.compact).toBe(true);
		expect(l.curves).toHaveLength(0);
	});

	test("row stacks stay inside the detail column", () => {
		const l = layoutFocus(1290, 460, ["threads", "unread", "reply", "last"]);
		const rows = stackRows(l.detail, 5);
		expect(rows.top).toBeGreaterThanOrEqual(l.detail.y);
		expect(rows.centers).toHaveLength(5);
		expect(rows.centers.at(-1)! + 27).toBeLessThanOrEqual(l.detail.y + l.detail.h);
	});
});

describe("format", () => {
	test("durations", () => {
		expect(formatDuration(130)).toBe("2h 10m");
		expect(formatDuration(45)).toBe("45m");
		expect(formatDuration(120)).toBe("2h");
		expect(formatDuration(1680)).toBe("1d 4h");
		expect(formatDuration(null)).toBe("—");
	});

	test("relative time", () => {
		expect(formatAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3h ago");
		expect(formatAgo(new Date(NOW - 50 * 3_600_000).toISOString(), NOW)).toBe("2d ago");
		expect(formatAgo(new Date(NOW - 20_000).toISOString(), NOW)).toBe("just now");
	});

	test("their local time", () => {
		const t = Date.UTC(2026, 8, 24, 22, 40);
		expect(formatClock(t, 60)).toBe("11:40 pm");
		expect(formatClock(t, -420)).toBe("3:40 pm");
		expect(formatClock(Date.UTC(2026, 8, 24, 0, 5), 0)).toBe("12:05 am");
		expect(formatUtcOffset(330)).toBe("UTC+5:30");
		expect(formatUtcOffset(-240)).toBe("UTC−4");
	});

	test("deep links", () => {
		expect(threadHref({ folder: "INBOX", uid: "101", messageId: "<dev-101@localhost>" })).toBe(
			"/mail?folder=INBOX&uid=101&mid=%3Cdev-101%40localhost%3E",
		);
		expect(threadHref({ folder: "Work/Q3", uid: "7" })).toBe("/mail?folder=Work%2FQ3&uid=7");
	});

	test("share rounding", () => {
		expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
		expect(sharePercents([0, 0])).toEqual([0, 0]);
	});
});

describe("fixtures", () => {
	test("match the SenderStat contract", () => {
		expect(senders.length).toBeGreaterThanOrEqual(16);
		expect(new Set(senders.map((s) => s.category)).size).toBeGreaterThanOrEqual(6);
		for (const s of senders) {
			expect(s.daily).toHaveLength(30);
			expect(s.weekly).toHaveLength(4);
			expect(s.daily.reduce((a, b) => a + b, 0)).toBe(s.count);
			expect(s.weekly.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(s.count);
			expect(s.recent.length).toBeGreaterThanOrEqual(1);
			expect(s.recent.length).toBeLessThanOrEqual(5);
			expect(s.lastAt).toBe(s.recent[0]!.date);
			// The newest day with mail is the day of lastAt.
			const lastIdx = s.daily.findLastIndex((v) => v > 0);
			expect(29 - lastIdx).toBe(Math.floor(s.recent[0]!.ageHours / 24));
		}
		for (let i = 1; i < senders.length; i++) expect(senders[i]!.count).toBeLessThanOrEqual(senders[i - 1]!.count);
	});
});

describe("custom category labels", () => {
	const { senders, categories } = orbitFixtures(NOW);

	test("the default is exactly the mail labels, so mail layouts are unchanged", () => {
		expect(layoutOrbit(senders, categories, 900, 470, null)).toEqual(layoutOrbit(senders, categories, 900, 470, null, CATEGORY_LABEL));
		expect(categoryShares(senders, categories, 2)).toEqual(categoryShares(senders, categories, 2, CATEGORY_LABEL));
	});

	test("custom labels rename categories without moving anything else", () => {
		const labels = Object.fromEntries(Object.keys(CATEGORY_LABEL).map((k) => [k, `X-${k}`])) as typeof CATEGORY_LABEL;
		const base = layoutOrbit(senders, categories, 900, 470, null);
		const custom = layoutOrbit(senders, categories, 900, 470, null, labels);
		expect(custom.categories.map((c) => c.label)).toEqual(base.categories.map((c) => `X-${c.id}`));
		expect(custom.senders).toEqual(base.senders);
		expect(custom.categories.map(({ x, y, r }) => ({ x, y, r }))).toEqual(base.categories.map(({ x, y, r }) => ({ x, y, r })));
		expect(categoryShares(senders, categories, null, labels).map((c) => c.label)).toEqual(base.categories.map((c) => `X-${c.id}`));
	});
});
