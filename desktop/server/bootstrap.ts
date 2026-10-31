import { readFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { join } from "node:path";
import { HOST, originFor, TOKEN_HEADER } from "../shared";
import { checkRequest } from "./guard";

/*
 * The desktop app's server process (bundled to <server>/raven-server.js, run
 * by Electron's utilityProcess). It does what Next's standalone server.js does
 * (node_modules/next/dist/server/lib/start-server.js), with three changes:
 * it only listens on 127.0.0.1, every request must pass the Host + token
 * guard, and it never writes into its own folder (no ISR flush, no gzip; the
 * install folder may be read-only, and macOS would see a broken bundle).
 *
 * It reports {ready, port} or {failed} to the shell, and on {shutdown} it
 * drains, closes Next and the local database, then exits.
 */

type Report = { type: "ready"; port: number } | { type: "failed"; message: string };
type Handlers = {
	requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void>;
	server?: { close(): Promise<void> };
};
type StartServerModule = {
	getRequestHandlers(opts: { dir: string; port: number; isDev: boolean; server: http.Server; hostname: string; quiet: boolean }): Promise<Handlers>;
};

// The shell (and the CI smoke test) start this with cwd = the server folder.
// Not __dirname: the bundler bakes in the source folder.
const dir = process.cwd();
const token = process.env.RAVEN_DESKTOP_TOKEN ?? "";
const inFlight = new Set<ServerResponse>();
let port = 0;
let handlers: Handlers | null = null;
let shuttingDown = false;

function report(message: Report): void {
	if (process.parentPort) process.parentPort.postMessage(message);
	// Without Electron (the CI smoke test), one JSON line on stdout.
	else console.log(JSON.stringify({ raven: message }));
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The config Next inlined into server.js, which is what server.js itself would use. */
function standaloneConfig(): Record<string, unknown> & { experimental?: Record<string, unknown> } {
	const source = readFileSync(join(dir, "server.js"), "utf8");
	const match = /^const nextConfig = (\{.*\})\r?$/m.exec(source);
	if (!match) throw new Error("server.js has no inlined nextConfig; this Next version needs a bootstrap update.");
	return JSON.parse(match[1]!) as Record<string, unknown> & { experimental?: Record<string, unknown> };
}

async function listen(server: http.Server, wanted: number): Promise<number> {
	// A quick relaunch can find the old server still draining; wait briefly
	// before giving up the saved port (the origin, and its localStorage).
	let attempt = wanted;
	const giveUpAt = Date.now() + 2000;
	for (;;) {
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(attempt, HOST, () => {
					server.off("error", reject);
					resolve();
				});
			});
			return (server.address() as AddressInfo).port;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt === 0) throw err;
			if (Date.now() > giveUpAt) attempt = 0;
			else await delay(200);
		}
	}
}

async function start(): Promise<void> {
	if (!token) throw new Error("RAVEN_DESKTOP_TOKEN is missing.");
	process.env.NODE_ENV = "production";
	// Never read a .env that slipped into the folder.
	process.env.__NEXT_PROCESSED_ENV = "true";
	process.env.NEXT_MANUAL_SIG_HANDLE = "true";
	process.chdir(dir);

	const config = standaloneConfig();
	config.compress = false;
	config.experimental = { ...config.experimental, isrFlushToDisk: false };
	process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);

	const nextRequire = createRequire(join(dir, "server.js"));
	nextRequire("next");
	const { getRequestHandlers } = nextRequire("next/dist/server/lib/start-server") as StartServerModule;

	const server = http.createServer((req, res) => {
		const verdict = checkRequest(req.headers, port, token);
		if (!verdict.ok || !handlers) {
			res.statusCode = verdict.ok ? 503 : 403;
			res.end();
			return;
		}
		// The token stays on the request: Next re-sends these headers when a
		// server action redirects, and that internal request must pass too.
		inFlight.add(res);
		res.on("close", () => inFlight.delete(res));
		handlers.requestHandler(req, res).catch((err: unknown) => {
			console.error(err);
			if (!res.headersSent) res.statusCode = 500;
			res.end();
		});
	});
	server.on("upgrade", (_req, socket) => socket.destroy());

	port = await listen(server, Number(process.env.PORT) || 0);
	process.env.PORT = String(port);
	process.env.__NEXT_PRIVATE_ORIGIN = originFor(port);
	handlers = await getRequestHandlers({ dir, port, isDev: false, server, hostname: HOST, quiet: true });

	// Warm up: this waits for instrumentation (local database + migrations).
	const res = await fetch(`${originFor(port)}/login`, { headers: { [TOKEN_HEADER]: token }, redirect: "manual" });
	if (res.status !== 200) throw new Error(`The first page answered ${res.status}.`);
	report({ type: "ready", port });

	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		server.close();
		const until = Date.now() + 3000;
		while (inFlight.size > 0 && Date.now() < until) await delay(50);
		await handlers?.server?.close().catch((err: unknown) => console.error(err));
		const closeDb = (globalThis as { [key: symbol]: (() => Promise<void>) | undefined })[Symbol.for("raven.db.close")];
		await closeDb?.().catch((err: unknown) => console.error(err));
		process.exit(0);
	};
	process.parentPort?.on("message", (event) => {
		if ((event.data as { type?: string } | undefined)?.type === "shutdown") void shutdown();
	});
	process.once("SIGTERM", () => void shutdown());
	process.once("SIGINT", () => void shutdown());
}

start().catch((err: unknown) => {
	console.error(err);
	report({ type: "failed", message: err instanceof Error ? err.message : String(err) });
	setTimeout(() => process.exit(1), 100);
});
