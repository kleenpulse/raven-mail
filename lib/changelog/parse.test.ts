import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog, releaseFor } from "@/lib/changelog/parse";
import pkg from "@/package.json";

const SAMPLE = [
	"# Changelog",
	"",
	"## [Unreleased]",
	"",
	"### Added",
	"",
	"- Not shipped yet.",
	"",
	"## [0.2.0] - 2026-10-01",
	"",
	"### Added",
	"",
	"- A long entry that",
	"  wraps onto a second line.",
	"",
	"### Fixed",
	"",
	"- A bug.",
	"",
	"### Tweaked",
	"",
	"- Unknown heading.",
	"",
	"## [0.1.0]",
	"",
	"- No category heading.",
].join("\r\n");

describe("parseChangelog", () => {
	const releases = parseChangelog(SAMPLE);

	test("skips Unreleased and keeps file order, newest first", () => {
		expect(releases.map((r) => r.version)).toEqual(["0.2.0", "0.1.0"]);
	});

	test("reads the date, or null when the heading has none", () => {
		expect(releases[0].date).toBe("2026-10-01");
		expect(releases[1].date).toBeNull();
	});

	test("folds continuation lines and tags each entry with its category", () => {
		expect(releases[0].entries).toEqual([
			{ category: "added", text: "A long entry that wraps onto a second line." },
			{ category: "fixed", text: "A bug." },
			{ category: "changed", text: "Unknown heading." },
		]);
		expect(releases[1].entries).toEqual([{ category: "changed", text: "No category heading." }]);
	});

	test("releaseFor finds a version", () => {
		expect(releaseFor(releases, "0.1.0")?.entries).toHaveLength(1);
		expect(releaseFor(releases, "9.9.9")).toBeUndefined();
	});
});

// The file ships inside the app: a malformed edit would silently drop entries.
describe("CHANGELOG.md", () => {
	const raw = readFileSync(join(import.meta.dir, "../../CHANGELOG.md"), "utf8");
	const releases = parseChangelog(raw);

	test("keeps an Unreleased section above every release", () => {
		const unreleased = raw.search(/^## \[Unreleased\]\s*$/m);
		const firstRelease = raw.search(/^## \[\d+\.\d+\.\d+\]/m);
		expect(unreleased).toBeGreaterThan(-1);
		expect(unreleased).toBeLessThan(firstRelease);
	});

	test("every release is dated, has entries, and versions only go down", () => {
		expect(releases.length).toBeGreaterThan(0);
		for (const r of releases) {
			expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(r.entries.length).toBeGreaterThan(0);
		}
		const nums = releases.map((r) => r.version.split(".").map(Number));
		for (let i = 1; i < nums.length; i++) {
			const [a, b] = [nums[i - 1], nums[i]];
			const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
			expect(cmp).toBeGreaterThan(0);
		}
	});

	test("the newest release matches package.json", () => {
		expect(releases[0].version).toBe(pkg.version);
	});
});
