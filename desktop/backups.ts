import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * The local database's backups, as lib/db/local.ts writes them before a
 * migration: `<db folder>.backups/before-<migration>-<time>.tar.gz`.
 */

export type Backup = { path: string; at: Date };

export function latestBackup(dbDir: string): Backup | null {
	const dir = `${dbDir}.backups`;
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return null;
	}
	let latest: Backup | null = null;
	for (const name of names) {
		if (!/^before-.+\.tar\.gz$/.test(name)) continue;
		const path = join(dir, name);
		const at = statSync(path).mtime;
		if (!latest || at > latest.at) latest = { path, at };
	}
	return latest;
}
