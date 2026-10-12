"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { getJson, useInvalidateMail, type MessagesPage } from "@/hooks/use-mail";
import { detectArrivals } from "@/lib/mail/arrivals";
import { usePref } from "@/lib/prefs/store";
import { qk } from "@/lib/query-keys";
import type { MailSummary } from "@/lib/mail/types";

const WATCH_LIMIT = 10;

const POLL_MS = { live: 20_000, balanced: 60_000, saver: 5 * 60_000 } as const;

/**
 * Polls the newest Inbox rows and hands over unread arrivals, newest first.
 * Polling pauses in a background tab; the focus refetch on return reports
 * whatever landed meanwhile.
 */
export function useNewMail(onArrive: (messages: MailSummary[]) => void) {
	const { email } = useAccount();
	const freshness = usePref("sync.freshness");
	const invalidate = useInvalidateMail();
	const watermark = React.useRef<number | null>(null);
	const arrive = React.useEffectEvent(onArrive);

	const { data } = useQuery({
		queryKey: qk.inboxWatch(email),
		queryFn: ({ signal }) =>
			getJson<MessagesPage>(`/api/mail/messages?folder=INBOX&limit=${WATCH_LIMIT}`, signal),
		refetchInterval: POLL_MS[freshness],
		staleTime: 0,
	});

	React.useEffect(() => {
		if (!data) return;
		const next = detectArrivals(watermark.current, data.messages);
		watermark.current = next.watermark;
		if (!next.arrivals.length) return;
		arrive(next.arrivals);
		// The list, unread badges and Overview should agree with the banner.
		void invalidate.invalidateMessages("INBOX");
		void invalidate.invalidateFolders();
	}, [data, invalidate]);
}
