import { mock } from "bun:test";

/*
 * Shared, mutable fakes behind the module mocks in test/setup.ts. Tests drive
 * them through the helpers; setup resets them before every test.
 */

/** Ambient request cookies, as `next/headers` `cookies()` sees them. */
export const cookieState = new Map<string, string>();

/** Callbacks handed to `after()` from `next/server`. */
export const afterQueue: (() => unknown)[] = [];

export async function flushAfter(): Promise<void> {
	while (afterQueue.length) await afterQueue.shift()!();
}

type SystemOne = (input: unknown, opts?: unknown) => Promise<unknown>;

const unexpected: SystemOne = async () => {
	throw new Error("fakeJev.systemOne: unexpected call");
};

/** Stand-in for the Jev SDK client. Disabled unless a test turns it on. */
const accepted: (key: string) => Promise<void> = async () => {};

/**
 * Stand-in for the Jev SDK client. Disabled unless a test turns it on; a
 * session with its own `jevKey` gets it regardless (BYOK).
 */
export const fakeJev = {
	enabled: false,
	/** Keyless sessions get the real Kage engine instead of null (heuristics). */
	kage: false,
	systemOne: mock(unexpected),
	/** verifyJevKey: accepts every key unless a test makes it throw. */
	verifyKey: mock(accepted),
	/** What every fake Jev hands out as `client`; follows `systemOne` across resets. */
	client: { systemOne: (...args: [unknown, unknown?]) => fakeJev.systemOne(...args) },
	reset() {
		this.enabled = false;
		this.kage = false;
		this.systemOne = mock(unexpected);
		this.verifyKey = mock(accepted);
	},
};
