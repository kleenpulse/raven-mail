import "server-only";
import { connect } from "node:net";

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
