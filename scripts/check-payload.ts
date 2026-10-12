/**
 * Fails when a tracked file carries a known worm marker. Runs in CI and as
 * `bun run check:payload`. Scans what git tracks, so untracked notes and
 * node_modules stay out of it.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanFile, type Finding } from "./payload-core";

const files = execSync("git ls-files -z", { encoding: "utf8" }).split("\0").filter(Boolean);
const findings: Finding[] = [];
for (const file of files) {
	let bytes: Uint8Array;
	try {
		bytes = readFileSync(file);
	} catch {
		continue; // deleted in the working tree
	}
	findings.push(...scanFile(file, bytes));
}

if (findings.length) {
	console.error(`Payload check failed (${findings.length}):`);
	for (const f of findings) console.error(`  ${f.file}: ${f.reason}`);
	process.exit(1);
}
console.log(`Payload check passed (${files.length} files).`);
