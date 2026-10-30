/** Header that carries the per-launch token from the shell to the local server. */
export const TOKEN_HEADER = "x-raven-desktop";

/** The local server only ever listens here. */
export const HOST = "127.0.0.1";

export function originFor(port: number): string {
	return `http://${HOST}:${port}`;
}
