"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { getJson } from "@/hooks/use-mail";
import { qk } from "@/lib/query-keys";
import { PERSIST_MAX_AGE } from "@/lib/query-persist";
import type { Overview } from "@/lib/insights/types";
import { focusRefetch, stale } from "@/lib/prefs/query";

const noopSubscribe = () => () => {};

/** Viewer's IANA zone; "" during SSR so the query waits for the client. */
export function useTimeZone(): string {
	return React.useSyncExternalStore(
		noopSubscribe,
		() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
		() => "",
	);
}

export function useOverview(days: 7 | 30 = 30, { enabled = true }: { enabled?: boolean } = {}) {
	const { email } = useAccount();
	const tz = useTimeZone();
	return useQuery({
		queryKey: qk.overview(email, days, tz),
		queryFn: ({ signal }) =>
			getJson<Overview>(`/api/overview?${new URLSearchParams({ days: String(days), tz })}`, signal),
		enabled: enabled && Boolean(tz),
		staleTime: stale(60_000),
		gcTime: PERSIST_MAX_AGE,
		refetchOnWindowFocus: focusRefetch,
	});
}
