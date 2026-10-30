"use client";

import * as React from "react";

// Stack-aware "device/browser Back closes the topmost overlay", ported from Ellum.
//
// While any registered overlay is open, exactly ONE sentinel entry sits on the
// history stack (same URL, so hash-driven state like #changelog is untouched).
// Back pops it; the topmost overlay closes and, if more remain, the sentinel is
// pushed again. Closing from the UI pops our own sentinel, so history stays balanced.

type Entry = { id: number; close: () => void };

const SENTINEL = { __overlayBack: true } as const;
const MOBILE_QUERY = "(max-width: 767px)";

const stack: Entry[] = [];
let listening = false;
// Our own history.back() calls (UI close) whose popstate must be ignored.
let suppressPops = 0;
// The last overlay closed and its sentinel is about to be popped.
let cleanupPending = false;
let nextId = 1;

function isSentinelOnTop() {
	return (window.history.state as { __overlayBack?: boolean } | null)?.__overlayBack === true;
}

function onPopState() {
	if (suppressPops > 0) {
		suppressPops--;
		return;
	}
	// Decide before close() runs, so a quick second Back can't slip past a missing sentinel.
	const top = stack.pop();
	if (!top) return;
	if (stack.length > 0) window.history.pushState(SENTINEL, "");
	top.close();
}

function register(entry: Entry) {
	// An overlay that opens in the same tick another closed (StrictMode's re-mount, or a
	// quick close-then-open) takes over the sentinel still on top instead of stacking a
	// second one. history.back() is async, so popping first and pushing after would
	// leave the page with no sentinel and the next Back would leave the page.
	const reuse = cleanupPending && isSentinelOnTop();
	cleanupPending = false;
	if (stack.length === 0 && !reuse) window.history.pushState(SENTINEL, "");
	if (!listening) {
		listening = true;
		window.addEventListener("popstate", onPopState);
	}
	stack.push(entry);
}

function unregister(id: number) {
	const idx = stack.findIndex((e) => e.id === id);
	if (idx === -1) return; // Already popped by Back.
	stack.splice(idx, 1);
	if (stack.length > 0) return;
	// Closed from the UI: drop our sentinel a tick later, unless another overlay took it.
	// If a navigation replaced it, leave history alone.
	cleanupPending = true;
	window.setTimeout(() => {
		if (!cleanupPending) return;
		cleanupPending = false;
		if (stack.length === 0 && isSentinelOnTop()) {
			suppressPops++;
			window.history.back();
		}
	}, 0);
}

/** On phones, Back closes this overlay instead of leaving the page. No-op on wider screens. */
export function useOverlayBackClose(open: boolean, close: () => void) {
	const closeRef = React.useRef(close);
	React.useEffect(() => {
		closeRef.current = close;
	});

	React.useEffect(() => {
		if (!open || !window.matchMedia(MOBILE_QUERY).matches) return;
		const id = nextId++;
		register({ id, close: () => closeRef.current() });
		return () => unregister(id);
	}, [open]);
}
