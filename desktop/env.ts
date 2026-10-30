/*
 * The environment the local server runs with: a short allowlist from the
 * shell's own environment (Windows needs SystemRoot/TEMP for sockets and DNS)
 * plus the desktop settings. Nothing else leaks in: no NODE_OPTIONS, no
 * DATABASE_URL, no secrets from a developer's shell.
 */

export type ServerMode = "dev" | "prod";

export type ServerEnvOptions = {
	mode: ServerMode;
	port: number;
	token: string;
	/** Folder for the local database (PGlite). */
	dataDir: string;
};

const PASS = new Set([
	"systemroot",
	"windir",
	"path",
	"pathext",
	"comspec",
	"temp",
	"tmp",
	"tmpdir",
	"home",
	"userprofile",
	"appdata",
	"localappdata",
	"programdata",
	"lang",
	"language",
	"tz",
	"xdg_runtime_dir",
	"http_proxy",
	"https_proxy",
	"no_proxy",
]);

export function baseEnv(parent: Record<string, string | undefined>): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(parent)) {
		if (value === undefined) continue;
		const lower = key.toLowerCase();
		if (PASS.has(lower) || lower.startsWith("lc_")) env[key] = value;
	}
	return env;
}

export function serverEnv(parent: Record<string, string | undefined>, opts: ServerEnvOptions): Record<string, string> {
	const env = baseEnv(parent);
	env.NEXT_TELEMETRY_DISABLED = "1";
	// Read at runtime by `next dev`; a desktop `next build` inlines it.
	env.RAVEN_DESKTOP_BUILD = "1";
	env.RAVEN_DESKTOP_TOKEN = opts.token;
	env.PORT = String(opts.port);
	// Proton Bridge and other local mail servers listen on 127.0.0.1.
	env.ALLOW_LOOPBACK_MAIL_HOSTS = "true";
	env.RAVEN_DB = "pglite";
	env.RAVEN_PGLITE_DIR = opts.dataDir;
	if (opts.mode === "prod") {
		env.NODE_ENV = "production";
	} else {
		// `next dev` fills unset vars from .env; a set-but-empty one wins.
		env.DATABASE_URL = "";
	}
	return env;
}

/** The saved port from desktop.json, if it is usable. */
export function parsePortRecord(text: string | null): number | null {
	if (!text) return null;
	try {
		const port: unknown = (JSON.parse(text) as { port?: unknown }).port;
		return typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
	} catch {
		return null;
	}
}

export function portRecord(port: number): string {
	return `${JSON.stringify({ port }, null, 2)}\n`;
}
