import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function bundle(entry: string, outDir: string, naming: string, external: string[]): Promise<void> {
	mkdirSync(outDir, { recursive: true });
	const result = await Bun.build({ entrypoints: [entry], outdir: outDir, naming, target: "node", format: "cjs", external });
	if (!result.success) {
		for (const message of result.logs) console.error(message);
		throw new Error(`bundling ${entry} failed`);
	}
}

/**
 * The main process → `<outDir>/main.js` and the window's preload →
 * `<outDir>/preload.js` (CommonJS, Electron left external), plus the
 * package.json Electron starts from.
 */
export async function bundleMain(root: string, outDir: string, manifest: Record<string, unknown> = { name: "raven-dev", productName: "Raven" }): Promise<void> {
	await bundle(join(root, "desktop", "main.ts"), outDir, "main.js", ["electron"]);
	await bundle(join(root, "desktop", "preload.ts"), outDir, "preload.js", ["electron"]);
	writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ ...manifest, main: "main.js" }, null, 2)}\n`);
}

/** The server bootstrap → `<serverDir>/raven-server.js`; it loads Next from that folder's node_modules at runtime. */
export async function bundleServer(root: string, serverDir: string): Promise<void> {
	await bundle(join(root, "desktop", "server", "bootstrap.ts"), serverDir, "raven-server.js", []);
}
