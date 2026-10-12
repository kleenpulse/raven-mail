import { describe, expect, test } from "bun:test";
import { BUILT_IN, CHAT, catalogEntry, COMING_SOON, EXPORT_ENTRY, isCatalogId } from "@/lib/integrations/catalog";
import { CONNECTION_KINDS, type CatalogId } from "@/lib/integrations/types";

const ALL: CatalogId[] = ["mail", "jev", "slack", "discord", "webhook", "export"];

describe("catalog", () => {
	test("CHAT covers exactly the connectable kinds, in order", () => {
		expect(CHAT.map((e) => e.id)).toEqual([...CONNECTION_KINDS]);
	});

	test("ids are unique across the catalog", () => {
		const ids = [...BUILT_IN, ...CHAT, EXPORT_ENTRY].map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.sort()).toEqual([...ALL].sort());
	});

	test.each(CHAT)("$id: https placeholder and docs, three how-to steps", (entry) => {
		expect(entry.placeholder).toMatch(/^https:\/\//);
		expect(entry.docsUrl).toMatch(/^https:\/\//);
		expect(entry.howTo).toHaveLength(3);
		expect(entry.name.length).toBeGreaterThan(0);
		expect(entry.blurb.length).toBeGreaterThan(0);
	});

	test("coming soon list is non-empty and distinct from what exists", () => {
		expect(COMING_SOON.length).toBeGreaterThan(0);
		const names = [...BUILT_IN, ...CHAT, EXPORT_ENTRY].map((e) => e.name);
		for (const soon of COMING_SOON) expect(names).not.toContain(soon);
	});
});

describe("catalogEntry", () => {
	test.each(ALL)("%s resolves to its own entry", (id) => {
		expect(catalogEntry(id).id).toBe(id);
	});

	test("returns the shared objects", () => {
		expect(catalogEntry("export")).toBe(EXPORT_ENTRY);
		expect(catalogEntry("slack")).toBe(CHAT[0]!);
	});
});

describe("isCatalogId", () => {
	test.each(ALL)("accepts %s", (id) => {
		expect(isCatalogId(id)).toBe(true);
	});

	test.each(["", "Slack", "teams", "notion", "mail ", "toString"])("rejects %p", (id) => {
		expect(isCatalogId(id)).toBe(false);
	});
});
