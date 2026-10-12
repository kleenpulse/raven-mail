/**
 * Runs the suite and writes `.test-results/latest.json` + `history.json` for
 * /dev/tests. `bun run test:report [--no-coverage] [--ndjson] [filters…]`.
 *
 * `--ndjson` turns stdout into a TestRunEvent stream (the dev run route reads
 * it); otherwise bun's console output is echoed as usual.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConsoleLine, parseJunit, parseLcov, toCoverage } from "@/lib/dev/test-report-parse";
import {
	appendHistory,
	countTests,
	layerOf,
	summarize,
	type TestHistory,
	type TestReport,
	type TestRunEvent,
} from "@/lib/dev/test-report";

const OUT = path.resolve(import.meta.dir, "../.test-results");
const JUNIT = path.join(OUT, "junit.xml");
const COVERAGE_DIR = path.join(OUT, "coverage");

const args = process.argv.slice(2);
const ndjson = args.includes("--ndjson");
const coverage = !args.includes("--no-coverage");
const filters = args.filter((a) => !a.startsWith("--"));

const emit = (event: TestRunEvent) => {
	if (ndjson) process.stdout.write(`${JSON.stringify(event)}\n`);
};

/*
 * bun hides passing tests when it thinks an AI agent is driving it
 * (CLAUDECODE / AGENT / REPL_ID); the live view needs every line.
 */
function childEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
	for (const k of ["CLAUDECODE", "AGENT", "REPL_ID", "AI_AGENT"]) delete env[k];
	return { ...env, NODE_ENV: "test", NO_COLOR: "1", FORCE_COLOR: "0" };
}

async function readJsonFile<T>(file: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(file, "utf8")) as T;
	} catch {
		return null;
	}
}

async function writeAtomic(file: string, data: unknown) {
	const tmp = `${file}.${process.pid}.tmp`;
	await writeFile(tmp, JSON.stringify(data));
	await rename(tmp, file);
}

async function gitCommit(): Promise<string | undefined> {
	try {
		const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], { stdout: "pipe", stderr: "ignore" });
		const out = (await new Response(proc.stdout).text()).trim();
		return (await proc.exited) === 0 && out ? out : undefined;
	} catch {
		return undefined;
	}
}

async function main(): Promise<number> {
	await mkdir(OUT, { recursive: true });
	await rm(JUNIT, { force: true });
	await rm(COVERAGE_DIR, { recursive: true, force: true });

	const runId = crypto.randomUUID();
	const startedAt = new Date();
	emit({ type: "start", runId, startedAt: startedAt.toISOString() });

	const cmd = [
		process.execPath,
		"test",
		"--isolate",
		"--no-orphans",
		"--reporter=junit",
		`--reporter-outfile=${JUNIT}`,
		...(coverage ? ["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${COVERAGE_DIR}`] : []),
		...filters,
	];
	const child = Bun.spawn(cmd, {
		cwd: path.resolve(import.meta.dir, ".."),
		env: childEnv(),
		stdout: ndjson ? "ignore" : "inherit",
		stderr: "pipe",
	});

	// Console output arrives on stderr; parse it line by line for live progress.
	const tail: string[] = [];
	let file = "";
	const decoder = new TextDecoder();
	let buffer = "";
	const onLine = (line: string) => {
		if (!ndjson) process.stderr.write(`${line}\n`);
		tail.push(line);
		if (tail.length > 20) tail.shift();
		const parsed = parseConsoleLine(line);
		if (parsed?.kind === "file") {
			file = parsed.file;
			emit({ type: "file", file, layer: layerOf(file) });
		} else if (parsed?.kind === "test") {
			emit({ type: "test", file, name: parsed.name, status: parsed.status, ...(parsed.ms === undefined ? {} : { ms: parsed.ms }) });
		}
	};
	const reader = child.stderr.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let nl = buffer.indexOf("\n");
		while (nl >= 0) {
			onLine(buffer.slice(0, nl).replace(/\r$/, ""));
			buffer = buffer.slice(nl + 1);
			nl = buffer.indexOf("\n");
		}
	}
	if (buffer) onLine(buffer);
	const exitCode = await child.exited;
	const finishedAt = new Date();

	const junit = await readFile(JUNIT, "utf8").catch(() => null);
	if (!junit) {
		emit({ type: "error", message: `bun test produced no report (exit ${exitCode}).\n${tail.join("\n")}` });
		return exitCode || 1;
	}

	const files = parseJunit(junit);
	const lcov = coverage ? await readFile(path.join(COVERAGE_DIR, "lcov.info"), "utf8").catch(() => null) : null;
	const report: TestReport = {
		schema: 1,
		runId,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		ms: finishedAt.getTime() - startedAt.getTime(),
		bun: Bun.version,
		commit: await gitCommit(),
		exitCode,
		counts: countTests(files.flatMap((f) => f.tests)),
		files,
		...(lcov ? { coverage: toCoverage(parseLcov(lcov)) } : {}),
	};
	const history = appendHistory(await readJsonFile<TestHistory>(path.join(OUT, "history.json")), summarize(report));

	await writeAtomic(path.join(OUT, "latest.json"), report);
	await writeAtomic(path.join(OUT, "history.json"), history);
	emit({ type: "done", report, history });

	if (!ndjson) {
		const c = report.counts;
		console.log(`\nReport → .test-results/latest.json · ${c.pass} pass · ${c.fail} fail · ${c.skip + c.todo} skipped`);
	}
	return exitCode;
}

process.exit(await main());
