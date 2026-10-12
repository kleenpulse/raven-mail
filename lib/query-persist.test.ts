import { describe, expect, test } from "bun:test";
import type { Query } from "@tanstack/react-query";
import { resetPrefs, setPref } from "@/lib/prefs/store";
import { PERSIST_MAX_AGE, shouldPersist } from "@/lib/query-persist";

const q = (queryKey: unknown[], status: "success" | "error" | "pending" = "success") =>
	({ queryKey, state: { status, data: status === "success" ? {} : undefined } }) as unknown as Query;

describe("shouldPersist", () => {
	test.each([
		[["acct", "me@x", "overview"]],
		[["acct", "me@x", "folders"]],
		[["acct", "me@x", "deep-triage", "INBOX"]],
		[["acct", "me@x", "messages", "INBOX", ""]],
	])("persists %p", (key) => {
		expect(shouldPersist(q(key), "me@x")).toBe(true);
	});

	test.each([
		["another mailbox's query", ["acct", "other@x", "overview"]],
		["wrong scope", ["global", "me@x", "overview"]],
		["message bodies", ["acct", "me@x", "message", "INBOX", "42"]],
		["searches", ["acct", "me@x", "messages", "INBOX", "invoice"]],
		["messages without a search slot", ["acct", "me@x", "messages", "INBOX"]],
		["unknown kind", ["acct", "me@x", "ask"]],
		["empty key", []],
	])("skips %s", (_, key) => {
		expect(shouldPersist(q(key), "me@x")).toBe(false);
	});

	test.each(["error", "pending"] as const)("skips %s queries", (status) => {
		expect(shouldPersist(q(["acct", "me@x", "overview"], status), "me@x")).toBe(false);
	});

	test("Offline Cache off: nothing persists", () => {
		setPref("sync.offlineCache", false);
		try {
			expect(shouldPersist(q(["acct", "me@x", "overview"]), "me@x")).toBe(false);
		} finally {
			resetPrefs();
		}
	});
});

describe("PERSIST_MAX_AGE", () => {
	test("one week", () => {
		expect(PERSIST_MAX_AGE).toBe(7 * 24 * 60 * 60 * 1000);
	});
});
