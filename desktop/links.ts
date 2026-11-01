import { openPath } from "./bridge";

/*
 * Links the system hands Raven: `raven://open/...` (integration cards) and
 * `mailto:` (once you make Raven your email app). Each becomes a path in the
 * app, which bridge.ts `openPath` checks again; anything else is dropped.
 */

export const RAVEN_SCHEME = "raven";

/** Longest link taken. A mailto body can be long, but not unbounded. */
export const MAX_LINK = 16_384;

/** The pages a raven:// link may open, and the query keys each takes. */
const RAVEN_PAGES: Record<string, ReadonlySet<string>> = {
	"/mail": new Set(["folder", "uid", "mid"]),
	"/overview": new Set(),
};

/** The app path a link opens, or null. */
export function linkPath(link: string): string | null {
	if (link.length > MAX_LINK) return null;
	if (/^mailto:/i.test(link)) return openPath(`/mail?compose=${encodeURIComponent(link)}`);
	const match = /^raven:\/\/open(\/[^?#]*)(\?[^#]*)?$/i.exec(link);
	if (!match) return null;
	// Windows can add a slash to the end of a link it passes on.
	const page = match[1]!.length > 1 ? match[1]!.replace(/\/$/, "") : match[1]!;
	const allowed = RAVEN_PAGES[page];
	if (!allowed) return null;
	const query = match[2] ?? "";
	if ([...new URLSearchParams(query).keys()].some((key) => !allowed.has(key))) return null;
	return openPath(`${page}${query}`);
}

/**
 * The first link in a command line, if any. Windows and Linux pass links as
 * arguments, and Chromium may move its own switches around them.
 */
export function linkArg(argv: readonly string[]): string | undefined {
	return argv.find((arg) => /^(raven|mailto):/i.test(arg));
}

/** Who answers email links on Windows: Raven registers itself, then the user picks it. */
export type WindowsMailApp = {
	/** Shown in Windows' Default apps list. */
	name: string;
	/** Under HKCU\Software, holds the Capabilities key. */
	key: string;
	progId: string;
	/** The program, then any arguments before the link. */
	exe: string;
	args: readonly string[];
};

/** A build's Default apps names, from its user data folder name ("Raven Preview" → RavenPreview, RavenPreview.mailto). */
export function windowsMailIds(name: string): Pick<WindowsMailApp, "name" | "key" | "progId"> {
	const key = name.replace(/\s+/g, "");
	return { name, key, progId: `${key}.mailto` };
}

const quote = (value: string) => `"${value}"`;

/**
 * `reg.exe` argument lists that make Raven show up for `mailto` in Windows'
 * Default apps. They don't make it the default: only the user can, there.
 */
export function windowsMailRegistration(target: WindowsMailApp): string[][] {
	const classes = `HKCU\\Software\\Classes\\${target.progId}`;
	const capabilities = `HKCU\\Software\\${target.key}\\Capabilities`;
	const command = [target.exe, ...target.args, "%1"].map(quote).join(" ");
	return [
		["add", classes, "/ve", "/d", `${target.name} email link`, "/f"],
		["add", classes, "/v", "URL Protocol", "/d", "", "/f"],
		["add", `${classes}\\DefaultIcon`, "/ve", "/d", `${quote(target.exe)},0`, "/f"],
		// The app picker reads these. Without them it shows the exe's description ("Electron" in preview).
		["add", `${classes}\\Application`, "/v", "ApplicationName", "/d", target.name, "/f"],
		["add", `${classes}\\Application`, "/v", "ApplicationIcon", "/d", `${quote(target.exe)},0`, "/f"],
		["add", `${classes}\\shell\\open\\command`, "/ve", "/d", command, "/f"],
		["add", capabilities, "/v", "ApplicationName", "/d", target.name, "/f"],
		["add", capabilities, "/v", "ApplicationDescription", "/d", "Read and write email with Raven.", "/f"],
		["add", `${capabilities}\\URLAssociations`, "/v", "mailto", "/d", target.progId, "/f"],
		["add", "HKCU\\Software\\RegisteredApplications", "/v", target.name, "/d", `Software\\${target.key}\\Capabilities`, "/f"],
	];
}

/**
 * `reg.exe` argument lists that undo `windowsMailRegistration`, for
 * `desktop:forget-links`. The listing goes first, so the app picker never
 * points at a missing key. Installed Raven's keys are the uninstaller's job.
 */
export function windowsMailUnregistration(target: Pick<WindowsMailApp, "name" | "key" | "progId">): string[][] {
	return [
		["delete", "HKCU\\Software\\RegisteredApplications", "/v", target.name, "/f"],
		["delete", `HKCU\\Software\\${target.key}`, "/f"],
		["delete", `HKCU\\Software\\Classes\\${target.progId}`, "/f"],
	];
}

/** The raven:// handler Electron's `setAsDefaultProtocolClient` writes on Windows. */
export const WINDOWS_RAVEN_CLASS = "HKCU\\Software\\Classes\\raven";

/**
 * Whether `reg query <WINDOWS_RAVEN_CLASS>\shell\open\command /ve` output is
 * a dev or preview build's claim. Only unpackaged builds pass `--raven-mode`.
 */
export function unpackagedRavenClaim(output: string): boolean {
	return /REG_SZ\s.*\s"?--raven-mode=/i.test(output);
}

/** Where Windows keeps the user's pick for email links. */
export const WINDOWS_MAILTO_CHOICE = "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice";

/** The ProgId in `reg query <WINDOWS_MAILTO_CHOICE> /v ProgId` output, or null. */
export function userChoiceProgId(output: string): string | null {
	return /^\s*ProgId\s+REG_SZ\s+(\S.*?)\s*$/im.exec(output)?.[1] ?? null;
}
