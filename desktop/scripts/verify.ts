/*
 * bun desktop/scripts/verify.ts <server-dir>
 *
 * Checks a staged or packaged server folder before it ships: nothing secret
 * or test-only inside, no links (they'd point at the build machine), no native
 * binaries (the folder must run on every OS and CPU), and the files the app
 * needs at runtime are there. Finally it opens PGlite from that folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
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
			else if (rel.startsWith("node_modules/@electric-sql/pglite/") && name.endsWith(".tar.gz")) problems.push(`unused PGlite extension: ${rel}`);
			else if (/^\.next\/node_modules\/@electric-sql\/pglite-[0-9a-f]+\/dist$/.test(rel)) problems.push(`second copy of PGlite: ${rel}`);
			else if (stat.isDirectory()) walk(full);
		}
	};
	walk(dir);
	for (const file of REQUIRED) if (!existsSync(join(dir, file))) problems.push(`missing: ${file}`);
	return problems;
}

/** Imports `specifier` with `cwd` as the base (as code there would) and opens an in-memory database. */
export function pgliteOpens(cwd: string, specifier = "@electric-sql/pglite"): string | null {
	const script = `const { PGlite } = await import(${JSON.stringify(specifier)}); const pg = new PGlite(); await pg.query("select 1"); await pg.close();`;
	const run = spawnSync(process.env.RAVEN_NODE || "node", ["--input-type=module", "-e", script], { cwd, encoding: "utf8", timeout: 60_000 });
	return run.status === 0 ? null : `${specifier} didn't open from ${cwd}: ${(run.stderr || run.error?.message || "").trim().slice(0, 400)}`;
}

/** The names the server's chunks import PGlite by (Turbopack's `@electric-sql/pglite-<hash>` aliases). */
export function pgliteAliases(dir: string): string[] {
	const found = new Set<string>();
	const walk = (path: string) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".js")) for (const [, name] of readFileSync(full, "utf8").matchAll(/"(@electric-sql\/pglite-[0-9a-f]+)"/g)) found.add(name!);
		}
	};
	const server = join(dir, ".next", "server");
	if (existsSync(server)) walk(server);
	return [...found];
}

export function verifyServerDir(dir: string): void {
	const problems = problemsIn(dir);
	if (problems.length === 0) {
		const pglite = pgliteOpens(dir);
		if (pglite) problems.push(pglite);
		// The chunks live under .next, so their aliases resolve from there.
		for (const alias of pgliteAliases(dir)) {
			const opened = pgliteOpens(join(dir, ".next"), alias);
			if (opened) problems.push(opened);
		}
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
