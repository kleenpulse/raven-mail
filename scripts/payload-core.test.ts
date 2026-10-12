import { describe, expect, it } from "bun:test";
import { scanFile } from "./payload-core";

const bytes = (text: string) => new TextEncoder().encode(text);
const reasons = (path: string, text: string) => scanFile(path, bytes(text)).map((f) => f.reason);

describe("scanFile", () => {
	it("passes ordinary source", () => {
		expect(scanFile("lib/site.ts", bytes(`export const a = "global";`))).toEqual([]);
	});

	it("flags a campaign marker", () => {
		expect(reasons("postcss.config.mjs", `x = "A8-${"4738"}-2"`)[0]).toMatch(/worm marker/);
	});

	it("flags code hidden after whitespace in a config file", () => {
		const text = `export default {};${"\t".repeat(200)}eval(x)`;
		expect(reasons("postcss.config.mjs", text)).toContain("code hidden after a long run of whitespace");
		expect(scanFile("lib/table.ts", bytes(text))).toEqual([]);
	});

	it("flags a root api.js but not a nested one", () => {
		expect(reasons("api.js", "")).toHaveLength(1);
		expect(scanFile("convex/_generated/api.js", bytes(""))).toEqual([]);
	});

	it("flags a font that is really a script", () => {
		expect(reasons("public/fonts/fa-solid-500.woff2", "const x = 1")).toHaveLength(1);
		expect(scanFile("public/fonts/ok.woff2", new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0]))).toEqual([]);
	});

	it("flags folder-open editor tasks", () => {
		expect(reasons(".vscode/tasks.json", `{"runOptions":{"runOn":"folderOpen"}}`)).toHaveLength(1);
	});
});
