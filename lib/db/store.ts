import "server-only";
import { withDb, type Db } from "@/lib/db";
import { IntegrationError } from "@/lib/integrations/errors";

/** `withDb` for rules, blocked senders and reminders: a missing database reads as their own callout. */
export async function withStore<T>(fn: (db: Db) => Promise<T>): Promise<T> {
	try {
		return await withDb(fn);
	} catch (err) {
		if (err instanceof IntegrationError && err.code === "db_not_configured") {
			throw new IntegrationError("store_needs_db", { cause: err });
		}
		throw err;
	}
}
