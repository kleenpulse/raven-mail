/*
 * bun run desktop:build [-- <electron-builder target flags>]
 *
 * Builds the web app as a desktop build, stages it, makes installers with
 * electron-builder (run by Node), then checks what got packaged and writes
 * SHA256SUMS.txt next to the installers. With no flags it builds for this OS.
 *
 * It signs when the keys are in the environment (scripts/signing.ts and
 * desktop/RELEASING.md), and builds exactly as before when they aren't.
 *
 * Installers for users are built on CI only (.github/workflows/desktop.yml).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MODE_LABEL, signingPlan, type SigningPlan } from "./signing";
import { buildAndStage } from "./stage";
import { verifyServerDir } from "./verify";

const root = resolve(import.meta.dir, "../..");
const desktop = join(root, "desktop");
const out = join(desktop, ".out");
const node = process.env.RAVEN_NODE || "node";
const targets = process.argv.slice(2);

// Before the long web build, so missing keys fail fast.
const signing = signingPlan({ platform: process.platform, env: process.env, entitlements: join(desktop, "build", "entitlements.hardened.plist"), fileExists: existsSync });
console.log(`signing: ${MODE_LABEL[signing.mode]}${signing.notarize ? ", notarized" : ""}`);

const { app: stagedApp } = await buildAndStage(root);
// The updater reads this: macOS installs updates itself only when signed.
const manifestPath = join(stagedApp, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, ravenBuild: { signed: signing.signed } }, null, 2)}\n`);

const builder = join(desktop, "node_modules", "electron-builder", "cli.js");
const env = signing.env;
delete env.ELECTRON_RUN_AS_NODE;
const packed = spawnSync(node, [builder, "--config", "electron-builder.yml", "--publish", "never", ...targets, ...signing.args], { cwd: desktop, env, stdio: "inherit" });
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
// Positions on Electron 45's fuse wire. @electron/fuses 1.8 (pinned by
// electron-builder 26) names only the first eight, so the list lives here.
const FUSE_INDEX: Record<string, number> = {
	runAsNode: 0,
	enableCookieEncryption: 1,
	enableNodeOptionsEnvironmentVariable: 2,
	enableNodeCliInspectArguments: 3,
	enableEmbeddedAsarIntegrityValidation: 4,
	onlyLoadAppFromAsar: 5,
	loadBrowserProcessSpecificV8Snapshot: 6,
	grantFileProtocolExtraPrivileges: 7,
	wasmTrapHandlers: 8,
};
// FuseState in @electron/fuses: the wire holds ASCII "0" / "1".
const ENABLED = 49;
const DISABLED = 48;
// The electronFuses block of electron-builder.yml, plus the one it can't set yet:
// wasmTrapHandlers stays at Electron's default (on), since PGlite runs on wasm.
const fuseBlock = /^electronFuses:\r?\n((?:[ \t]+\w+: (?:true|false)\r?\n)+)/m.exec(readFileSync(join(desktop, "electron-builder.yml"), "utf8"))?.[1] ?? "";
const expected = [...fuseBlock.matchAll(/(\w+): (true|false)/g)].map(([, key, value]) => ({ name: key, on: value === "true" }));
if (expected.length !== 8) throw new Error(`expected 8 electronFuses in electron-builder.yml, found ${expected.length}`);
expected.push({ name: "wasmTrapHandlers", on: true });
type FusesLib = { getCurrentFuseWire(pathToElectron: string): Promise<Record<string, number | string>> };
const fusesLib = (await import(join(desktop, "node_modules", "@electron", "fuses", "dist", "index.js"))) as FusesLib;
for (const { resources, app } of apps) {
	verifyServerDir(join(resources, "server"));
	const wire = await fusesLib.getCurrentFuseWire(app);
	const wrong = expected.filter(({ name, on }) => {
		const index = FUSE_INDEX[name];
		if (index === undefined) throw new Error(`unknown fuse ${name} in electron-builder.yml`);
		const state = wire[index];
		console.log(`  ${name} is ${state === ENABLED ? "Enabled" : state === DISABLED ? "Disabled" : `in state ${String(state)}`}`);
		return state !== (on ? ENABLED : DISABLED);
	});
	if (wrong.length > 0) throw new Error(`fuses aren't set as expected on ${app}: ${wrong.map((fuse) => fuse.name).join(", ")}`);
}

const installers = readdirSync(out).filter((f) => /\.(exe|dmg|AppImage|deb)$/.test(f));
verifySignatures(signing, apps, installers);
const sums = installers.map((f) => `${createHash("sha256").update(readFileSync(join(out, f))).digest("hex")}  ${f}`);
writeFileSync(join(out, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
console.log(sums.join("\n"));

/**
 * macOS: the bundle's seal holds (ad hoc too), and Gatekeeper accepts a
 * notarized app. Windows: signed builds carry a valid Authenticode signature
 * on the app and the installer.
 */
function verifySignatures(plan: SigningPlan, built: { app: string }[], files: string[]): void {
	const check = (what: string, cmd: string, args: string[], extraEnv: Record<string, string> = {}): string => {
		const run = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...extraEnv } });
		if (run.status !== 0) throw new Error(`${what} failed: ${(run.stderr || run.stdout || run.error?.message || "").trim().slice(0, 600)}`);
		return run.stdout.trim();
	};
	if (process.platform === "darwin") {
		for (const { app } of built.filter(({ app }) => app.endsWith(".app"))) {
			check(`codesign --verify on ${app}`, "codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
			if (plan.notarize) check(`spctl on ${app}`, "spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
			console.log(`  ${app}: signature verified${plan.notarize ? ", accepted by Gatekeeper" : ""}`);
		}
	}
	if (process.platform === "win32" && plan.signed) {
		const paths = [...built.map(({ app }) => app), ...files.filter((f) => f.endsWith(".exe")).map((f) => join(out, f))];
		for (const path of paths) {
			// The path goes in through the environment, so nothing in it is read as PowerShell.
			const status = check(`Get-AuthenticodeSignature on ${path}`, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-AuthenticodeSignature -LiteralPath $env:RAVEN_SIGNED_FILE).Status"], { RAVEN_SIGNED_FILE: path });
			if (status !== "Valid") throw new Error(`${path} isn't validly signed: ${status}`);
			console.log(`  ${path}: Authenticode signature valid`);
		}
	}
}
