import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;

export type Log = {
	readonly file: string;
	/** Raw output (server stdout/stderr). */
	write(text: string): void;
	/** One timestamped line. */
	info(message: string): void;
};

export function createLog(dir: string, name: string, echo: boolean): Log {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, name);
	try {
		if (statSync(file).size > MAX_BYTES) truncateSync(file, 0);
	} catch {
		// first run: no file yet
	}
	const write = (text: string) => {
		try {
			appendFileSync(file, text);
		} catch {
			// logging must never take the app down
		}
		if (echo) process.stdout.write(text);
	};
	return { file, write, info: (message) => write(`${new Date().toISOString()} ${message}\n`) };
}
