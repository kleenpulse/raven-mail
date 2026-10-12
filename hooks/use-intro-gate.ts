"use client";

import * as React from "react";

/**
 * Entrance choreography plays once per browser session. Later client-side
 * mounts flip `data-intro="off"` before paint, which CSS uses to skip it.
 */
export function useIntroGate<T extends HTMLElement>(key = "raven-intro"): React.RefObject<T | null> {
	const ref = React.useRef<T>(null);
	React.useLayoutEffect(() => {
		try {
			if (sessionStorage.getItem(key)) {
				if (ref.current) ref.current.dataset.intro = "off";
			} else {
				sessionStorage.setItem(key, "1");
			}
		} catch {
			/* storage blocked: just animate */
		}
	}, [key]);
	return ref;
}
