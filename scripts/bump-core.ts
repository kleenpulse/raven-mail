/**
 * Pure string rewriters behind scripts/bump.ts — every function is
 * (raw, ...) => raw so bun:test can prove each one touches only its version.
 */

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** "patch" | "minor" | "major" | explicit "x.y.z" → next version string. */
export function nextVersion(current: string, arg: string): string {
	const m = SEMVER_RE.exec(current);
	if (!m) throw new Error(`current version is not x.y.z: ${current}`);
	const [maj, min, pat] = m.slice(1).map(Number);
	switch (arg) {
		case "patch":
			return `${maj}.${min}.${pat + 1}`;
		case "minor":
			return `${maj}.${min + 1}.0`;
		case "major":
			return `${maj + 1}.0.0`;
		default: {
			if (!SEMVER_RE.test(arg)) {
				throw new Error(`expected patch|minor|major|x.y.z, got: ${arg}`);
			}
			return arg;
		}
	}
}

function replaceOnce(
	raw: string,
	from: string,
	to: string,
	file: string,
): string {
	const at = raw.indexOf(from);
	if (at < 0) throw new Error(`${file}: could not find ${JSON.stringify(from)}`);
	return raw.slice(0, at) + to + raw.slice(at + from.length);
}

export function bumpPackageJson(raw: string, from: string, to: string): string {
	return replaceOnce(
		raw,
		`"version": "${from}"`,
		`"version": "${to}"`,
		"package.json",
	);
}

/**
 * Moves the [Unreleased] body under a new `## [version] - date` heading and
 * leaves a fresh empty [Unreleased] above it. entryCount = `- ` bullets moved.
 */
export function cutRelease(
	raw: string,
	version: string,
	date: string,
): { out: string; entryCount: number } {
	// Keeps the file's own line endings: a CRLF checkout stays CRLF.
	const eol = raw.includes("\r\n") ? "\r\n" : "\n";
	const lines = raw.split(/\r?\n/);
	const start = lines.findIndex((l) => /^##\s+\[Unreleased\]\s*$/i.test(l));
	if (start < 0) throw new Error("CHANGELOG.md: no ## [Unreleased] section");
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^##\s/.test(lines[i])) {
			end = i;
			break;
		}
	}
	const body = lines.slice(start + 1, end);
	const entryCount = body.filter((l) => /^-\s/.test(l)).length;

	// Trim blank padding around the body, then rebuild with canonical spacing.
	while (body.length && body[0].trim() === "") body.shift();
	while (body.length && body[body.length - 1].trim() === "") body.pop();

	const out = [
		...lines.slice(0, start),
		"## [Unreleased]",
		"",
		`## [${version}] - ${date}`,
		"",
		...body,
		"",
		...lines.slice(end),
	].join(eol);
	return { out, entryCount };
}
