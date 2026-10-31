import { beforeEach, mock, setSystemTime } from "bun:test";
import path from "node:path";
import { afterQueue, cookieState, fakeJev } from "./state";

/*
 * Preload for every test file (bunfig.toml). Keeps the suite hermetic: bun
 * auto-loads .env, which holds real database and Jev credentials — scrub them
 * so nothing here can reach a live service.
 */
for (const key of [
	"DATABASE_URL",
	"DATABASE_URL_POOLED",
	"DATABASE_URL_UNPOOLED",
	"NEON_API_KEY",
	"TYPESAFE_API_KEY",
	"TYPESAFE_DEFAULT_MODEL",
	"KAGE",
	"INTEGRATIONS_SECRET",
	"APP_URL",
	"SEO_INDEX",
	"MISTRAL_API_KEY",
	"ELEVEN_LABS",
	"RAVEN_DESKTOP_BUILD",
	"RAVEN_DB",
	"RAVEN_PGLITE_DIR",
	"RAVEN_MIGRATIONS_DIR",
	"RAVEN_PGLITE_RESTORE",
	"RAVEN_DESKTOP_TOKEN",
]) {
	delete process.env[key];
}
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdefghijkl";
process.env.TZ = "UTC";

mock.module("server-only", () => ({}));

mock.module("next/headers", () => {
	const jar = {
		get: (name: string) => (cookieState.has(name) ? { name, value: cookieState.get(name)! } : undefined),
		getAll: () => [...cookieState].map(([name, value]) => ({ name, value })),
		has: (name: string) => cookieState.has(name),
		set: (name: string, value: string) => {
			cookieState.set(name, value);
		},
		delete: (name: string) => {
			cookieState.delete(name);
		},
	};
	return {
		cookies: async () => jar,
		headers: async () => new Headers(),
		draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
	};
});

const realServer = await import("next/server");
mock.module("next/server", () => ({
	...realServer,
	after: (fn: () => unknown) => {
		afterQueue.push(fn);
	},
}));

// Mirrors lib/jev/client.ts: the session's own key wins, then the "server" key (fakeJev.enabled),
// then Kage (fakeJev.kage — off by default so suites keep testing the heuristic path).
type KeyedSession = { jevKey?: string } | null;
const { kage } = await import("../lib/kage");
const typesafeFor = (session: KeyedSession) =>
	session?.jevKey
		? { client: fakeJev.client, source: "user" }
		: fakeJev.enabled
			? { client: fakeJev.client, source: "server" }
			: null;
mock.module(path.resolve(import.meta.dir, "../lib/jev/client.ts"), () => ({
	typesafeFor,
	jevFor: (session: KeyedSession) => typesafeFor(session) ?? (fakeJev.kage ? { client: kage, source: "kage" } : null),
	decisionEngine: async (session: KeyedSession) => (typesafeFor(session) ? "jev" : fakeJev.kage ? "kage" : null),
	jevStatus: async (session: KeyedSession) =>
		session?.jevKey
			? { source: "user", hint: session.jevKey.slice(-4), kage: fakeJev.kage, live: true }
			: { source: fakeJev.enabled ? "server" : null, hint: null, kage: fakeJev.kage, live: fakeJev.enabled },
	verifyJevKey: (key: string) => fakeJev.verifyKey(key),
}));

beforeEach(() => {
	cookieState.clear();
	afterQueue.length = 0;
	fakeJev.reset();
	setSystemTime();
	const g = globalThis as Record<string, unknown>;
	for (const key of Object.keys(g)) {
		if (/^__em_dev_mail_store_v\d+__$/.test(key)) delete g[key];
	}
});
