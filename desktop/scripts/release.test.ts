import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { changelogSection, checkTag, mergeSums, releaseNotes } from "./release";

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Not out yet.

## [0.10.0] - 2026-11-02

### Added

- Updates, in the
  desktop app.

### Fixed

- A bug.

## [0.9.0] - 2026-10-30

- Older.

[0.10.0]: https://github.com/kleenpulse/raven-mail/compare/v0.9.0...v0.10.0
`;

const hash = (c: string) => c.repeat(64);

describe("release notes", () => {
	test("take the version's own section, not Unreleased or older ones", () => {
		expect(changelogSection(CHANGELOG, "0.10.0")).toBe("### Added\n\n- Updates, in the\n  desktop app.\n\n### Fixed\n\n- A bug.");
	});

	test("drop link definitions at the end of the last section", () => {
		expect(changelogSection(CHANGELOG, "0.9.0")).toBe("- Older.");
	});

	test("a missing or empty section stops the release", () => {
		expect(() => changelogSection(CHANGELOG, "0.11.0")).toThrow("no section for 0.11.0");
		expect(() => changelogSection("## [1.0.0]\n\n## [0.9.0]\n- x", "1.0.0")).toThrow("is empty");
	});

	test("the dots in a version aren't wildcards", () => {
		expect(() => changelogSection("## [0x10x0]\n- x", "0.10.0")).toThrow("no section");
	});

	test("end with where to download", () => {
		expect(releaseNotes(CHANGELOG, "0.10.0")).toEndWith("SHA256SUMS.txt has the checksum of every file.\n");
	});

	test("the real CHANGELOG has a section for the current version", () => {
		const root = join(import.meta.dir, "..", "..");
		const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
		expect(changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version).length).toBeGreaterThan(0);
	});
});

describe("the tag", () => {
	test("must be v plus package.json's version", () => {
		expect(checkTag("v0.10.0", "0.10.0")).toBe("0.10.0");
		expect(() => checkTag("v0.10.1", "0.10.0")).toThrow("doesn't match");
		expect(() => checkTag("0.10.0", "0.10.0")).toThrow("doesn't match");
	});
});

describe("checksums", () => {
	test("merge every OS's list, sorted by name", () => {
		const merged = mergeSums([`${hash("b")}  Raven-1.0.0-win-x64.exe\n${hash("c")}  latest.yml\n`, `${hash("a")}  Raven-1.0.0-linux-x86_64.AppImage\r\n`]);
		expect(merged).toBe(`${hash("a")}  Raven-1.0.0-linux-x86_64.AppImage\n${hash("b")}  Raven-1.0.0-win-x64.exe\n${hash("c")}  latest.yml\n`);
	});

	test("read sha256sum's binary-mode lines too, and write them in text mode", () => {
		expect(mergeSums([`${hash("a")} *Raven.dmg\n`])).toBe(`${hash("a")}  Raven.dmg\n`);
	});

	test("a file two builds both made is an error, not an overwrite", () => {
		expect(() => mergeSums([`${hash("a")}  latest.yml\n`, `${hash("b")}  latest.yml\n`])).toThrow("latest.yml comes from two builds");
	});

	test("anything that isn't a checksum line is an error", () => {
		expect(() => mergeSums(["not a checksum\n"])).toThrow("not a checksum line");
	});
});
