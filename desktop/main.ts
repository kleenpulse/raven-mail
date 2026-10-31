import { app, BrowserWindow, dialog, Menu, session, shell, type MenuItemConstructorOptions, type Session, type WebContents } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { serverEnv } from "./env";
import { createLog } from "./log";
import { classifyUrl } from "./policy";
import { electronSealer } from "./sealer";
import { fileStore, loadSecrets, resetSecrets, type Secrets } from "./secrets";
import { freePort, isPortFree, savePort, savedPort } from "./ports";
import { delay, ServerStartError, startDevServer, startStandaloneServer, type ServerHandle } from "./server-process";
import { TOKEN_HEADER } from "./shared";

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

	log.info(`starting (${mode}, Electron ${process.versions.electron})`);

	app.on("second-instance", () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});
	app.on("web-contents-created", (_event, contents) => harden(contents));
	app.on("window-all-closed", () => {
		// macOS apps stay open without windows; the server keeps running.
		if (process.platform !== "darwin") app.quit();
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0 && appOrigin) createWindow();
	});
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
			app.exit(0);
		});
	});

	app
		.whenReady()
		.then(start)
		.catch((err: unknown) => fail(err));

	async function start(): Promise<void> {
		Menu.setApplicationMenu(buildMenu());
		hardenSession(session.defaultSession);
		createWindow();
		secrets = await loadOrAskSecrets();
		server = await startServerOrRecover();
		attach(server);
		await mainWindow?.loadURL(`${server.origin}${START_PATH}`);
	}

	async function startServer(): Promise<ServerHandle> {
		if (!secrets) throw new Error("secrets not loaded");
		const port = await pickPort();
		const serverLog = createLog(logs, "server.log", !app.isPackaged);
		if (mode === "dev") {
			const repoRoot = process.env.RAVEN_REPO_ROOT;
			if (!repoRoot) throw new ServerStartError("Start dev mode with `bun run desktop:dev`.");
			const env = serverEnv(process.env, { mode: "dev", port, token, dataDir: join(userData, "db"), secrets });
			return startDevServer({ repoRoot, port, token, env, log: serverLog });
		}
		// Packaged: resources/server. Preview: desktop/.stage/server next to the staged app.
		const serverDir = app.isPackaged ? join(process.resourcesPath, "server") : join(app.getAppPath(), "..", "server");
		const env = serverEnv(process.env, { mode: "prod", port, token, dataDir: join(userData, "db"), secrets });
		const handle = await startStandaloneServer({ serverDir, port, env, log: serverLog });
		if (handle.port !== port) {
			log.info(`port ${port} was taken; the server moved to ${handle.port}. Data the window keeps per origin starts fresh.`);
			savePort(userData, handle.port);
		}
		return handle;
	}

	/**
	 * Starts the server; if the local database won't open (e.g. after a crash),
	 * offers to move it aside and start with an empty one.
	 */
	async function startServerOrRecover(): Promise<ServerHandle> {
		try {
			return await startServer();
		} catch (err) {
			if (!(err instanceof ServerStartError && err.localDb)) throw err;
			log.info(`local database trouble: ${err.message}`);
			const { response } = await dialog.showMessageBox({
				type: "error",
				title: "Raven",
				message: "Raven's local database didn't open.",
				detail:
					"Raven can put the old database aside (it keeps a copy in its data folder) and start with an empty one. Your mail isn't affected, but integrations, rules, blocked senders and reminders will need setting up again.",
				buttons: ["Put it aside and start fresh", "Quit"],
				defaultId: 0,
				cancelId: 1,
			});
			if (response !== 0) throw err;
			const db = join(userData, "db");
			if (existsSync(db)) renameSync(db, `${db}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`);
			return startServer();
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

	function createWindow(): BrowserWindow {
		const win = new BrowserWindow({
			width: 1280,
			height: 840,
			minWidth: 900,
			minHeight: 600,
			show: false,
			title: "Raven",
			backgroundColor: "#050a0b",
			autoHideMenuBar: process.platform !== "darwin",
			webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged, spellcheck: true },
		});
		win.once("ready-to-show", () => win.show());
		// Windows log-off or shutdown: stop the server cleanly while we still can.
		win.on("session-end", () => void Promise.allSettled([session.defaultSession.cookies.flushStore(), server?.stop()]));
		void win.loadURL(appOrigin ? `${appOrigin}${START_PATH}` : SPLASH);
		mainWindow = win;
		return win;
	}

	function hardenSession(ses: Session): void {
		ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
			callback(ALLOWED_PERMISSIONS.has(permission) && classifyUrl(details.requestingUrl, appOrigin).kind === "app");
		});
		ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
			return ALLOWED_PERMISSIONS.has(permission) && appOrigin !== null && requestingOrigin === appOrigin;
		});
	}

	/** Adds the token to requests for the server only (never to remote images or other sites), and tracks them. */
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

function buildMenu(): Menu {
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
		process.platform === "darwin" ? { role: "appMenu" } : { role: "fileMenu" },
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
