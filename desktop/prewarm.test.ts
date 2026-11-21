import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { listFiles, prewarm, SERVER_ORDER } from "./prewarm";

const root = mkdtempSync(join(tmpdir(), "raven-prewarm-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const FILES: Record<string, string> = {
	"raven-server.js": "boot",
	"server.js": "next's own",
	"node_modules/next/dist/server/next.js": "next",
	"node_modules/next/package.json": "{}",
	"node_modules/@electric-sql/pglite/dist/pglite.wasm": "wasm!",
	".next/server/app/login/page.js": "login",
	".next/server/chunks/a.js": "chunk",
	".next/static/chunks/client.js": "client",
	".next/BUILD_ID": "abc",
	"public/tour/clip.mp3": "audio",
	"lib/db/migrations/0000_first.sql": "sql",
};
for (const [name, text] of Object.entries(FILES)) {
	mkdirSync(join(root, name, ".."), { recursive: true });
	writeFileSync(join(root, name), text);
}

async function listed(order: readonly string[] = SERVER_ORDER): Promise<string[]> {
	const out: string[] = [];
	for await (const file of listFiles(root, order)) out.push(relative(root, file).split(sep).join("/"));
	return out;
}

describe("listFiles", () => {
	test("lists every file once", async () => {
		const files = await listed();
		expect([...files].sort()).toEqual(Object.keys(FILES).sort());
		expect(new Set(files).size).toBe(files.length);
	});

	test("goes in the order the server needs: its own files, Next, the built server, other packages, the rest", async () => {
		const files = await listed();
		const at = (name: string) => files.indexOf(name);
		expect(at("raven-server.js")).toBeLessThan(at("node_modules/next/dist/server/next.js"));
		expect(at("node_modules/next/dist/server/next.js")).toBeLessThan(at(".next/server/chunks/a.js"));
		expect(at(".next/server/chunks/a.js")).toBeLessThan(at("node_modules/@electric-sql/pglite/dist/pglite.wasm"));
		expect(at("node_modules/@electric-sql/pglite/dist/pglite.wasm")).toBeLessThan(at(".next/static/chunks/client.js"));
		expect(at(".next/static/chunks/client.js")).toBeLessThan(at("public/tour/clip.mp3"));
		// Not named in the order: last.
		expect(at("lib/db/migrations/0000_first.sql")).toBe(files.length - 1);
	});

	test("a folder in the order that isn't there is skipped", async () => {
		expect((await listed(["nope", "public"]))[2]).toBe("public/tour/clip.mp3");
	});
});

describe("prewarm", () => {
	test("reads everything and counts it", async () => {
		const result = await prewarm(root);
		expect(result.files).toBe(Object.keys(FILES).length);
		expect(result.bytes).toBe(Object.values(FILES).reduce((sum, text) => sum + text.length, 0));
	});

	test("a missing folder reads nothing and doesn't throw", async () => {
		expect(await prewarm(join(root, "missing"))).toMatchObject({ files: 0, bytes: 0 });
	});

	test("stops when told to", async () => {
		const stop = new AbortController();
		stop.abort();
		expect((await prewarm(root, { signal: stop.signal })).files).toBe(0);
	});
});
