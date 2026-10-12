/**
 * Release cutter — syncs package.json, cuts CHANGELOG.md, commits, tags.
 *
 *   bun run bump patch|minor|major|<x.y.z>  [--allow-empty]
 *
 * Refuses on a dirty git tree and on an empty [Unreleased] section
 * (--allow-empty overrides the latter for emergency re-cuts). Rewrites
 * package.json and CHANGELOG.md, then commits `chore(release): vX.Y.Z`
 * and creates annotated tag vX.Y.Z. Never pushes.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bumpPackageJson, cutRelease, nextVersion } from "./bump-core";

// Run via `bun run bump` — package.json scripts always execute from repo root.
const root = process.cwd();
const args = process.argv.slice(2);
const allowEmpty = args.includes("--allow-empty");
const arg = args.find((a) => !a.startsWith("--"));

if (!arg) {
	console.error("usage: bun run bump patch|minor|major|<x.y.z> [--allow-empty]");
	process.exit(1);
}

const git = (cmd: string): string => execSync(`git ${cmd}`, { cwd: root, encoding: "utf8" });

const dirty = git("status --porcelain").trim();
if (dirty) {
	console.error("refusing: working tree is dirty — commit or stash first:\n" + dirty);
	process.exit(1);
}

// Relative names: git add on Windows chokes on JSON-escaped absolute paths.
const FILES = ["package.json", "CHANGELOG.md"] as const;
const [pkgPath, changelogPath] = FILES.map((f) => join(root, f));

const current = JSON.parse(readFileSync(pkgPath, "utf8")).version as string;
const next = nextVersion(current, arg);
const date = new Date().toISOString().slice(0, 10);

// Computed before any write — the empty-Unreleased guard aborts with
// nothing touched.
const { out: changelogOut, entryCount } = cutRelease(readFileSync(changelogPath, "utf8"), next, date);
if (entryCount === 0 && !allowEmpty) {
	console.error("refusing: [Unreleased] has no entries — write the changelog first (--allow-empty to override)");
	process.exit(1);
}

writeFileSync(pkgPath, bumpPackageJson(readFileSync(pkgPath, "utf8"), current, next));
writeFileSync(changelogPath, changelogOut);

git(`add ${FILES.join(" ")}`);
git(`commit -m "chore(release): v${next}"`);
git(`tag -a v${next} -m "v${next}"`);

console.log(`v${current} -> v${next} (${entryCount} changelog entries) — committed and tagged.`);
