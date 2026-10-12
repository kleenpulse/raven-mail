import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyRunEvent, IDLE_RUN, RUNNING } from "./test-run-state";
import { parseConsoleLine, parseJunit, parseLcov, toCoverage } from "./test-report-parse";
import {
	appendHistory,
	areaOf,
	countTests,
	layerOf,
	passRate,
	pct,
	summarize,
	testId,
	type RunSummary,
	type TestReport,
} from "./test-report";

const junit = readFileSync(path.join(import.meta.dir, "__fixtures__/junit.sample.xml"), "utf8");

function report(over: Partial<TestReport> = {}): TestReport {
	return {
		schema: 1,
		runId: "r1",
		startedAt: "2026-09-25T10:00:00.000Z",
		finishedAt: "2026-09-25T10:00:02.000Z",
		ms: 2000,
		bun: "1.4.0",
		exitCode: 0,
		counts: { total: 2, pass: 1, fail: 1, skip: 0, todo: 0 },
		files: parseJunit(junit),
		...over,
	};
}

describe("classification", () => {
	test.each([
		["lib/mail/mime.test.ts", "unit", "mail"],
		["lib\\jev\\ask\\plan.test.ts", "unit", "jev"],
		["lib/triage/jev.test.ts", "unit", "jev"],
		["test/api/mail.test.ts", "route", "mail"],
		["test/api/overview.test.ts", "route", "insights"],
		["test/api/integrations.test.ts", "route", "integrations"],
		["components/overview/orbit/orbit.dom.test.tsx", "dom", "insights"],
		["components/dev-tests/files-table.dom.test.tsx", "dom", "ui"],
		["hooks/use-test-run.dom.test.tsx", "dom", "ui"],
		["lib/session.test.ts", "unit", "server"],
		["lib/dev/test-report.test.ts", "unit", "other"],
	] as const)("%s → %s / %s", (file, layer, area) => {
		expect(layerOf(file)).toBe(layer);
		expect(areaOf(file)).toBe(area);
	});

	test("ids join the describe path the way the console prints it", () => {
		expect(testId("lib\\a.test.ts", ["outer", "inner"], "name")).toBe("lib/a.test.ts::outer > inner > name");
	});
});

describe("parseConsoleLine", () => {
	test.each([
		["(pass) outer > inner > passes [0.27ms]", { kind: "test", status: "pass", name: "outer > inner > passes", ms: 0.27 }],
		["(fail) top-level throw [1.50s]", { kind: "test", status: "fail", name: "top-level throw", ms: 1500 }],
		["(skip) outer > skipped", { kind: "test", status: "skip", name: "outer > skipped" }],
		["(todo) outer > later", { kind: "test", status: "todo", name: "outer > later" }],
		["\x1b[32m(pass)\x1b[0m colored [2.00ms]", { kind: "test", status: "pass", name: "colored", ms: 2 }],
		["lib\\dev\\__fixtures__\\zz_sample.test.ts:", { kind: "file", file: "lib/dev/__fixtures__/zz_sample.test.ts" }],
		["components/x.dom.test.tsx:", { kind: "file", file: "components/x.dom.test.tsx" }],
	] as const)("%s", (line, expected) => {
		expect(parseConsoleLine(line)).toEqual(expected as never);
	});

	test.each(["", " 5 pass", "Ran 5 tests across 1 file. [42.00ms]", "error: boom", "bun test v1.4.0 (34cbb9a40)"])(
		"ignores %p",
		(line) => {
			expect(parseConsoleLine(line)).toBeNull();
		},
	);
});

describe("parseJunit", () => {
	const [file] = parseJunit(junit);

	test("one file, normalized path, counts by status", () => {
		expect(file!.file).toBe("lib/dev/__fixtures__/zz_sample.test.ts");
		expect(file!.counts).toEqual({ total: 5, pass: 1, fail: 2, skip: 1, todo: 1 });
	});

	test("describe path comes from suite nesting, outermost first", () => {
		const t = file!.tests.find((x) => x.name === "fails")!;
		expect(t.path).toEqual(["outer", "inner"]);
		expect(t.id).toBe("lib/dev/__fixtures__/zz_sample.test.ts::outer > inner > fails");
		expect(file!.tests.find((x) => x.name === "top-level throw")!.path).toEqual([]);
	});

	test("failures carry message and detail with entities decoded", () => {
		const t = file!.tests.find((x) => x.name === "top-level throw")!;
		expect(t.status).toBe("fail");
		expect(t.error!.message).toBe('boom <x> & "q"');
		expect(t.error!.detail).toContain("zz_sample.test.ts:10:67");
		const eq = file!.tests.find((x) => x.name === "fails")!.error!;
		expect(eq.message).toStartWith("expect(received).toEqual(expected)\n\n  {\n");
	});

	test("todo is told apart from skip", () => {
		expect(file!.tests.find((x) => x.name === "later")!.status).toBe("todo");
		expect(file!.tests.find((x) => x.name === "skipped")!.status).toBe("skip");
	});

	test("times are milliseconds", () => {
		expect(file!.tests.find((x) => x.name === "passes")!.ms).toBeCloseTo(0.27, 5);
	});

	test("empty report", () => {
		expect(parseJunit('<?xml version="1.0"?><testsuites name="bun test" tests="0"></testsuites>')).toEqual([]);
	});
});

describe("lcov", () => {
	const text = ["TN:", "SF:lib\\a.ts", "FNF:2", "FNH:1", "DA:1,3", "DA:2,0", "DA:3,1", "end_of_record", "SF:lib/b.ts", "FNF:0", "FNH:0", "DA:1,0", "end_of_record"].join("\n");

	test("per-file and total line + function coverage", () => {
		const cov = toCoverage(parseLcov(text));
		expect(cov.files).toEqual([
			{ file: "lib/a.ts", lines: { hit: 2, found: 3 }, funcs: { hit: 1, found: 2 } },
			{ file: "lib/b.ts", lines: { hit: 0, found: 1 }, funcs: { hit: 0, found: 0 } },
		]);
		expect(cov.lines).toEqual({ hit: 2, found: 4 });
		expect(pct(cov.lines)).toBe(50);
		expect(pct(cov.files[1]!.funcs)).toBeNull();
	});

	test("merging keeps the max hits per line instead of double counting", () => {
		const merged = parseLcov("SF:lib/a.ts\nDA:2,5\nDA:4,1\nend_of_record", parseLcov(text));
		expect(toCoverage(merged).files[0]!.lines).toEqual({ hit: 4, found: 4 });
	});
});

describe("history", () => {
	const run = (id: string): RunSummary => ({ runId: id, finishedAt: "", ms: 1, counts: countTests([]), files: {} });

	test("summarize keeps per-file totals, failures, time and line %", () => {
		const s = summarize(report({ coverage: { lines: { hit: 1, found: 4 }, funcs: { hit: 0, found: 0 }, files: [] } }));
		expect(s.files["lib/dev/__fixtures__/zz_sample.test.ts"]).toMatchObject({ total: 5, fail: 2 });
		expect(s.linesPct).toBe(25);
		expect("linesPct" in summarize(report())).toBe(false);
	});

	test("append caps oldest-first and replaces a rerun id", () => {
		let h = appendHistory(null, run("a"), 3);
		for (const id of ["b", "c", "d"]) h = appendHistory(h, run(id), 3);
		expect(h.runs.map((r) => r.runId)).toEqual(["b", "c", "d"]);
		expect(appendHistory(h, run("c"), 3).runs.map((r) => r.runId)).toEqual(["b", "d", "c"]);
	});

	test("pass rate ignores skips and is null with nothing run", () => {
		expect(passRate({ total: 4, pass: 3, fail: 1, skip: 0, todo: 0 })).toBe(75);
		expect(passRate({ total: 2, pass: 0, fail: 0, skip: 1, todo: 1 })).toBeNull();
	});
});

describe("applyRunEvent", () => {
	test("accumulates live events into counts and dots", () => {
		let s = applyRunEvent(IDLE_RUN, { type: "start", runId: "x", startedAt: "" });
		s = applyRunEvent(s, { type: "file", file: "lib/a.test.ts", layer: "unit" });
		s = applyRunEvent(s, { type: "test", file: "lib/a.test.ts", name: "a", status: "pass" });
		s = applyRunEvent(s, { type: "test", file: "lib/a.test.ts", name: "b", status: "fail", ms: 3 });
		expect(s).toMatchObject({ status: "running", runId: "x", files: 1, currentFile: "lib/a.test.ts", dots: [
			{ status: "pass", name: "a", file: "lib/a.test.ts" },
			{ status: "fail", name: "b", file: "lib/a.test.ts", ms: 3 },
		] });
		expect(s.counts).toEqual({ total: 2, pass: 1, fail: 1, skip: 0, todo: 0 });
	});

	test("done adopts the final report's counts; error keeps progress", () => {
		const r = report();
		const done = applyRunEvent(RUNNING, { type: "done", report: r, history: { schema: 1, runs: [] } });
		expect(done).toMatchObject({ status: "done", report: r, counts: r.counts });
		const dots = [{ status: "pass" as const, name: "a", file: "f" }];
		const err = applyRunEvent({ ...RUNNING, dots }, { type: "error", message: "boom" });
		expect(err).toMatchObject({ status: "error", error: "boom", dots });
	});
});
