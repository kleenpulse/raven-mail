import { describe, expect, test } from "bun:test";
import { AREA_SLOT, fileTitle, SLOT_LABEL, toOrbitInput } from "./test-orbit";
import { countTests, type TestFile, type TestHistory, type TestReport, type TestStatus } from "./test-report";

function file(path: string, statuses: TestStatus[], over: Partial<TestFile> = {}): TestFile {
	const tests = statuses.map((status, i) => ({ id: `${path}::t${i}`, name: `t${i}`, path: [], status, ms: 1 }));
	return { file: path, layer: "unit", area: "mail", ms: 10, counts: countTests(tests), tests, ...over };
}

function report(files: TestFile[]): TestReport {
	return {
		schema: 1,
		runId: "now",
		startedAt: "2026-09-25T10:00:00.000Z",
		finishedAt: "2026-09-25T10:00:05.000Z",
		ms: 5000,
		bun: "1.4.0",
		exitCode: 0,
		counts: countTests(files.flatMap((f) => f.tests)),
		files,
	};
}

describe("toOrbitInput", () => {
	test("caps at 24 files but always keeps failing ones", () => {
		const big = Array.from({ length: 30 }, (_, i) => file(`lib/mail/f${String(i).padStart(2, "0")}.test.ts`, Array(10).fill("pass")));
		const lonelyFailure = file("lib/jev/z.test.ts", ["fail"], { area: "jev" });
		const { senders } = toOrbitInput(report([...big, lonelyFailure]), null);
		expect(senders).toHaveLength(24);
		expect(senders[0]!.address).toBe("lib/jev/z.test.ts");
		expect(senders[0]!.unread).toBe(1);
		expect(senders[0]!.needsReply).toBe(1);
	});

	test("category counts include files that didn't make the cut", () => {
		const files = Array.from({ length: 30 }, (_, i) => file(`lib/mail/f${i}.test.ts`, ["pass", "pass"]));
		const { categories } = toOrbitInput(report(files), null);
		expect(categories).toEqual([{ category: AREA_SLOT.mail, count: 60 }]);
	});

	test("maps layer to bucket and area to slot", () => {
		const { senders } = toOrbitInput(
			report([
				file("test/api/mail.test.ts", ["pass"], { layer: "route", area: "mail" }),
				file("components/x.dom.test.tsx", ["pass", "pass"], { layer: "dom", area: "ui" }),
				file("lib/server/a.test.ts", ["pass", "pass", "pass"], { layer: "unit", area: "server" }),
			]),
			null,
		);
		const by = new Map(senders.map((s) => [s.address, s]));
		expect(by.get("test/api/mail.test.ts")).toMatchObject({ bucket: "people", category: "primary", name: "mail", domain: "test/api" });
		expect(by.get("components/x.dom.test.tsx")).toMatchObject({ bucket: "people", category: "social", name: "x" });
		expect(by.get("lib/server/a.test.ts")).toMatchObject({ bucket: "notifications", category: "newsletters", count: 3 });
	});

	test("weekly = test counts over the last 4 runs, zero-padded; daily = per-run duration", () => {
		const f = file("lib/mail/a.test.ts", ["pass", "pass"]);
		const history: TestHistory = {
			schema: 1,
			runs: [1, 2, 3].map((n) => ({
				runId: `r${n}`,
				finishedAt: "",
				ms: 1,
				counts: countTests([]),
				files: { "lib/mail/a.test.ts": { total: n, fail: 0, ms: n * 10.4 } },
			})),
		};
		const [s] = toOrbitInput(report([f]), history).senders;
		expect(s!.weekly).toEqual([0, 1, 2, 3]);
		expect(s!.daily).toEqual([10, 21, 31]);
		expect(s!.lastAt).toBe("2026-09-25T10:00:05.000Z");
	});

	test("deterministic, and empty in → empty out", () => {
		const r = report([file("lib/mail/a.test.ts", ["pass"]), file("lib/mail/b.test.ts", ["pass"])]);
		expect(toOrbitInput(r, null)).toEqual(toOrbitInput(r, null));
		expect(toOrbitInput(report([]), null)).toEqual({ senders: [], categories: [] });
	});
});

test("every area has a distinct slot and a label", () => {
	expect(new Set(Object.values(AREA_SLOT)).size).toBe(7);
	expect(Object.keys(SLOT_LABEL)).toHaveLength(7);
});

test.each([
	["lib/mail/mime.test.ts", "mime"],
	["components/x/orbit.dom.test.tsx", "orbit"],
	["a.spec.ts", "a.spec.ts"],
])("fileTitle(%s) = %s", (input, out) => {
	expect(fileTitle(input)).toBe(out);
});
