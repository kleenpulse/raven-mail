import { XMLParser } from "fast-xml-parser";
import {
	areaOf,
	countTests,
	layerOf,
	normalizePath,
	testId,
	type Coverage,
	type CoverageFile,
	type TestCase,
	type TestFile,
	type TestStatus,
} from "./test-report";

/*
 * Parsers for bun test output: console lines (live progress), JUnit XML
 * (the final source of truth) and lcov coverage.
 */

const ANSI = /\x1b\[[0-9;]*m/g;

export type ConsoleLine =
	| { kind: "file"; file: string }
	| { kind: "test"; status: TestStatus; name: string; ms?: number }
	| null;

/**
 * bun prints `path\to\x.test.ts:` before each file's results and
 * `(pass) describe > name [0.41ms]` per test (timing optional).
 */
export function parseConsoleLine(raw: string): ConsoleLine {
	const line = raw.replace(ANSI, "").trimEnd();
	const test = /^\((pass|fail|skip|todo)\) (.+?)(?: \[([\d.]+)(ms|s)\])?$/.exec(line);
	if (test) {
		const [, status, name, n, unit] = test;
		const ms = n === undefined ? undefined : Number(n) * (unit === "s" ? 1000 : 1);
		return { kind: "test", status: status as TestStatus, name: name!, ...(ms === undefined ? {} : { ms }) };
	}
	const file = /^(\S.*\.(?:test|spec)\.[cm]?[jt]sx?):$/.exec(line);
	if (file) return { kind: "file", file: normalizePath(file[1]!) };
	return null;
}

type XmlNode = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@",
	textNodeName: "#text",
	parseAttributeValue: false,
	// bun encodes newlines in failure messages as &#10;.
	htmlEntities: true,
	isArray: (name) => name === "testsuite" || name === "testcase",
});

function failureOf(node: XmlNode): TestCase["error"] {
	const raw = node.failure ?? node.error;
	if (raw === undefined) return undefined;
	const first = asArray<XmlNode | string>(raw as XmlNode | string)[0];
	if (!first) return { message: "Failed" };
	if (typeof first === "string") return { message: first.trim().split("\n")[0] || "Failed", detail: first.trim() };
	const f: XmlNode = first;
	const message = String(f["@message"] ?? "").trim();
	const detail = String(f["#text"] ?? "").trim();
	return { message: message || detail.split("\n")[0] || "Failed", ...(detail && detail !== message ? { detail } : {}) };
}

function statusOf(node: XmlNode): TestStatus {
	if (node.failure !== undefined || node.error !== undefined) return "fail";
	if (node.skipped !== undefined) {
		const s = node.skipped as XmlNode | string;
		return typeof s === "object" && s["@message"] === "TODO" ? "todo" : "skip";
	}
	return "pass";
}

/**
 * bun nests one `<testsuite>` per file, then one per describe block. The
 * `classname` attribute lists describes innermost-first, so the path is
 * rebuilt from the suite nesting instead.
 */
export function parseJunit(text: string): TestFile[] {
	const doc = xml.parse(text) as XmlNode;
	const root = (doc.testsuites ?? doc) as XmlNode;
	const files: TestFile[] = [];

	for (const suite of asArray(root.testsuite as XmlNode[])) {
		const file = normalizePath(String(suite["@file"] ?? suite["@name"] ?? "unknown"));
		const tests: TestCase[] = [];
		const walk = (node: XmlNode, path: string[]) => {
			for (const tc of asArray(node.testcase as XmlNode[])) {
				const name = String(tc["@name"] ?? "");
				const error = failureOf(tc);
				tests.push({
					id: testId(file, path, name),
					name,
					path,
					status: statusOf(tc),
					ms: Number(tc["@time"] ?? 0) * 1000,
					...(error ? { error } : {}),
				});
			}
			for (const child of asArray(node.testsuite as XmlNode[])) walk(child, [...path, String(child["@name"] ?? "")]);
		};
		walk(suite, []);
		files.push({
			file,
			layer: layerOf(file),
			area: areaOf(file),
			ms: Number(suite["@time"] ?? 0) * 1000,
			counts: countTests(tests),
			tests,
		});
	}
	return files.sort((a, b) => a.file.localeCompare(b.file));
}

export type LcovRecord = { lines: Map<number, number>; fnf: number; fnh: number };

/**
 * Keyed by normalized source path. A file seen twice (merged runs) keeps the
 * max hits per line, so coverage never double-counts.
 */
export function parseLcov(text: string, into = new Map<string, LcovRecord>()): Map<string, LcovRecord> {
	let cur: LcovRecord | null = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("SF:")) {
			const file = normalizePath(line.slice(3));
			cur = into.get(file) ?? { lines: new Map(), fnf: 0, fnh: 0 };
			into.set(file, cur);
		} else if (!cur) {
			continue;
		} else if (line.startsWith("DA:")) {
			const [ln, hits] = line.slice(3).split(",");
			const n = Number(ln);
			cur.lines.set(n, Math.max(cur.lines.get(n) ?? 0, Number(hits) || 0));
		} else if (line.startsWith("FNF:")) {
			cur.fnf = Math.max(cur.fnf, Number(line.slice(4)) || 0);
		} else if (line.startsWith("FNH:")) {
			cur.fnh = Math.max(cur.fnh, Number(line.slice(4)) || 0);
		} else if (line === "end_of_record") {
			cur = null;
		}
	}
	return into;
}

export function toCoverage(records: Map<string, LcovRecord>): Coverage {
	const files: CoverageFile[] = [];
	const lines = { hit: 0, found: 0 };
	const funcs = { hit: 0, found: 0 };
	for (const [file, r] of records) {
		let hit = 0;
		for (const h of r.lines.values()) if (h > 0) hit++;
		files.push({ file, lines: { hit, found: r.lines.size }, funcs: { hit: r.fnh, found: r.fnf } });
		lines.hit += hit;
		lines.found += r.lines.size;
		funcs.hit += r.fnh;
		funcs.found += r.fnf;
	}
	files.sort((a, b) => a.file.localeCompare(b.file));
	return { lines, funcs, files };
}
