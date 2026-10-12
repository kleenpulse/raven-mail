"use client";

import * as React from "react";

/** SSR-safe: false on the server and through hydration, then tracks the query. */
export function useMediaQuery(query: string): boolean {
	const subscribe = React.useCallback(
		(onChange: () => void) => {
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		[query],
	);
	return React.useSyncExternalStore(
		subscribe,
		() => window.matchMedia(query).matches,
		() => false,
	);
}
