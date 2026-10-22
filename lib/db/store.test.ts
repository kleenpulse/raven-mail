import { describe, expect, mock, test } from "bun:test";
import path from "node:path";

// No DATABASE_URL: these features show their own setup line, not the integrations one.
const { IntegrationError } = await import("@/lib/integrations/errors");
mock.module(path.resolve(import.meta.dir, "index.ts"), () => ({
	withDb: async () => {
		throw new IntegrationError("db_not_configured");
	},
}));
const { withStore } = await import("@/lib/db/store");

describe("withStore", () => {
	test("a missing database becomes store_needs_db, with its own copy", async () => {
		const err = await withStore(async () => 1).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(IntegrationError);
		expect(err).toMatchObject({ code: "store_needs_db", status: 503 });
		expect((err as Error).message).toBe("Rules, blocked senders and reminders need a database.");
	});
});
