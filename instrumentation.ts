/*
 * Runs once when the server starts, before it handles a request. Only the
 * desktop app does anything here: it opens its local database and applies
 * pending migrations. Web builds compile the branch away (RAVEN_DESKTOP_BUILD
 * is inlined), so they never load PGlite.
 */
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RAVEN_DESKTOP_BUILD && process.env.RAVEN_DB === "pglite") {
		const { openLocalDb } = await import("./lib/db/local");
		await openLocalDb();
	}
}
