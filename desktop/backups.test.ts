import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestBackup } from "./backups";

let tmp: string;
let db: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "raven-backups-"));
	db = join(tmp, "db");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function backup(name: string, at: string): string {
	const dir = `${db}.backups`;
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, "x");
	utimesSync(path, new Date(at), new Date(at));
	return path;
}

describe("latestBackup", () => {
	test("none when there's no backups folder", () => {
		expect(latestBackup(db)).toBeNull();
	});

	test("the newest backup, ignoring other files", () => {
		backup("before-0003_a-1.tar.gz", "2026-10-01T00:00:00Z");
		const newest = backup("before-0004_b-2.tar.gz", "2026-10-20T00:00:00Z");
		backup("before-0004_b-2.tar.gz.tmp", "2026-10-30T00:00:00Z");
		backup("notes.txt", "2026-10-31T00:00:00Z");
		expect(latestBackup(db)).toEqual({ path: newest, at: new Date("2026-10-20T00:00:00Z") });
	});
});
