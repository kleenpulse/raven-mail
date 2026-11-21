import { readdir, readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";

/*
 * Reads the server's files ahead of the server, several at a time.
 *
 * The server opens about 2,400 small files one after another while it
 * starts. After a restart, or a few busy hours, the first open of each file
 * is slow: on Windows the virus scanner checks it first (measured at 3 to 17
 * ms a file, with a warm start at 1.3 s and a cold one at 15 to 23 s). The
 * scanner works on several files at once if asked, and what it has checked
 * stays quick to open for a while, for any process. So the shell reads the
 * folder in parallel while the server loads from it one file at a time.
 *
 * Nothing here can fail a start: a file or folder that can't be read is skipped.
 */

export type PrewarmResult = { files: number; bytes: number; ms: number };

/** The server folder's parts in the order the server needs them; whatever isn't named comes last. */
export const SERVER_ORDER: readonly string[] = ["node_modules/next", ".next/server", "node_modules", ".next", "public"];

/** How many files are read at once: enough to keep the scanner busy on several cores, without taking a small machine's every core. */
const WIDTH = Math.min(8, Math.max(2, availableParallelism()));

export async function prewarm(root: string, opts: { order?: readonly string[]; width?: number; signal?: AbortSignal } = {}): Promise<PrewarmResult> {
	const started = Date.now();
	const result: PrewarmResult = { files: 0, bytes: 0, ms: 0 };
	const files = listFiles(root, opts.order ?? SERVER_ORDER);
	const worker = async () => {
		for (;;) {
			if (opts.signal?.aborted) return;
			// Calls to an async generator's next() queue up, so the workers can share it.
			const next = await files.next();
			if (next.done) return;
			try {
				// Not `bytes += (await …)`: that reads `bytes` before the wait and loses the other workers' counts.
				const size = (await readFile(next.value)).length;
				result.bytes += size;
				result.files++;
			} catch {
				// gone, locked or unreadable: the server will say so if it matters
			}
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, opts.width ?? WIDTH) }, worker));
	result.ms = Date.now() - started;
	return result;
}

/** Every file under `root`, each once: the root's own files, then each folder in `order`, then the rest. */
export async function* listFiles(root: string, order: readonly string[]): AsyncGenerator<string> {
	const seen = new Set<string>();
	yield* walk(root, seen, false);
	for (const part of order) yield* walk(join(root, part), seen, true);
	yield* walk(root, seen, true);
}

async function* walk(dir: string, seen: Set<string>, deep: boolean): AsyncGenerator<string> {
	if (deep && seen.has(dir)) return;
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	if (deep) seen.add(dir);
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const file = join(dir, entry.name);
		if (seen.has(file)) continue;
		seen.add(file);
		yield file;
	}
	if (!deep) return;
	for (const entry of entries) if (entry.isDirectory()) yield* walk(join(dir, entry.name), seen, true);
}
