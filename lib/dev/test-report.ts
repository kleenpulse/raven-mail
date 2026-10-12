/*
 * Test-run report: the shape `scripts/test-report.ts` writes to
 * `.test-results/`, the dev run route streams, and /dev/tests renders.
 * Pure — no Node imports — so client, server and script all share it.
 */

export type TestStatus = "pass" | "fail" | "skip" | "todo";
export type TestLayer = "unit" | "route" | "dom";
export type TestArea = "mail" | "integrations" | "jev" | "insights" | "server" | "ui" | "other";

export type Counts = { total: number; pass: number; fail: number; skip: number; todo: number };
export type TestCase = {
	id: string;
	name: string;
	/** Enclosing describe blocks, outermost first. */
	path: string[];
	status: TestStatus;
	ms: number;
	error?: { message: string; detail?: string };
};
export type TestFile = { file: string; layer: TestLayer; area: TestArea; ms: number; counts: Counts; tests: TestCase[] };
export type Pct = { hit: number; found: number };
export type CoverageFile = { file: string; lines: Pct; funcs: Pct };
export type Coverage = { lines: Pct; funcs: Pct; files: CoverageFile[] };

export type TestReport = {
	schema: 1;
	runId: string;
	startedAt: string;
	finishedAt: string;
	ms: number;
	bun: string;
	commit?: string;
	exitCode: number;
	counts: Counts;
	files: TestFile[];
	coverage?: Coverage;
};

export type RunSummary = {
	runId: string;
	finishedAt: string;
	ms: number;
	counts: Counts;
	linesPct?: number;
	files: Record<string, { total: number; fail: number; ms: number }>;
};
/** Oldest → newest. */
export type TestHistory = { schema: 1; runs: RunSummary[] };

export type TestRunEvent =
	| { type: "start"; runId: string; startedAt: string }
	| { type: "file"; file: string; layer: TestLayer }
	| { type: "test"; file: string; name: string; status: TestStatus; ms?: number }
	| { type: "done"; report: TestReport; history: TestHistory }
	| { type: "error"; message: string };

export const HISTORY_CAP = 30;
export const LAYERS: readonly TestLayer[] = ["unit", "route", "dom"];
export const AREAS: readonly TestArea[] = ["mail", "integrations", "jev", "insights", "server", "ui", "other"];

export const AREA_LABEL: Record<TestArea, string> = {
	mail: "Mail",
	integrations: "Integrations",
	jev: "Jev",
	insights: "Insights",
	server: "Server",
	ui: "UI",
	other: "Other",
};

export const LAYER_LABEL: Record<TestLayer, string> = { unit: "Unit", route: "Route", dom: "DOM" };

export const emptyCounts = (): Counts => ({ total: 0, pass: 0, fail: 0, skip: 0, todo: 0 });

export function normalizePath(file: string): string {
	return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function layerOf(file: string): TestLayer {
	const f = normalizePath(file);
	if (/\.dom\.test\.[jt]sx?$/.test(f)) return "dom";
	if (f.startsWith("test/api/")) return "route";
	return "unit";
}

/** First match wins; order matters where prefixes overlap. */
const AREA_PREFIXES: [string, TestArea][] = [
	["test/api/mail", "mail"],
	["test/api/overview", "insights"],
	["test/api/jev", "jev"],
	["test/api/integrations", "integrations"],
	["test/api/dev", "other"],
	["lib/mail", "mail"],
	["lib/search", "mail"],
	["lib/integrations", "integrations"],
	["components/integrations", "integrations"],
	["lib/jev", "jev"],
	["lib/triage", "jev"],
	["lib/insights", "insights"],
	["lib/landing", "insights"],
	["components/overview", "insights"],
	["lib/server", "server"],
	["lib/session", "server"],
	["lib/auth", "server"],
	["lib/api-error", "server"],
	["lib/format", "server"],
	["lib/ndjson", "server"],
	["components/", "ui"],
	["hooks/", "ui"],
];

export function areaOf(file: string): TestArea {
	const f = normalizePath(file);
	for (const [prefix, area] of AREA_PREFIXES) if (f.startsWith(prefix)) return area;
	return "other";
}

export function testId(file: string, path: readonly string[], name: string): string {
	return `${normalizePath(file)}::${[...path, name].join(" > ")}`;
}

export function countTests(tests: readonly Pick<TestCase, "status">[]): Counts {
	const c = emptyCounts();
	for (const t of tests) {
		c.total++;
		c[t.status]++;
	}
	return c;
}

export function addCounts(a: Counts, b: Counts): Counts {
	return { total: a.total + b.total, pass: a.pass + b.pass, fail: a.fail + b.fail, skip: a.skip + b.skip, todo: a.todo + b.todo };
}

/** 0–100, or null when nothing was measured. */
export function pct(p: Pct): number | null {
	return p.found > 0 ? (p.hit / p.found) * 100 : null;
}

/** Share of executed tests (skips and todos excluded) that passed, 0–100. */
export function passRate(c: Counts): number | null {
	const ran = c.pass + c.fail;
	return ran > 0 ? (c.pass / ran) * 100 : null;
}

export function summarize(report: TestReport): RunSummary {
	const files: RunSummary["files"] = {};
	for (const f of report.files) files[f.file] = { total: f.counts.total, fail: f.counts.fail, ms: f.ms };
	const linesPct = report.coverage ? pct(report.coverage.lines) : null;
	return {
		runId: report.runId,
		finishedAt: report.finishedAt,
		ms: report.ms,
		counts: report.counts,
		...(linesPct === null ? {} : { linesPct }),
		files,
	};
}

export function appendHistory(history: TestHistory | null, run: RunSummary, cap = HISTORY_CAP): TestHistory {
	const runs = (history?.runs ?? []).filter((r) => r.runId !== run.runId);
	runs.push(run);
	return { schema: 1, runs: runs.slice(-cap) };
}
