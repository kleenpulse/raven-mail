import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Bundles the main process into `<outDir>/main.js` (CommonJS, Electron left external). */
export async function bundleMain(root: string, outDir: string): Promise<void> {
	mkdirSync(outDir, { recursive: true });
	const result = await Bun.build({
		entrypoints: [join(root, "desktop", "main.ts")],
		outdir: outDir,
		naming: "main.js",
		target: "node",
		format: "cjs",
		external: ["electron"],
	});
	if (!result.success) {
		for (const message of result.logs) console.error(message);
		throw new Error("main bundle failed");
	}
	// Electron reads `main` from here when started on the folder.
	writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ name: "raven-dev", productName: "Raven", main: "main.js" }, null, 2)}\n`);
}
