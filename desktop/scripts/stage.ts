/*
 * Builds the web app as a desktop build and stages what the app ships:
 *
 *   desktop/.stage/app     main process + its package.json (version from the root)
 *   desktop/.stage/server  Next standalone server, made self-contained
 *
 * Staging copies through Turbopack's junctions/symlinks (they point at the
 * build machine), strips anything secret, test-only or native, and verifies.
 */
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { bundleMain, bundleServer } from "./bundle";
import { verifyServerDir } from "./verify";

export type Stage = { app: string; server: string };

export function nextBuild(root: string): void {
	const env: Record<string, string | undefined> = { ...process.env, RAVEN_DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1" };
	delete env.ELECTRON_RUN_AS_NODE;
	const next = join(root, "node_modules", "next", "dist", "bin", "next");
	const run = spawnSync(process.env.RAVEN_NODE || "node", [next, "build"], { cwd: root, env, stdio: "inherit" });
	if (run.status !== 0) throw new Error("next build failed");
}

/** Root-level entries of the standalone folder that never ship. */
const ROOT_SKIP = new Set([".test-results", "test", "scripts", ".vercel"]);

function keep(standalone: string, src: string): boolean {
	const rel = relative(standalone, src).split(sep).join("/");
	if (rel === "") return true;
	const name = rel.slice(rel.lastIndexOf("/") + 1);
	if (/^\.env/.test(name)) return false;
	if (!rel.includes("/") && (ROOT_SKIP.has(name) || name.startsWith("brag-output"))) return false;
	// sharp is traced in but unused (no next/image); it's the only native binary.
	if (rel === "node_modules/sharp" || rel === "node_modules/@img") return false;
	if (rel === ".next/cache") return false;
	if (!rel.includes("node_modules/") && /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return false;
	return true;
}

export async function stage(root: string): Promise<Stage> {
	const out = join(root, "desktop", ".stage");
	const server = join(out, "server");
	const app = join(out, "app");
	const standalone = join(root, ".next", "standalone");
	rmSync(out, { recursive: true, force: true });

	cpSync(standalone, server, { recursive: true, dereference: true, filter: (src) => keep(standalone, src) });
	cpSync(join(root, ".next", "static"), join(server, ".next", "static"), { recursive: true });
	cpSync(join(root, "public"), join(server, "public"), { recursive: true });
	cpSync(join(root, "lib", "db", "migrations"), join(server, "lib", "db", "migrations"), { recursive: true });
	await bundleServer(root, server);

	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
	await bundleMain(root, app, {
		name: "raven",
		productName: "Raven",
		version: pkg.version,
		description: "Raven: mail, briefed.",
		author: { name: "Raven", email: "kleenpulse@users.noreply.github.com" },
		homepage: "https://github.com/kleenpulse/raven-mail",
		license: "AGPL-3.0-or-later",
	});

	verifyServerDir(server);
	return { app, server };
}

export async function buildAndStage(root: string): Promise<Stage> {
	nextBuild(root);
	return stage(root);
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..", "..");
	const result = process.argv.includes("--no-build") ? await stage(root) : await buildAndStage(root);
	console.log(`staged ${result.app} and ${result.server}`);
}
