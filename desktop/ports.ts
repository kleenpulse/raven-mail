import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { parsePortRecord, portRecord } from "./env";
import { HOST } from "./shared";

/*
 * The server's port is part of the app's origin, and localStorage/IndexedDB
 * are per origin (prefs, drafts, undo-send recovery). So the port is chosen
 * once, saved in desktop.json, and only changes if something else took it.
 */

function recordFile(userData: string): string {
	return join(userData, "desktop.json");
}

export function savedPort(userData: string): number | null {
	try {
		return parsePortRecord(readFileSync(recordFile(userData), "utf8"));
	} catch {
		return null;
	}
}

export function savePort(userData: string, port: number): void {
	writeFileSync(recordFile(userData), portRecord(port));
}

/** A port the OS says is free right now. */
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, HOST, () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
		});
	});
}

export function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen(port, HOST, () => server.close(() => resolve(true)));
	});
}
