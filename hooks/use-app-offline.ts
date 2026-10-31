"use client";

import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useOffline } from "next/offline";
import { ApiError } from "@/lib/api-error";
import { createReachWatch, probeMailServer } from "@/lib/desktop/reach-watch";

const DESKTOP = Boolean(process.env.RAVEN_DESKTOP_BUILD);

/** One watch for the whole page; it does nothing until something reports trouble. */
const reach = createReachWatch(probeMailServer);

/**
 * Whether the app should act offline. On the web, Next's own check. On
 * desktop, whether the mail server can be reached (see reach-watch.ts).
 */
export function useAppOffline(): boolean {
	const nextOffline = useOffline();
	const desktopOffline = React.useSyncExternalStore(reach.subscribe, reach.get, () => false);
	return DESKTOP ? desktopOffline : nextOffline;
}

/** Desktop: feeds the window's online/offline events and unreachable-mail errors to the watch. Mount once. */
export function useDesktopReachWatch(client: QueryClient): void {
	React.useEffect(() => {
		if (!DESKTOP) return;
		const offline = () => reach.browserOffline();
		const online = () => reach.browserOnline();
		window.addEventListener("offline", offline);
		window.addEventListener("online", online);
		if (!navigator.onLine) reach.browserOffline();
		// Mounted again while offline (cleanup stopped the recheck): check now, which re-arms it.
		else if (reach.get()) reach.mailUnreachable();
		const stopQueries = client.getQueryCache().subscribe((event) => {
			if (event.type !== "updated" || event.action.type !== "error") return;
			const error: unknown = event.action.error;
			if (error instanceof ApiError && error.code === "mail_unreachable") reach.mailUnreachable();
		});
		return () => {
			window.removeEventListener("offline", offline);
			window.removeEventListener("online", online);
			stopQueries();
			reach.stop();
		};
	}, [client]);
}
