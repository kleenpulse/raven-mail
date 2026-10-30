"use client";

import * as React from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useAccount } from "@/components/providers/account-provider";
import { useDeepTriageMap } from "@/hooks/use-deep-triage";
import { useBlockedSender } from "@/hooks/use-blocks";
import { usePref } from "@/lib/prefs/store";
import { heuristicTriage } from "@/lib/triage/heuristic";
import { groupThreads, singleRows, type ThreadRow } from "@/lib/mail/thread";
import { SPLIT_TABS, splitRows, tabOf, type SplitResult, type SplitTab } from "@/lib/mail/split-inbox";
import type { MailSummary, TriageCategory } from "@/lib/mail/types";

const tabParser = parseAsStringLiteral(SPLIT_TABS).withDefault("important").withOptions({ clearOnDefault: true });

/**
 * The rows the list shows and j/k walks: conversations when threading is on,
 * one per message for search results or when it's off, and only the open
 * tab's rows when the Inbox is split, minus blocked senders in the Inbox. The
 * list and the shell must agree, so both read it here.
 */
export function useMailRows(
	messages: MailSummary[] | undefined,
	search: string,
	{ inbox = false }: { inbox?: boolean } = {},
) {
	const { email } = useAccount();
	const threading = usePref("mail.threading") && !search;
	const splitOn = usePref("mail.splitInbox") && inbox && !search;
	const shown = usePref("mail.splitTabs");
	const deep = useDeepTriageMap();
	const [rawTab, setTab] = useQueryState("tab", tabParser);
	// A tab turned off in Settings while it was open falls back to Important.
	const tab: SplitTab =
		rawTab === "all" || rawTab === "important" || (shown as readonly string[]).includes(rawTab) ? rawTab : "important";

	// Deep triage (when it ran) wins over the free heuristic, as on each row.
	const categoryOf = React.useCallback(
		(row: ThreadRow): TriageCategory => {
			const m = row.latest;
			return (
				deep.get(`${m.folder}:${m.uid}`)?.category ??
				heuristicTriage({ subject: m.subject, snippet: m.preview, from: m.from.address }).category
			);
		},
		[deep],
	);

	// Blocked senders leave the Inbox at once; search still finds them.
	const blocked = useBlockedSender();
	const hideBlocked = inbox && !search;
	const group = React.useCallback(
		(raw: MailSummary[]): ThreadRow[] => {
			const list = hideBlocked ? raw.filter((m) => !blocked(m.from.address)) : raw;
			return threading ? groupThreads(list, email) : singleRows(list, email);
		},
		[threading, email, hideBlocked, blocked],
	);
	const toRows = React.useCallback(
		(list: MailSummary[]): ThreadRow[] => {
			const all = group(list);
			return splitOn && tab !== "all" ? all.filter((r) => tabOf(categoryOf(r), shown) === tab) : all;
		},
		[group, splitOn, categoryOf, shown, tab],
	);

	const all = React.useMemo(() => group(messages ?? []), [messages, group]);
	const split: (SplitResult & { tab: SplitTab }) | null = React.useMemo(
		() => (splitOn ? { ...splitRows(all, categoryOf, shown), tab } : null),
		[splitOn, all, categoryOf, shown, tab],
	);
	const rows = split ? split.byTab.get(tab)! : all;
	return { rows, toRows, threading, split, setTab };
}
