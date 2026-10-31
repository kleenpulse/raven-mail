/*
 * How the desktop app updates. New versions come from published GitHub
 * Releases on kleenpulse/raven-mail: CI uploads a draft, and a person
 * publishes it (desktop/RELEASING.md). Drafts are invisible to the updater.
 */

/**
 * - auto: download in the background, ask to restart, install on quit.
 * - notify: say a new version is out and link to its release page.
 * - off: dev and preview runs.
 */
export type UpdateMode = "auto" | "notify" | "off";

export type UpdateContext = {
	packaged: boolean;
	platform: NodeJS.Platform;
	/** Really signed (ravenBuild.signed in the app's package.json), not ad hoc. */
	signed: boolean;
	/** Linux: running from an AppImage ($APPIMAGE is set). */
	appImage: boolean;
};

export function updateMode({ packaged, platform, signed, appImage }: UpdateContext): UpdateMode {
	if (!packaged) return "off";
	// The NSIS installer updates itself; until it's signed, trust is HTTPS plus the sha512 in latest.yml.
	if (platform === "win32") return "auto";
	// Squirrel.Mac only installs an update signed by the same Developer ID.
	if (platform === "darwin") return signed ? "auto" : "notify";
	// An AppImage replaces itself; a .deb needs root, so its users install the new one.
	if (platform === "linux") return appImage ? "auto" : "notify";
	return "off";
}

/** The first check waits for a quiet moment after start. */
export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export const RELEASES_URL = "https://github.com/kleenpulse/raven-mail/releases";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The release page for a version the update feed named, or the latest release if it looks wrong. */
export function releasePage(version: unknown): string {
	return typeof version === "string" && VERSION.test(version) ? `${RELEASES_URL}/tag/v${version}` : `${RELEASES_URL}/latest`;
}

/** ravenBuild from the app's package.json, written by scripts/build.ts. Anything unexpected reads as unsigned. */
export function parseBuildInfo(text: string | null): { signed: boolean } {
	if (!text) return { signed: false };
	try {
		const build = (JSON.parse(text) as { ravenBuild?: { signed?: unknown } }).ravenBuild;
		return { signed: build?.signed === true };
	} catch {
		return { signed: false };
	}
}
