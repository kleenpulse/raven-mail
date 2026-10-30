/*
 * bun desktop/scripts/verify.ts <server-dir>
 *
 * Checks a staged or packaged server folder before it ships: nothing secret
 * or test-only inside, no links (they'd point at the build machine), no native
 * binaries (the folder must run on every OS and CPU), and the files the app
 * needs at runtime are there. Finally it opens PGlite from that folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REQUIRED = [
	"server.js",
	"raven-server.js",
	"node_modules/next/package.json",
	".next/static",
	".next/required-server-files.json",
	"public/tour",
	"CHANGELOG.md",
	"lib/db/migrations/meta/_journal.json",
	"node_modules/@electric-sql/pglite/dist/pglite.wasm",
	"node_modules/@electric-sql/pglite/dist/pglite.data",
	"node_modules/@electric-sql/pglite/dist/initdb.wasm",
];

export function problemsIn(dir: string): string[] {
	const problems: string[] = [];
	const walk = (path: string) => {
		for (const name of readdirSync(path)) {
			const full = join(path, name);
			const rel = relative(dir, full).split(sep).join("/");
			const stat = lstatSync(full);
			const inPackages = rel.includes("node_modules/");
			if (stat.isSymbolicLink()) problems.push(`link: ${rel}`);
			else if (/^\.env/.test(name)) problems.push(`env file: ${rel}`);
			else if (name === ".test-results" || name === "brag-output" || name.startsWith("brag-output-") || name === ".vercel") problems.push(`build junk: ${rel}`);
			else if (name.endsWith(".node")) problems.push(`native binary: ${rel}`);
			else if (!inPackages && /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) problems.push(`test file: ${rel}`);
			else if (rel === ".next/cache") problems.push(`build cache: ${rel}`);
			else if (stat.isDirectory()) walk(full);
		}
	};
	walk(dir);
	for (const file of REQUIRED) if (!existsSync(join(dir, file))) problems.push(`missing: ${file}`);
	return problems;
}

/** Resolves PGlite from the folder the way the server will, and opens an in-memory database. */
export function pgliteOpens(dir: string): string | null {
	const script = `const { PGlite } = await import("@electric-sql/pglite"); const pg = new PGlite(); await pg.query("select 1"); await pg.close();`;
	const run = spawnSync(process.env.RAVEN_NODE || "node", ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8", timeout: 60_000 });
	return run.status === 0 ? null : `PGlite didn't open from ${dir}: ${(run.stderr || run.error?.message || "").trim().slice(0, 400)}`;
}

export function verifyServerDir(dir: string): void {
	const problems = problemsIn(dir);
	if (problems.length === 0) {
		const pglite = pgliteOpens(dir);
		if (pglite) problems.push(pglite);
	}
	if (problems.length > 0) {
		throw new Error(`The server folder isn't fit to ship (${dir}):\n  ${problems.slice(0, 40).join("\n  ")}`);
	}
	console.log(`verified ${dir}`);
}

if (import.meta.main) {
	const dir = process.argv[2];
	if (!dir) {
		console.error("usage: bun desktop/scripts/verify.ts <server-dir>");
		process.exit(2);
	}
	try {
		verifyServerDir(dir);
	} catch (err) {
		console.error((err as Error).message);
		process.exit(1);
	}
}
