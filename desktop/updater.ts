import { dialog, shell } from "electron";
import { autoUpdater, BaseUpdater, type UpdateInfo } from "electron-updater";
import type { UpdateAction, UpdateCheck, UpdateState } from "./bridge";
import type { Log } from "./log";
import { NO_UPDATE, checkAnswer, nextUpdateState, updateActionAllowed, type CheckOutcome, type UpdateEvent } from "./update-state";
import { CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS, releasePage, type UpdateMode } from "./update-policy";

/*
 * Checks GitHub Releases for a newer Raven at start and every 6 hours, and
 * from "Check for updates…". In auto mode it downloads in the background, and
 * the page's pill (or a notification, while the window is hidden) offers to
 * restart. The installer only ever starts after Raven has shut down
 * (windows closed, server stopped): on update, the Windows installer kills
 * every Raven process it finds, and the server could be writing the local
 * database. macOS hands the install to Squirrel, which waits for Raven to exit.
 */

export type UpdaterHooks = {
	log: Log;
	/**
	 * Every change the page's pill shows. `announce` is false when the user
	 * is already looking at an answer (a check from the menu).
	 */
	onState(state: UpdateState, announce: boolean): void;
	/** Quit, then install and start the new version. */
	restartToUpdate(): void;
};

export type Updater = {
	readonly mode: UpdateMode;
	start(): void;
	/** From the menu: says what it found, even when there's nothing new. */
	checkNow(): void;
	/** From Settings: the same check, but the answer goes to the page and no dialog opens. */
	check(): Promise<UpdateCheck>;
	/** Where the update stands now, for a page that just loaded. */
	state(): UpdateState;
	/** The pill was clicked. Ignored unless the state allows it. */
	act(action: UpdateAction): void;
	/**
	 * The last step of quitting, once the server has stopped. Starts the
	 * downloaded update's installer, if there is one, and says how long to
	 * wait before app.exit (0: exit now).
	 */
	installOnQuit(restart: boolean): number;
};

/**
 * electron-updater's code for a 404 on the latest release's latest*.yml. (Its
 * "latest version not found" code also covers being offline, so it isn't here.)
 */
const NO_UPDATE_FEED = new Set(["ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"]);

export function createUpdater(mode: UpdateMode, hooks: UpdaterHooks): Updater {
	const { log } = hooks;
	if (mode === "off") return { mode, start() {}, checkNow() {}, check: async () => "off", state: () => NO_UPDATE, act() {}, installOnQuit: () => 0 };

	// One truth for the pill, the menu and quitting: electron-updater deletes a ready installer once a newer one starts downloading.
	let state = NO_UPDATE;
	const ready = (): string | null => (state.kind === "ready" ? state.version : null);
	let checkingByHand = false;
	let firstCheck: ReturnType<typeof setTimeout> | undefined;
	let everyFewHours: ReturnType<typeof setInterval> | undefined;

	autoUpdater.logger = { info: (m) => log.info(`updater: ${String(m)}`), warn: (m) => log.info(`updater warning: ${String(m)}`), error: (m) => log.info(`updater error: ${String(m)}`) };
	autoUpdater.autoDownload = mode === "auto";
	// Windows and Linux install from installOnQuit, after the server stopped. Squirrel.Mac waits for the app to exit by itself.
	autoUpdater.autoInstallOnAppQuit = process.platform === "darwin";
	autoUpdater.allowPrerelease = false;
	autoUpdater.allowDowngrade = false;
	autoUpdater.disableWebInstaller = true;
	autoUpdater.fullChangelog = false;

	function emit(event: UpdateEvent, announce = true): void {
		const next = nextUpdateState(state, event, mode === "auto");
		if (next === state) return;
		state = next;
		hooks.onState(state, announce);
	}

	// Without a listener, an "error" event would throw. Failed checks are logged, and a failed download hides the pill.
	autoUpdater.on("error", (err: Error) => {
		log.info(`update failed: ${err.message.split("\n")[0]}`);
		emit({ type: "error" });
	});
	// In auto mode the download starts by itself; the pill shows its progress, then "Restart to update".
	autoUpdater.on("update-available", (info: UpdateInfo) => emit({ type: "available", version: info.version }, !checkingByHand));
	autoUpdater.on("download-progress", (progress: { percent: number }) => emit({ type: "progress", percent: progress.percent }));
	autoUpdater.on("update-downloaded", (info: UpdateInfo) => emit({ type: "downloaded", version: info.version }));

	function openReleasePage(version: unknown): void {
		void shell.openExternal(releasePage(version));
	}

	async function askToRestart(version: string): Promise<void> {
		const { response } = await dialog.showMessageBox({
			type: "info",
			title: "Raven",
			message: `Raven ${version} is ready.`,
			detail: "Restart Raven to finish the update. If you don't, it updates the next time you quit.",
			buttons: ["Restart now", "Later"],
			defaultId: 0,
			cancelId: 1,
		});
		// A newer version may have started downloading while the dialog was open, deleting this installer.
		if (response === 0 && ready() === version) hooks.restartToUpdate();
	}

	function check(): void {
		autoUpdater.checkForUpdates().catch(() => {
			// Already logged by the "error" listener.
		});
	}

	/** A check someone asked for, from the menu or from Settings. Tells no one: the caller does. */
	async function look(): Promise<CheckOutcome> {
		const version = ready();
		if (version) return { kind: "ready", version };
		try {
			checkingByHand = true;
			const result = await autoUpdater.checkForUpdates().finally(() => (checkingByHand = false));
			return result?.isUpdateAvailable ? { kind: "found", version: result.updateInfo.version } : { kind: "current" };
		} catch (err) {
			// The latest release has no update files: one made before the desktop app updated itself.
			return NO_UPDATE_FEED.has((err as { code?: unknown }).code as string) ? { kind: "no-feed" } : { kind: "failed" };
		}
	}

	async function checkNow(): Promise<void> {
		const found = await look();
		if (found.kind === "ready") return askToRestart(found.version);
		if (found.kind !== "found") {
			const failed = found.kind === "failed";
			await dialog.showMessageBox({
				type: failed ? "warning" : "info",
				title: "Raven",
				message: failed ? "Raven couldn't check for updates." : found.kind === "no-feed" ? "There's no update for Raven yet." : "You have the newest version of Raven.",
				detail: failed ? "Check your connection and try again." : `Version ${autoUpdater.currentVersion.version}`,
				buttons: ["OK"],
			});
			return;
		}
		if (mode === "auto") {
			// The pill offers to restart once "update-downloaded" fires.
			await dialog.showMessageBox({ type: "info", title: "Raven", message: `Raven ${found.version} is downloading.`, detail: "Raven tells you when it's ready.", buttons: ["OK"] });
			return;
		}
		const { response } = await dialog.showMessageBox({
			type: "info",
			title: "Raven",
			message: `Raven ${found.version} is out.`,
			detail: "Download it from its release page and install it over this one.",
			buttons: ["Open the download page", "Later"],
			defaultId: 0,
			cancelId: 1,
		});
		if (response === 0) openReleasePage(found.version);
	}

	return {
		mode,
		start() {
			firstCheck = setTimeout(check, FIRST_CHECK_DELAY_MS);
			everyFewHours = setInterval(check, CHECK_EVERY_MS);
		},
		checkNow() {
			void checkNow().catch((err: unknown) => log.info(`update check: ${String(err)}`));
		},
		check: async () => checkAnswer(await look()),
		state: () => state,
		act(action) {
			if (!updateActionAllowed(state, action)) return log.info(`ignored update action "${action}" (${state.kind})`);
			if (action === "restart") hooks.restartToUpdate();
			else if (state.kind === "available") openReleasePage(state.version);
		},
		installOnQuit(restart) {
			clearTimeout(firstCheck);
			clearInterval(everyFewHours);
			const version = ready();
			if (!version || mode !== "auto") return 0;
			log.info(`installing Raven ${version}${restart ? " and restarting" : ""}`);
			if (process.platform === "darwin") {
				// Squirrel installs what it staged when Raven exits; quitAndInstall also starts it again
				// and quits Raven itself, once its own copy of the update is ready. The wait is a fallback.
				if (!restart) return 0;
				autoUpdater.quitAndInstall();
				return 60_000;
			}
			// Silent: the user already chose. NSIS starts Raven again with --force-run; an AppImage spawns the new file.
			if (autoUpdater instanceof BaseUpdater) autoUpdater.install(true, restart);
			// A failed spawn is reported (and retried with elevate.exe) a tick later; give it a moment,
			// well under the 1.3 s the installer waits before closing Raven. Not on Linux: the new
			// AppImage is already starting and must find the single-instance lock free.
			return process.platform === "win32" ? 500 : 0;
		},
	};
}
