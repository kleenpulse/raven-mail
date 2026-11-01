/*
 * bun run desktop:forget-links
 *
 * Removes what `desktop:preview` left behind on Windows: "Raven Preview" in
 * the email app picker, raven:// when a preview build holds it, and the
 * Start menu shortcut Electron made for electron.exe. An installed Raven's
 * keys stay; it claims raven:// again when it starts.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { unpackagedRavenClaim, userChoiceProgId, WINDOWS_MAILTO_CHOICE, WINDOWS_RAVEN_CLASS, windowsMailIds, windowsMailUnregistration } from "../links";

if (process.platform !== "win32") {
	console.log("This only cleans up Windows. Nothing to do here.");
	process.exit(0);
}

function reg(args: string[]): { ok: boolean; stdout: string; stderr: string } {
	const result = spawnSync("reg", args, { encoding: "utf8", windowsHide: true });
	return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

let failed = false;
function remove(args: string[], label: string): void {
	// `reg delete` fails on a missing key too, so look first.
	if (!reg(["query", ...args.slice(1, -1)]).ok) return;
	const result = reg(args);
	if (result.ok) {
		console.log(`removed ${label}`);
	} else {
		failed = true;
		console.error(`couldn't remove ${label}: ${result.stderr.trim()}`);
	}
}

const preview = windowsMailIds("Raven Preview");
for (const args of windowsMailUnregistration(preview)) remove(args, args.slice(1, -1).join(" "));

const choice = userChoiceProgId(reg(["query", WINDOWS_MAILTO_CHOICE, "/v", "ProgId"]).stdout);
if (choice === preview.progId) {
	console.log("Windows still opens email links with Raven Preview. Pick another app in Settings > Apps > Default apps.");
}

const raven = reg(["query", `${WINDOWS_RAVEN_CLASS}\\shell\\open\\command`, "/ve"]);
if (unpackagedRavenClaim(raven.stdout)) {
	remove(["delete", WINDOWS_RAVEN_CLASS, "/f"], `${WINDOWS_RAVEN_CLASS} (a preview build's raven:// links)`);
} else if (raven.ok) {
	console.log("raven:// links belong to an installed Raven. Kept.");
}

// Electron adds a Start menu shortcut for electron.exe the first time a dev or
// preview run shows a notification. Before they had their own app ID, it took
// the installed Raven's taskbar icon too.
const electron = resolve(import.meta.dir, "../node_modules/electron/dist/electron.exe");
const programs = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs");
const listShortcuts = `$s = New-Object -ComObject WScript.Shell; Get-ChildItem -LiteralPath $env:RAVEN_PROGRAMS -Filter *.lnk -Recurse | ForEach-Object { $_.FullName + '|' + $s.CreateShortcut($_.FullName).TargetPath }`;
const shortcuts = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", listShortcuts], {
	encoding: "utf8",
	windowsHide: true,
	env: { ...process.env, RAVEN_PROGRAMS: programs },
});
for (const line of (shortcuts.stdout ?? "").split(/\r?\n/)) {
	const [path, target] = line.split("|");
	if (!path || target?.toLowerCase() !== electron.toLowerCase()) continue;
	try {
		rmSync(path);
		console.log(`removed ${path}`);
	} catch (err) {
		failed = true;
		console.error(`couldn't remove ${path}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

console.log(failed ? "Done, with errors." : "Done. Preview takes raven:// links again when it starts, and lists itself for email links only when you ask.");
process.exit(failed ? 1 : 0);
