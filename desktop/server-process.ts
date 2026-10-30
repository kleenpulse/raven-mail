import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { Log } from "./log";
import { HOST, originFor, TOKEN_HEADER } from "./shared";

export type ServerHandle = {
	readonly port: number;
	readonly origin: string;
	/** Graceful stop; resolves once the server process is gone. */
	stop(): Promise<void>;
	/** Called if the server exits without being asked to. */
	onExit(listener: (detail: string) => void): void;
};

/** A start failure with a message meant for the user. */
export class ServerStartError extends Error {}

const DEV_LOCKED = /Another next dev server is already running/i;

/* ── Dev: `next dev` from the repo, for HMR and the dev login ────────────── */

export async function startDevServer(opts: {
	repoRoot: string;
	port: number;
	token: string;
	env: Record<string, string>;
	log: Log;
}): Promise<ServerHandle> {
	const next = join(opts.repoRoot, "node_modules", "next", "dist", "bin", "next");
	const child = spawn(process.env.RAVEN_NODE || "node", [next, "dev", "--hostname", HOST, "--port", String(opts.port)], {
		cwd: opts.repoRoot,
		env: opts.env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
		// Own process group on POSIX so the whole tree can be stopped.
		detached: process.platform !== "win32",
	});
	const output = capture(child, opts.log);
	const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
	const origin = originFor(opts.port);

	try {
		await waitUntilServing(origin, opts.token, exited, 180_000);
	} catch (err) {
		killTree(child);
		if (DEV_LOCKED.test(output())) {
			throw new ServerStartError(
				"Another `next dev` is already running in this project. Next.js allows only one at a time, so stop your own dev server first, then run desktop:dev again.",
			);
		}
		throw err;
	}

	let stopping = false;
	const listeners: ((detail: string) => void)[] = [];
	void exited.then((code) => {
		if (!stopping) for (const listener of listeners) listener(`next dev exited with code ${code}`);
	});

	return {
		port: opts.port,
		origin,
		onExit: (listener) => void listeners.push(listener),
		async stop() {
			if (stopping) return;
			stopping = true;
			// Stopping next dev on Windows is a hard kill; close the local database first.
			await fetch(`${origin}/api/dev/desktop`, {
				method: "POST",
				headers: { [TOKEN_HEADER]: opts.token, origin },
				signal: AbortSignal.timeout(5000),
			}).catch(() => {});
			killTree(child);
			await Promise.race([exited, delay(5000)]);
		},
	};
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Polls until the server answers anything at all, the process exits, or time runs out. */
export async function waitUntilServing(origin: string, token: string, exited: Promise<unknown>, timeoutMs: number): Promise<void> {
	let gone = false;
	void exited.then(() => (gone = true));
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (gone) throw new ServerStartError("The Raven server stopped while starting. See server.log for details.");
		try {
			await fetch(`${origin}/login`, { headers: { [TOKEN_HEADER]: token }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
			return;
		} catch {
			await delay(500);
		}
	}
	throw new ServerStartError("The Raven server took too long to start. See server.log for details.");
}

function capture(child: ChildProcess, log: Log): () => string {
	let tail = "";
	const onData = (chunk: Buffer) => {
		const text = chunk.toString();
		log.write(text);
		tail = (tail + text).slice(-8192);
	};
	child.stdout?.on("data", onData);
	child.stderr?.on("data", onData);
	return () => tail;
}

export function killTree(child: ChildProcess): void {
	if (child.exitCode !== null || child.pid === undefined) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
	} else {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			// already gone
		}
	}
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
