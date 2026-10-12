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
	"INTEGRATIONS_SECRET",
	"APP_URL",
	"SEO_INDEX",
	"MISTRAL_API_KEY",
	"ELEVEN_LABS",
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

mock.module(path.resolve(import.meta.dir, "../lib/jev/client.ts"), () => ({
	jevEnabled: () => fakeJev.enabled,
	getJevClient: () => ({ systemOne: (...args: [unknown, unknown?]) => fakeJev.systemOne(...args) }),
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
