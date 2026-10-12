"use client";

import { useSyncExternalStore } from "react";

// The changelog dialog's open state lives only in the `#changelog` URL hash:
// deep-linkable, Back closes it, and a navigation can't strand it open. The
// hash is invisible to Next's hooks, so this is a useSyncExternalStore over
// location.hash: `hashchange` covers manual edits, `popstate` back/forward,
// our private event our own history writes, and WhatsNew's HashNavSync router
// navigations (which fire none of the above).

export const CHANGELOG_HASH = "#changelog";
const HASH_EVENT = "raven:changelog-hash";

function subscribeHash(cb: () => void): () => void {
	window.addEventListener("hashchange", cb);
	window.addEventListener("popstate", cb);
	window.addEventListener(HASH_EVENT, cb);
	return () => {
		window.removeEventListener("hashchange", cb);
		window.removeEventListener("popstate", cb);
		window.removeEventListener(HASH_EVENT, cb);
	};
}

const readHash = () => window.location.hash === CHANGELOG_HASH;
// Fragments never reach the server: hydrating closed, then opening on a
// deep link, is correct rather than a mismatch.
const serverSnapshot = () => false;

export function useChangelogOpen(): boolean {
	return useSyncExternalStore(subscribeHash, readHash, serverSnapshot);
}

export function notifyChangelogHash(): void {
	window.dispatchEvent(new Event(HASH_EVENT));
}

/** Opens the changelog from anywhere. Push, not replace, so Back closes it. */
export function requestChangelogOpen(): void {
	if (readHash()) return;
	window.history.pushState(window.history.state, "", window.location.pathname + window.location.search + CHANGELOG_HASH);
	notifyChangelogHash();
}

/** Replace, never history.back(): a deep link's previous entry may be another site. */
export function closeChangelog(): void {
	if (!readHash()) return;
	window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
	notifyChangelogHash();
}
