/** Header that carries the per-launch token from the shell to the local server. */
export const TOKEN_HEADER = "x-raven-desktop";

/** The local server only ever listens here. */
export const HOST = "127.0.0.1";

export function originFor(port: number): string {
	return `http://${HOST}:${port}`;
}

/**
 * Whether a failed start's output points at the local database. On desktop
 * the instrumentation hook does nothing but open it, and a damaged PGlite
 * folder makes its wasm abort ("RuntimeError: Aborted()") mid-query.
 */
export function isLocalDbTrouble(output: string): boolean {
	return /pglite|__drizzle_migrations|RAVEN_PGLITE_DIR|loading instrumentation hook|RuntimeError: (unreachable|memory access|Aborted)/i.test(output);
}
