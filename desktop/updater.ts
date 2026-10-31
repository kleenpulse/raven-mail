import { dialog, shell } from "electron";
import { autoUpdater, BaseUpdater, type UpdateInfo } from "electron-updater";
import type { Log } from "./log";
import { CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS, releasePage, type UpdateMode } from "./update-policy";

/*
 * Checks GitHub Releases for a newer Raven at start and every 6 hours, and
 * from "Check for updates…". In auto mode it downloads in the background and
 * asks to restart. The installer only ever starts after Raven has shut down
 * (windows closed, server stopped): on update, the Windows installer kills
 * every Raven process it finds, and the server could be writing the local
 * database. macOS hands the install to Squirrel, which waits for Raven to exit.
 */

export type UpdaterHooks = {
	log: Log;
	notify(title: string, body: string, onClick: () => void): void;
	/** Quit, then install and start the new version. */
	restartToUpdate(): void;
};

export type Updater = {
	readonly mode: UpdateMode;
	start(): void;
	/** From the menu: says what it found, even when there's nothing new. */
	checkNow(): void;
	/**
	 * The last step of quitting, once the server has stopped. Starts the
	 * downloaded update's installer, if there is one. "app-quits" means the
	 * updater quits the app itself (macOS), so don't call app.exit.
	 */
	installOnQuit(restart: boolean): "app-quits" | "exit";
};

export function createUpdater(mode: UpdateMode, hooks: UpdaterHooks): Updater {
	const { log } = hooks;
	if (mode === "off") return { mode, start() {}, checkNow() {}, installOnQuit: () => "exit" };

	let ready: string | null = null;
	const announced = new Set<string>();
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

	// Without a listener, an "error" event would throw. Failed checks are only logged.
	autoUpdater.on("error", (err: Error) => log.info(`update failed: ${err.message.split("\n")[0]}`));
	autoUpdater.on("update-available", (info: UpdateInfo) => {
		if (mode !== "notify" || announced.has(info.version)) return;
		announced.add(info.version);
		hooks.notify(`Raven ${info.version} is out.`, "Click to open the download page.", () => openReleasePage(info.version));
	});
	autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
		const first = ready !== info.version;
		ready = info.version;
		if (first) void askToRestart(info.version);
	});

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
		if (response === 0) hooks.restartToUpdate();
	}

	function check(): void {
		autoUpdater.checkForUpdates().catch(() => {
			// Already logged by the "error" listener.
		});
	}

	async function checkNow(): Promise<void> {
		if (ready) return askToRestart(ready);
		let found: UpdateInfo | null = null;
		try {
			const result = await autoUpdater.checkForUpdates();
			found = result?.isUpdateAvailable ? result.updateInfo : null;
			if (!found) {
				await dialog.showMessageBox({ type: "info", title: "Raven", message: "You have the newest version of Raven.", detail: `Version ${autoUpdater.currentVersion.version}`, buttons: ["OK"] });
				return;
			}
		} catch {
			await dialog.showMessageBox({
				type: "warning",
				title: "Raven",
				message: "Raven couldn't check for updates.",
				detail: "Check your connection and try again.",
				buttons: ["OK"],
			});
			return;
		}
		if (mode === "auto") {
			// "update-downloaded" asks to restart once it's down.
			await dialog.showMessageBox({ type: "info", title: "Raven", message: `Raven ${found.version} is downloading.`, detail: "Raven tells you when it's ready.", buttons: ["OK"] });
			return;
		}
		announced.add(found.version);
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
		installOnQuit(restart) {
			clearTimeout(firstCheck);
			clearInterval(everyFewHours);
			if (!ready || mode !== "auto") return "exit";
			log.info(`installing Raven ${ready}${restart ? " and restarting" : ""}`);
			if (process.platform === "darwin") {
				// Squirrel installs what it staged when Raven exits; quitAndInstall also starts it again.
				if (!restart) return "exit";
				autoUpdater.quitAndInstall();
				return "app-quits";
			}
			// Silent: the user already chose. NSIS starts Raven again with --force-run; an AppImage spawns the new file.
			if (autoUpdater instanceof BaseUpdater) autoUpdater.install(true, restart);
			return "exit";
		},
	};
}
