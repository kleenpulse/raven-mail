/**
 * Known markers of the PolinRider npm worm (2026). Each needle is built from
 * parts so this file, its test and the CI config never match themselves.
 */
const MARKERS = [
	["4738", "-2"],
	["3379", "-6"],
	["A11", "--#"],
	["RS", "260605"],
	["_t", "_s"],
	["193.247", ".144"],
	["166.88", ".134"],
	["node ", "api.js"],
].map((parts) => parts.join(""));

/**
 * The loader key comes in many spellings (bracket or dot, any quote, global or
 * globalThis, `!` or `i = 'A…'`), so match the shape, never one spelling.
 */
const LOADER_KEYS = [
	/global(This)?\s*(\[\s*['"`]!|\.\s*!)/,
	/global(This)?\s*(\.\s*i|\[\s*['"`]i['"`]\s*\])\s*=\s*['"`]A/,
];

const FONT_EXT = /\.(woff2?|ttf|otf)$/i;
/** wOF2, wOFF, TrueType 1.0, OTTO, true: anything else is not a font. */
const FONT_MAGIC = ["774f4632", "774f4646", "00010000", "4f54544f", "74727565"];
const CONFIG_FILE = /(^|\/)[^/]*\.config\.[cm]?[jt]s$/;
/** The loader hides after a long run of whitespace, past the editor's edge. */
const HIDDEN_TAIL = /[ \t]{120,}\S/;
const AUTORUN = ["runOn", "folderOpen", "allowAutomaticTasks"];

export type Finding = { file: string; reason: string };

export function scanFile(path: string, bytes: Uint8Array): Finding[] {
	const file = path.replaceAll("\\", "/");
	const found: Finding[] = [];

	if (file === "api.js") found.push({ file, reason: "root api.js (worm payload location)" });

	if (FONT_EXT.test(file)) {
		const magic = Buffer.from(bytes.subarray(0, 4)).toString("hex");
		if (!FONT_MAGIC.includes(magic)) found.push({ file, reason: "font file is not a font (disguised script)" });
		return found;
	}

	const text = Buffer.from(bytes).toString("utf8");
	if (text.includes("\u0000")) return found;

	for (const marker of MARKERS) {
		if (text.includes(marker)) found.push({ file, reason: `contains worm marker "${marker}"` });
	}
	if (LOADER_KEYS.some((pattern) => pattern.test(text))) {
		found.push({ file, reason: "sets the worm's loader key on global" });
	}
	if (CONFIG_FILE.test(file) && HIDDEN_TAIL.test(text)) {
		found.push({ file, reason: "code hidden after a long run of whitespace" });
	}
	if (file.startsWith(".vscode/") && AUTORUN.some((key) => text.includes(key))) {
		found.push({ file, reason: "editor task set to run when the folder opens" });
	}
	return found;
}
