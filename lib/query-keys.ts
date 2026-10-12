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
	overview: (account: string, days: number, tz: string) =>
		["acct", account, "overview", days, tz] as const,
	integrations: (account: string) => ["acct", account, "integrations"] as const,
	integrationEvents: (account: string, filter: { integrationId?: string; target?: string } = {}) =>
		["acct", account, "integrations", "events", filter.integrationId ?? null, filter.target ?? null] as const,
};
