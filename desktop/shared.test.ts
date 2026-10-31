import { describe, expect, test } from "bun:test";
import { isLocalDbTrouble } from "./shared";

describe("isLocalDbTrouble", () => {
	test("a damaged PGlite folder: the wasm aborts inside the instrumentation hook", () => {
		// From server.log, 2026-10-31, after pg_control was deleted from the data folder.
		const log = `⨯ Failed to preload entries: Error: An error occurred while loading instrumentation hook: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
params:
    at async j.migrate (D:\\app\\resources\\server\\.next\\server\\chunks\\_0uojj_5hw12he._.js:62:5) {
  query: 'CREATE SCHEMA IF NOT EXISTS "drizzle"',
  [cause]: RuntimeError: Aborted(). Build with -sASSERTIONS for more info.
}
Error: The first page answered 500.`;
		expect(isLocalDbTrouble(log)).toBe(true);
	});

	test("other database signatures", () => {
		expect(isLocalDbTrouble("Error: PGlite failed to open")).toBe(true);
		expect(isLocalDbTrouble('relation "drizzle.__drizzle_migrations" does not exist')).toBe(true);
		expect(isLocalDbTrouble("RAVEN_PGLITE_DIR must name the local database folder")).toBe(true);
		expect(isLocalDbTrouble("RuntimeError: memory access out of bounds")).toBe(true);
	});

	test("anything else isn't the database", () => {
		expect(isLocalDbTrouble("Error: listen EADDRINUSE: address already in use 127.0.0.1:52731")).toBe(false);
		expect(isLocalDbTrouble("Error: The first page answered 500.")).toBe(false);
		expect(isLocalDbTrouble("")).toBe(false);
	});
});
