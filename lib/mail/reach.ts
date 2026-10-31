import "server-only";
import { connect } from "node:net";

/**
 * Whether a TCP connection to the mail server opens within `timeoutMs`.
 * Opens and closes a socket, nothing more: no TLS, no login. The desktop app
 * uses it to tell "offline" from "the mail server said no".
 */
export function canReach(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		const done = (reachable: boolean) => {
			socket.destroy();
			resolve(reachable);
		};
		socket.setTimeout(timeoutMs, () => done(false));
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
	});
}
