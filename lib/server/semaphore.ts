/**
 * Per-key concurrency cap. Used to keep IMAP connections per mailbox bounded
 * (Gmail allows ~15 per account; we stay well under).
 */
export function createKeyedSemaphore(max: number) {
	const slots = new Map<string, { active: number; waiters: (() => void)[] }>();

	function release(key: string) {
		const slot = slots.get(key);
		if (!slot) return;
		const next = slot.waiters.shift();
		if (next) {
			next();
			return;
		}
		slot.active -= 1;
		if (slot.active === 0) slots.delete(key);
	}

	return {
		async acquire(key: string): Promise<() => void> {
			let slot = slots.get(key);
			if (!slot) {
				slot = { active: 0, waiters: [] };
				slots.set(key, slot);
			}
			if (slot.active < max) {
				slot.active += 1;
			} else {
				const waiting = slot;
				await new Promise<void>((resolve) => waiting.waiters.push(resolve));
			}
			let released = false;
			return () => {
				if (released) return;
				released = true;
				release(key);
			};
		},
		async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
			const done = await this.acquire(key);
			try {
				return await fn();
			} finally {
				done();
			}
		},
	};
}
