/*
 * bun desktop/scripts/release.ts <tag> <artifacts dir> <out dir>
 *
 * Run by the release job in .github/workflows/desktop.yml, after each OS's
 * files were checked against its SHA256SUMS.txt. Checks the tag matches
 * package.json, gathers every OS's files into <out>/files with one merged
 * SHA256SUMS.txt, and writes <out>/notes.md from the version's CHANGELOG
 * section. The job then makes a draft release from them; a person publishes it.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The body of `## [<version>]` in CHANGELOG.md, up to the next `## ` heading. */
export function changelogSection(changelog: string, version: string): string {
	const lines = changelog.split(/\r?\n/);
	const heading = new RegExp(`^##\\s+\\[${version.replace(/\./g, "\\.")}\\](\\s|$)`);
	const start = lines.findIndex((line) => heading.test(line));
	if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
	const end = lines.findIndex((line, i) => i > start && /^##\s/.test(line));
	const body = lines
		.slice(start + 1, end === -1 ? undefined : end)
		// Link definitions ([0.9.0]: https://...) at the end of the file.
		.filter((line) => !/^\[[^\]]+\]:\s/.test(line))
		.join("\n")
		.trim();
	if (!body) throw new Error(`the CHANGELOG section for ${version} is empty`);
	return body;
}

export function releaseNotes(changelog: string, version: string): string {
	return `${changelogSection(changelog, version)}\n\n---\n\nDownload the installer for your system below. SHA256SUMS.txt has the checksum of every file.\n`;
}

/** The version a tag names, if it's `v` plus package.json's version. */
export function checkTag(tag: string, packageVersion: string): string {
	if (tag !== `v${packageVersion}`) throw new Error(`tag ${tag} doesn't match package.json version ${packageVersion}`);
	return packageVersion;
}

/** One SHA256SUMS.txt from each OS's, sorted by file name. A name listed twice is an error. */
export function mergeSums(texts: string[]): string {
	const byName = new Map<string, string>();
	for (const text of texts) {
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim()) continue;
			// "hash  name", or "hash *name" (sha256sum's binary mode).
			const match = /^([0-9a-f]{64}) [ *](\S.*)$/.exec(line);
			if (!match) throw new Error(`not a checksum line: ${line}`);
			const [, hash, name] = match;
			if (byName.has(name)) throw new Error(`${name} comes from two builds`);
			byName.set(name, `${hash}  ${name}`);
		}
	}
	return `${[...byName.keys()]
		.sort()
		.map((name) => byName.get(name))
		.join("\n")}\n`;
}

if (import.meta.main) {
	const [tag, artifacts, outDir] = process.argv.slice(2);
	if (!tag || !artifacts || !outDir) throw new Error("usage: release.ts <tag> <artifacts dir> <out dir>");
	const root = resolve(import.meta.dir, "../..");
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
	const version = checkTag(tag, pkg.version);
	const files = join(outDir, "files");
	mkdirSync(files, { recursive: true });
	const sums: string[] = [];
	const copied = new Set<string>();
	for (const build of readdirSync(artifacts)) {
		const dir = join(artifacts, build);
		if (!statSync(dir).isDirectory()) continue;
		for (const name of readdirSync(dir)) {
			if (name === "SHA256SUMS.txt") {
				sums.push(readFileSync(join(dir, name), "utf8"));
				continue;
			}
			if (copied.has(name)) throw new Error(`${name} comes from two builds`);
			copied.add(name);
			copyFileSync(join(dir, name), join(files, name));
		}
	}
	// Every file must be listed, so the job's per-build sha256sum check covered it.
	const merged = mergeSums(sums);
	const listed = new Set(merged.trim().split("\n").map((line) => line.slice(66)));
	const unlisted = readdirSync(files).filter((name) => !listed.has(name));
	if (unlisted.length > 0) throw new Error(`files without a checksum: ${unlisted.join(", ")}`);
	writeFileSync(join(files, "SHA256SUMS.txt"), merged);
	writeFileSync(join(outDir, "notes.md"), releaseNotes(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version));
	console.log(`release ${tag}: ${listed.size} files`);
}
