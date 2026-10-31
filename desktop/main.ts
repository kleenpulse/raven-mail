import { app, BrowserWindow, dialog, Menu, Notification, screen, session, shell, type MenuItemConstructorOptions, type Session, type WebContents } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { latestBackup } from "./backups";
import { contentSecurityPolicy, withCsp } from "./csp";
import { serverEnv } from "./env";
import { hasTray, onAllWindowsClosed, onWindowClose, showTrayHint, type Lifecycle } from "./lifecycle";
import { createLog } from "./log";
import { classifyUrl } from "./policy";
import { electronSealer } from "./sealer";
import { fileStore, loadSecrets, resetSecrets, type Secrets } from "./secrets";
import { freePort, isPortFree, savePort, savedPort } from "./ports";
import { delay, ServerStartError, startDevServer, startStandaloneServer, type ServerHandle } from "./server-process";
import { loadSettings, saveSettings, type DesktopSettings } from "./settings";
import { TOKEN_HEADER } from "./shared";
import { createTray, KEEP_RUNNING_LABEL, type RavenTray } from "./tray";
import { loadWindowState, MIN_SIZE, placeWindow, saveWindowState, type Rect } from "./window-state";

/*
 * Raven's desktop shell. The Next.js server runs as a separate process on
 * 127.0.0.1; this main process owns the window, the session and the server's
 * lifetime. Requests to the server carry a per-launch token that only this
 * process knows (see desktop/README.md).
 */

type Mode = "dev" | "preview" | "packaged";

const mode: Mode = app.isPackaged ? "packaged" : process.env.RAVEN_DESKTOP_MODE === "preview" ? "preview" : "dev";
const USER_DATA: Record<Mode, string> = { dev: "Raven Dev", preview: "Raven Preview", packaged: "Raven" };
const APP_ID = "io.github.kleenpulse.raven";
const START_PATH = "/overview";

// Set before the single-instance lock: the lock lives in userData.
app.setName("Raven");
app.setPath("userData", join(app.getPath("appData"), USER_DATA[mode]));
if (!app.isPackaged && process.env.RAVEN_DEBUG_PORT) {
	app.commandLine.appendSwitch("remote-debugging-port", process.env.RAVEN_DEBUG_PORT);
}

if (app.isPackaged && (app.commandLine.hasSwitch("remote-debugging-port") || app.commandLine.hasSwitch("remote-debugging-pipe"))) {
	// A debugging port would let any local program drive the signed-in window.
	app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
	app.exit(0);
} else {
	boot();
}

function boot(): void {
	app.enableSandbox();
	if (process.platform === "win32") app.setAppUserModelId(APP_ID);

	const userData = app.getPath("userData");
	const logs = join(userData, "logs");
	const log = createLog(logs, "main.log", !app.isPackaged);
	const token = randomBytes(32).toString("base64url");
	const inFlight = new Set<number>();

	let server: ServerHandle | null = null;
	let secrets: Secrets | null = null;
	let appOrigin: string | null = null;
	let mainWindow: BrowserWindow | null = null;
	let quitting: "no" | "closing" | "done" = "no";
	// Windows is logging off or shutting down: windows must close, not hide.
	let sessionEnding = false;
	let settings: DesktopSettings = loadSettings(userData);
	let tray: RavenTray | null = null;

	log.info(`starting (${mode}, Electron ${process.versions.electron})`);

	const lifecycle = (): Lifecycle => ({ keepRunning: settings.keepRunning, quitting: quitting !== "no" || sessionEnding, platform: process.platform });

	app.on("second-instance", () => showWindow());
	app.on("web-contents-created", (_event, contents) => harden(contents));
	app.on("window-all-closed", () => {
		// macOS apps stay open without windows; the server keeps running.
		if (onAllWindowsClosed(lifecycle()) === "quit") app.quit();
	});
	// The Dock icon on macOS.
	app.on("activate", () => showWindow());
	app.on("before-quit", (event) => {
		if (quitting === "done") return;
		event.preventDefault();
		if (quitting === "closing") return;
		quitting = "closing";
		void shutdown().then((ok) => {
			if (!ok) {
				quitting = "no";
				return;
			}
			quitting = "done";
			tray?.destroy();
			app.exit(0);
		});
	});

	app
		.whenReady()
		.then(start)
		.catch((err: unknown) => fail(err));

	async function start(): Promise<void> {
		Menu.setApplicationMenu(buildMenu(settings.keepRunning, setKeepRunning));
		if (hasTray(process.platform)) {
			tray = createTray({ open: showWindow, keepRunning: () => settings.keepRunning, setKeepRunning, quit: () => app.quit() });
		}
		hardenSession(session.defaultSession);
		createWindow();
		secrets = await loadOrAskSecrets();
		server = await startServerOrRecover();
		attach(server);
		await mainWindow?.loadURL(`${server.origin}${START_PATH}`);
	}

	/** Starts the server; `restoreFrom` names a database backup to fill the (empty) data folder from. */
	async function startServer(restoreFrom?: string): Promise<ServerHandle> {
		if (!secrets) throw new Error("secrets not loaded");
		const port = await pickPort();
		const serverLog = createLog(logs, "server.log", !app.isPackaged);
		if (mode === "dev") {
			const repoRoot = process.env.RAVEN_REPO_ROOT;
			if (!repoRoot) throw new ServerStartError("Start dev mode with `bun run desktop:dev`.");
			const env = serverEnv(process.env, { mode: "dev", port, token, dataDir: join(userData, "db"), secrets, restoreFrom });
			return startDevServer({ repoRoot, port, token, env, log: serverLog });
		}
		// Packaged: resources/server. Preview: desktop/.stage/server next to the staged app.
		const serverDir = app.isPackaged ? join(process.resourcesPath, "server") : join(app.getAppPath(), "..", "server");
		const env = serverEnv(process.env, { mode: "prod", port, token, dataDir: join(userData, "db"), secrets, restoreFrom });
		const handle = await startStandaloneServer({ serverDir, port, env, log: serverLog });
		if (handle.port !== port) {
			log.info(`port ${port} was taken; the server moved to ${handle.port}. Data the window keeps per origin starts fresh.`);
			savePort(userData, handle.port);
		}
		return handle;
	}

	/**
	 * Starts the server; if the local database won't open (after a crash, for
	 * example), offers to go back to the copy saved before its last update,
	 * or to move it aside and start with an empty one.
	 */
	async function startServerOrRecover(): Promise<ServerHandle> {
		try {
			return await startServer();
		} catch (err) {
			if (!(err instanceof ServerStartError && err.localDb)) throw err;
			log.info(`local database trouble: ${err.message}`);
			const db = join(userData, "db");
			const backup = latestBackup(db);
			const when = backup?.at.toLocaleString();
			const fresh =
				"put the database aside (it keeps a copy in its data folder) and start with an empty one. Your mail isn't affected, but integrations, rules, blocked senders and reminders will need setting up again.";
			const { response } = await dialog.showMessageBox({
				type: "error",
				title: "Raven",
				message: "Raven's local database didn't open.",
				detail: backup
					? `Raven can go back to the copy it saved on ${when}, before the database was last updated. Or it can ${fresh}`
					: `Raven can ${fresh}`,
				buttons: backup ? [`Go back to the copy from ${when}`, "Start fresh", "Quit"] : ["Put it aside and start fresh", "Quit"],
				defaultId: 0,
				cancelId: backup ? 2 : 1,
			});
			const restore = backup !== null && response === 0;
			if (!restore && response !== (backup ? 1 : 0)) throw err;
			if (existsSync(db)) renameSync(db, `${db}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`);
			if (restore) log.info(`restoring the local database from ${backup.path}`);
			return startServer(restore ? backup.path : undefined);
		}
	}

	/** The per-install secrets; asks before replacing them if the keychain changed. */
	async function loadOrAskSecrets(): Promise<Secrets> {
		const sealer = await electronSealer();
		if (!sealer.protects) {
			log.info(`warning: no keyring (${sealer.backend}); Raven's secrets are stored unencrypted, readable only by this user. Install GNOME Keyring or KWallet to protect them.`);
		}
		const store = fileStore(join(userData, "secrets.json"));
		let result = await loadSecrets(store, sealer);
		if (result.kind === "keychain-changed" || result.kind === "keychain-unavailable") {
			const why =
				result.kind === "keychain-changed"
					? `They were locked with "${result.was}", and this system now uses "${result.now}". If you switch back, Raven can open them again.`
					: "They're locked with your system's keychain, and it isn't available right now. Quit and try again once it's back.";
			log.info(result.kind === "keychain-changed" ? `keychain changed from ${result.was} to ${result.now}` : `keychain unavailable (${result.backend})`);
			const { response } = await dialog.showMessageBox({
				type: "warning",
				title: "Raven",
				message: "Raven can't open its saved keys.",
				detail: `${why} Starting fresh signs you out, and saved integrations, rules, blocked senders and reminders can't be read anymore.`,
				buttons: ["Quit", "Start fresh"],
				defaultId: 0,
				cancelId: 0,
			});
			if (response !== 1) {
				quitting = "done";
				app.exit(0);
				return new Promise<never>(() => {});
			}
			result = await resetSecrets(store, sealer);
		}
		if (result.kind !== "ok") throw new Error("secrets unavailable");
		if (result.reset) log.info("the secrets file couldn't be read; made new ones (signed out, stored rows unreadable)");
		return result.secrets;
	}

	/** The saved port, unless something else holds it for more than ~2 s. */
	async function pickPort(): Promise<number> {
		const saved = savedPort(userData);
		if (saved) {
			for (let i = 0; i < 10; i++) {
				if (await isPortFree(saved)) return saved;
				await delay(200);
			}
		}
		const port = await freePort();
		if (saved) log.info(`port ${saved} is taken; moving to ${port}. Data the window keeps per origin (prefs, drafts) starts fresh.`);
		savePort(userData, port);
		return port;
	}

	function attach(handle: ServerHandle): void {
		appOrigin = handle.origin;
		routeToken(session.defaultSession, handle.origin);
		handle.onExit((detail) => void serverDied(detail));
		log.info(`server ready at ${handle.origin}`);
	}

	async function serverDied(detail: string): Promise<void> {
		log.info(`server stopped: ${detail}`);
		if (quitting !== "no") return;
		const { response } = await dialog.showMessageBox({
			type: "error",
			title: "Raven",
			message: "Raven's background server stopped.",
			detail: `You can restart it, or quit and look at the log:\n${join(logs, "server.log")}`,
			buttons: ["Restart", "Quit"],
			defaultId: 0,
			cancelId: 1,
		});
		if (response !== 0) return app.quit();
		try {
			server = await startServerOrRecover();
			attach(server);
			for (const win of BrowserWindow.getAllWindows()) win.reload();
		} catch (err) {
			await fail(err);
		}
	}

	async function fail(err: unknown): Promise<void> {
		const message = err instanceof ServerStartError ? err.message : "Raven couldn't start.";
		log.info(`start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
		await dialog.showMessageBox({
			type: "error",
			title: "Raven",
			message,
			detail: `Logs: ${logs}`,
			buttons: ["Quit"],
		});
		quitting = "done";
		await server?.stop();
		app.exit(1);
	}

	/** Close windows (honouring "Stay"), let pagehide requests land, then stop the server. */
	async function shutdown(): Promise<boolean> {
		if (!(await closeWindows())) return false;
		await delay(300);
		const idleBy = Date.now() + 2000;
		while (inFlight.size > 0 && Date.now() < idleBy) await delay(50);
		await session.defaultSession.cookies.flushStore();
		await server?.stop();
		log.info("stopped");
		return true;
	}

	/** Brings the window back from the tray, the Dock or a minimise (or makes it again on macOS). */
	function showWindow(): void {
		if (!mainWindow || mainWindow.isDestroyed()) {
			if (appOrigin) createWindow();
			return;
		}
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}

	function setKeepRunning(on: boolean): void {
		updateSettings({ keepRunning: on });
		Menu.setApplicationMenu(buildMenu(on, setKeepRunning));
		tray?.refresh();
		// A hidden window still checks for mail at full pace (and keeps `visibilityState` "visible").
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setBackgroundThrottling(!on);
	}

	function updateSettings(change: Partial<DesktopSettings>): void {
		settings = { ...settings, ...change };
		try {
			saveSettings(userData, settings);
		} catch (err) {
			log.info(`couldn't save the settings: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** Closing hides the window while "keep running" is on; quitting closes it for real. */
	function hideOnClose(win: BrowserWindow): void {
		win.on("close", (event) => {
			const state = lifecycle();
			const action = onWindowClose(state);
			if (action === "close") return;
			event.preventDefault();
			if (process.platform === "darwin" && win.isFullScreen()) {
				// A full-screen window hidden on macOS leaves a black space behind.
				win.once("leave-full-screen", () => win.hide());
				win.setFullScreen(false);
			} else {
				win.hide();
			}
			if (showTrayHint(state, action, settings.trayHintShown)) {
				updateSettings({ trayHintShown: true });
				notify("Raven is still checking your mail.", "Open it from the tray.", showWindow);
			}
		});
	}

	function notify(title: string, body: string, onClick: () => void): void {
		if (!Notification.isSupported()) return;
		const notice = new Notification({ title, body, icon: join(app.getAppPath(), "icon.png") });
		notice.on("click", onClick);
		notice.show();
	}

	function createWindow(): BrowserWindow {
		const place = placeWindow(loadWindowState(userData), screenAreas());
		const win = new BrowserWindow({
			width: place.width,
			height: place.height,
			...(place.x !== undefined && place.y !== undefined ? { x: place.x, y: place.y } : {}),
			minWidth: MIN_SIZE.width,
			minHeight: MIN_SIZE.height,
			show: false,
			title: "Raven",
			backgroundColor: "#050a0b",
			autoHideMenuBar: process.platform !== "darwin",
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				devTools: !app.isPackaged,
				spellcheck: true,
				backgroundThrottling: !settings.keepRunning,
				// Bundled next to main.js; Bun.build bakes __dirname in as the source folder, so ask Electron.
				preload: join(app.getAppPath(), "preload.js"),
			},
		});
		win.once("ready-to-show", () => {
			if (!place.maximized) return win.show();
			// maximize() shows the window too, but doesn't focus it.
			win.maximize();
			win.focus();
		});
		rememberPlace(win);
		hideOnClose(win);
		// Windows log-off or shutdown: stop the server cleanly while we still can.
		win.on("session-end", () => {
			sessionEnding = true;
			void Promise.allSettled([session.defaultSession.cookies.flushStore(), server?.stop()]);
		});
		void win.loadURL(appOrigin ? `${appOrigin}${START_PATH}` : SPLASH);
		mainWindow = win;
		return win;
	}

	/** Saves the window's size and place a moment after it changes, and when it closes. */
	function rememberPlace(win: BrowserWindow): void {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const save = () => {
			clearTimeout(timer);
			if (win.isDestroyed()) return;
			try {
				saveWindowState(userData, { bounds: win.getNormalBounds(), maximized: win.isMaximized() });
			} catch (err) {
				log.info(`couldn't save the window's place: ${err instanceof Error ? err.message : String(err)}`);
			}
		};
		const later = () => {
			clearTimeout(timer);
			timer = setTimeout(save, 500);
		};
		win.on("resize", later);
		win.on("move", later);
		win.on("maximize", later);
		win.on("unmaximize", later);
		win.on("close", save);
	}

	function hardenSession(ses: Session): void {
		ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
			callback(ALLOWED_PERMISSIONS.has(permission) && classifyUrl(details.requestingUrl, appOrigin).kind === "app");
		});
		ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
			return ALLOWED_PERMISSIONS.has(permission) && appOrigin !== null && requestingOrigin === appOrigin;
		});
	}

	/**
	 * Adds the token to requests for the server only (never to remote images
	 * or other sites), tracks them, and adds the CSP to the server's responses.
	 */
	function routeToken(ses: Session, origin: string): void {
		const filter = { urls: [`${origin}/*`] };
		ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
			const requestHeaders = details.requestHeaders;
			if (new URL(details.url).origin === origin) requestHeaders[TOKEN_HEADER] = token;
			callback({ requestHeaders });
		});
		ses.webRequest.onSendHeaders(filter, (details) => void inFlight.add(details.id));
		ses.webRequest.onCompleted(filter, (details) => void inFlight.delete(details.id));
		ses.webRequest.onErrorOccurred(filter, (details) => void inFlight.delete(details.id));
		// `next dev` needs eval and its HMR websocket, so dev runs without the policy.
		if (mode !== "dev") {
			const policy = contentSecurityPolicy();
			ses.webRequest.onHeadersReceived(filter, (details, callback) => {
				if (new URL(details.url).origin !== origin) return callback({});
				callback({ responseHeaders: withCsp(details.responseHeaders, policy) });
			});
		}
	}

	function harden(contents: WebContents): void {
		contents.setWindowOpenHandler(({ url }) => {
			const destination = classifyUrl(url, appOrigin);
			if (destination.kind === "app") {
				return {
					action: "allow",
					overrideBrowserWindowOptions: {
						autoHideMenuBar: true,
						webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
					},
				};
			}
			if (destination.kind === "external") void shell.openExternal(destination.url);
			return { action: "deny" };
		});
		const guard = (event: { preventDefault(): void }, url: string) => {
			const destination = classifyUrl(url, appOrigin);
			if (destination.kind === "app") return;
			event.preventDefault();
			if (destination.kind === "external") void shell.openExternal(destination.url);
		};
		contents.on("will-navigate", (event, url) => guard(event, url));
		contents.on("will-redirect", (event, url) => guard(event, url));
		contents.on("will-attach-webview", (event) => event.preventDefault());
		// Undo-send and mailbox export block leaving with beforeunload; Electron
		// would silently keep the window open, so ask instead.
		contents.on("will-prevent-unload", (event) => {
			const win = BrowserWindow.fromWebContents(contents);
			const options = {
				type: "question" as const,
				title: "Raven",
				message: "Raven is still working.",
				detail: "A message may still be sending, or an export may still be running. If you leave now, it may not finish.",
				buttons: ["Stay", "Leave"],
				defaultId: 0,
				cancelId: 0,
			};
			const choice = win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options);
			if (choice === 1) event.preventDefault();
		});
	}
}

/** Every display's work area, primary first. */
function screenAreas(): Rect[] {
	const primary = screen.getPrimaryDisplay();
	return [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)].map((display) => display.workArea);
}

/** Resolves true once every window is gone, false if one stayed open (the user chose "Stay"). */
async function closeWindows(): Promise<boolean> {
	await Promise.all(
		BrowserWindow.getAllWindows().map(
			(win) =>
				new Promise<void>((resolve) => {
					if (win.isDestroyed()) return resolve();
					win.once("closed", () => resolve());
					setTimeout(resolve, 3000);
					win.close();
				}),
		),
	);
	return BrowserWindow.getAllWindows().length === 0;
}

function buildMenu(keepRunning: boolean, setKeepRunning: (on: boolean) => void): Menu {
	const keepRunningItem: MenuItemConstructorOptions = {
		label: KEEP_RUNNING_LABEL,
		type: "checkbox",
		checked: keepRunning,
		click: (item) => setKeepRunning(item.checked),
	};
	const appMenu: MenuItemConstructorOptions = {
		label: app.name,
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			keepRunningItem,
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" },
		],
	};
	const fileMenu: MenuItemConstructorOptions = {
		label: "File",
		submenu: [keepRunningItem, { type: "separator" }, { role: "quit", label: "Quit Raven" }],
	};
	const view: MenuItemConstructorOptions[] = [
		{ role: "reload" },
		{ role: "forceReload" },
		...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as const]),
		{ type: "separator" },
		{ role: "resetZoom" },
		{ role: "zoomIn" },
		{ role: "zoomOut" },
		{ type: "separator" },
		{ role: "togglefullscreen" },
	];
	return Menu.buildFromTemplate([
		process.platform === "darwin" ? appMenu : fileMenu,
		{ role: "editMenu" },
		{ label: "View", submenu: view },
		{ role: "windowMenu" },
	]);
}

// Not geolocation: Electron's location service needs a Google API key, so it
// only ever fails, and a denial at least tells the weather card to stop asking.
const ALLOWED_PERMISSIONS = new Set<string>(["clipboard-sanitized-write", "fullscreen", "fileSystem"]);

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(
	`<!doctype html><meta charset="utf-8"><title>Raven</title><style>html,body{height:100%;margin:0;background:#050a0b;color:#9aa3a5;font:14px system-ui,sans-serif;display:grid;place-items:center}</style><p>Starting Raven…</p>`,
)}`;
