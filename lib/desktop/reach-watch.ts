/*
 * The desktop app's offline state. Next's offline check asks the page's own
 * server, which on desktop runs on this computer and always answers, so
 * desktop asks a different question: can this computer reach the mail
 * server? (`/api/mail/reach`). The window's offline event marks it offline
 * at once; a mail request that couldn't reach the server makes it check.
 * While offline it checks again every RECHECK_MS until the server answers.
 */

/** true: reachable; false: not; null: couldn't tell (the local server didn't answer). */
export type Probe = () => Promise<boolean | null>;

export type Timers = {
	set(run: () => void, ms: number): unknown;
	clear(id: unknown): void;
};

export const RECHECK_MS = 10_000;

const realTimers: Timers = {
	set: (run, ms) => setTimeout(run, ms),
	clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type ReachWatch = {
	get(): boolean;
	subscribe(listener: () => void): () => void;
	browserOffline(): void;
	browserOnline(): void;
	mailUnreachable(): void;
	stop(): void;
};

export function createReachWatch(probe: Probe, timers: Timers = realTimers): ReachWatch {
	let offline = false;
	let checking = false;
	let timer: unknown = null;
	const listeners = new Set<() => void>();

	const set = (next: boolean) => {
		if (next === offline) return;
		offline = next;
		for (const listener of listeners) listener();
	};
	const cancel = () => {
		if (timer !== null) timers.clear(timer);
		timer = null;
	};
	const recheck = () => {
		if (timer !== null) return;
		timer = timers.set(() => {
			timer = null;
			void check();
		}, RECHECK_MS);
	};
	async function check(): Promise<void> {
		if (checking) return;
		checking = true;
		try {
			const reachable = await probe().catch(() => null);
			if (reachable === true) {
				cancel();
				set(false);
				return;
			}
			if (reachable === false) set(true);
			if (offline) recheck();
		} finally {
			checking = false;
		}
	}

	return {
		get: () => offline,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		browserOffline() {
			set(true);
			recheck();
		},
		browserOnline: () => void check(),
		mailUnreachable: () => void check(),
		stop: cancel,
	};
}

/** Asks the local server whether the mail server can be reached. */
export async function probeMailServer(): Promise<boolean | null> {
	try {
		const res = await fetch("/api/mail/reach", { cache: "no-store", headers: { accept: "application/json" } });
		if (!res.ok) return null;
		const body = (await res.json()) as { ok?: boolean; data?: { reachable?: unknown } } | null;
		return body?.ok && typeof body.data?.reachable === "boolean" ? body.data.reachable : null;
	} catch {
		return null;
	}
}
