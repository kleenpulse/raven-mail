"use client";

import * as React from "react";

let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
	listeners.add(onChange);
	current = Date.now();
	timer ??= setInterval(() => {
		current = Date.now();
		for (const l of listeners) l();
	}, 30_000);
	return () => {
		listeners.delete(onChange);
		if (listeners.size === 0 && timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};
}

/** Shared 30s clock; null during SSR so relative times never mismatch hydration. */
export function useNow(): number | null {
	return React.useSyncExternalStore(
		subscribe,
		() => current || null,
		() => null,
	);
}
