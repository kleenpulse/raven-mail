/*
 * bun run desktop:build [-- <electron-builder target flags>]
 *
 * Builds the web app as a desktop build, stages it, makes installers with
 * electron-builder (run by Node), then checks what got packaged and writes
 * SHA256SUMS.txt next to the installers. With no flags it builds for this OS.
 *
 * Installers for users are built on CI only (.github/workflows/desktop.yml).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildAndStage } from "./stage";
import { verifyServerDir } from "./verify";

const root = resolve(import.meta.dir, "../..");
const desktop = join(root, "desktop");
const out = join(desktop, ".out");
const node = process.env.RAVEN_NODE || "node";
const targets = process.argv.slice(2);

await buildAndStage(root);

const builder = join(desktop, "node_modules", "electron-builder", "cli.js");
const env: Record<string, string | undefined> = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const packed = spawnSync(node, [builder, "--config", "electron-builder.yml", "--publish", "never", ...targets], { cwd: desktop, env, stdio: "inherit" });
if (packed.status !== 0) throw new Error("electron-builder failed");

/** Every unpacked app electron-builder left in .out, with its resources folder and executable. */
function unpackedApps(): { resources: string; app: string }[] {
	const apps: { resources: string; app: string }[] = [];
	for (const name of readdirSync(out)) {
		const dir = join(out, name);
		if (name.endsWith("-unpacked")) {
			const exe = readdirSync(dir).find((f) => /^(Raven\.exe|raven)$/.test(f));
			if (exe) apps.push({ resources: join(dir, "resources"), app: join(dir, exe) });
		} else if (/^mac/.test(name) && existsSync(join(dir, "Raven.app"))) {
			apps.push({ resources: join(dir, "Raven.app", "Contents", "Resources"), app: join(dir, "Raven.app") });
		}
	}
	return apps;
}

const apps = unpackedApps();
if (apps.length === 0) throw new Error(`no unpacked app found in ${out}`);
const fuses = join(desktop, "node_modules", "@electron", "fuses", "dist", "bin.js");
// The electronFuses block of electron-builder.yml, named the way the fuses CLI prints them.
const fuseBlock = /^electronFuses:\r?\n((?:[ \t]+\w+: (?:true|false)\r?\n)+)/m.exec(readFileSync(join(desktop, "electron-builder.yml"), "utf8"))?.[1] ?? "";
const expected = [...fuseBlock.matchAll(/(\w+): (true|false)/g)].map(([, key, value]) => ({ name: key[0].toUpperCase() + key.slice(1), on: value === "true" }));
if (expected.length !== 8) throw new Error(`expected 8 electronFuses in electron-builder.yml, found ${expected.length}`);
for (const { resources, app } of apps) {
	verifyServerDir(join(resources, "server"));
	const read = spawnSync(node, [fuses, "read", "--app", app], { encoding: "utf8", env: { ...env, FORCE_COLOR: "0", NO_COLOR: "1" } });
	console.log(read.stdout.trim());
	const wrong = expected.filter(({ name, on }) => !read.stdout.includes(` ${name} is ${on ? "Enabled" : "Disabled"}`));
	if (read.status !== 0 || wrong.length > 0) {
		throw new Error(`fuses aren't set as expected on ${app}: ${wrong.map((fuse) => fuse.name).join(", ") || "read failed"}`);
	}
}

const installers = readdirSync(out).filter((f) => /\.(exe|dmg|AppImage|deb)$/.test(f));
const sums = installers.map((f) => `${createHash("sha256").update(readFileSync(join(out, f))).digest("hex")}  ${f}`);
writeFileSync(join(out, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
console.log(sums.join("\n"));
