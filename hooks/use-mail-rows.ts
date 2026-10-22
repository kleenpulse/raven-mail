"use client";

import * as React from "react";
import { useAccount } from "@/components/providers/account-provider";
import { usePref } from "@/lib/prefs/store";
import { groupThreads, singleRows, type ThreadRow } from "@/lib/mail/thread";
import type { MailSummary } from "@/lib/mail/types";

/**
 * The rows the list shows and j/k walks: conversations when threading is on,
 * one per message for search results or when it's off. The list and the shell
 * must agree, so both read it here.
 */
export function useMailRows(messages: MailSummary[] | undefined, search: string) {
	const { email } = useAccount();
	const threading = usePref("mail.threading") && !search;
	const toRows = React.useCallback(
		(list: MailSummary[]): ThreadRow[] => (threading ? groupThreads(list, email) : singleRows(list, email)),
		[threading, email],
	);
	const rows = React.useMemo(() => toRows(messages ?? []), [messages, toRows]);
	return { rows, toRows, threading };
}
