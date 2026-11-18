"use client";

import * as React from "react";
import { uiZoom } from "@/lib/prefs/dom";

function subscribe(onChange: () => void): () => void {
	// Interface Size reaches the page as an attribute on <html> (see lib/prefs/dom.ts), from Settings or from another tab.
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui-size"] });
	return () => observer.disconnect();
}

/**
 * The Interface Size zoom of the app frame, kept current while mounted.
 * Pointer positions are in viewport px and lengths inside the frame are not,
 * so anything that drags needs this to stay under the pointer.
 */
export function useUiZoom(): number {
	return React.useSyncExternalStore(subscribe, uiZoom, () => 1);
}
