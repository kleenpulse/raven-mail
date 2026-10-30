/**
 * Every query key is scoped by account so a logout → login as someone else
 * can never surface the previous mailbox from cache.
 */
export const qk = {
	all: (account: string) => ["acct", account] as const,
	folders: (account: string) => ["acct", account, "folders"] as const,
	messagesRoot: (account: string) => ["acct", account, "messages"] as const,
	messages: (account: string, folder: string, search = "") =>
		["acct", account, "messages", folder, search] as const,
	/** Newest Inbox rows for the new-mail banner; memory-only (see `shouldPersist`). */
	inboxWatch: (account: string) => ["acct", account, "inbox-watch"] as const,
	messageRoot: (account: string) => ["acct", account, "message"] as const,
	message: (account: string, folder: string, uid: string) =>
		["acct", account, "message", folder, uid] as const,
	/** Under messageRoot, so whatever invalidates messages refreshes conversations too. */
	thread: (account: string, folder: string, uid: string) =>
		["acct", account, "message", "thread", folder, uid] as const,
	contacts: (account: string) => ["acct", account, "contacts"] as const,
	/** Memory only: never persisted (see `shouldPersist`). */
	blocks: (account: string) => ["acct", account, "blocks"] as const,
	/** Memory only, like blocks: subjects and names stay out of IndexedDB. */
	followUps: (account: string) => ["acct", account, "follow-ups"] as const,
	/** Memory only, like blocks: rule wording and activity stay out of IndexedDB. */
	rules: (account: string) => ["acct", account, "rules"] as const,
	ruleEvents: (account: string) => ["acct", account, "rules", "events"] as const,
	overview: (account: string, days: number, tz: string) =>
		["acct", account, "overview", days, tz] as const,
	/** Memory only, like blocks: where the user is stays out of IndexedDB. `place` is "ip" or rounded "lat,lon". */
	weather: (account: string, place: string) => ["acct", account, "weather", place] as const,
	integrations: (account: string) => ["acct", account, "integrations"] as const,
	integrationEvents: (account: string, filter: { integrationId?: string; target?: string } = {}) =>
		["acct", account, "integrations", "events", filter.integrationId ?? null, filter.target ?? null] as const,
};
