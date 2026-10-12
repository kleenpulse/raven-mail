"use client";

import * as React from "react";
import { usePref } from "@/lib/prefs/store";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
	const mql = window.matchMedia(QUERY);
	mql.addEventListener("change", onChange);
	return () => mql.removeEventListener("change", onChange);
}

/** The OS asks for reduced motion, or Settings → Appearance → Reduce Motion does. */
export function useReducedMotion(): boolean {
	const system = React.useSyncExternalStore(
		subscribe,
		() => window.matchMedia(QUERY).matches,
		() => false,
	);
	return usePref("appearance.motion") === "reduce" || system;
}
