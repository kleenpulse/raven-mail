"use client";

import * as React from "react";
import { useAccount } from "@/components/providers/account-provider";

/** Day key (YYYY-MM-DD) to whether the user owed nobody a reply that day. */
export type StreakLog = Record<string, 0 | 1>;

function readLog(key: string): StreakLog {
	try {
		return JSON.parse(localStorage.getItem(key) ?? "{}") as StreakLog;
	} catch {
		return {};
	}
}

/**
 * IMAP keeps no history, so the reply-zero streak is tracked on this device:
 * a day counts when you opened Raven and owed nobody a reply. This records
 * today and returns the whole log.
 *
 * The Overview calls it whether or not the streak card is on the board, so
 * taking the card off does not quietly break the streak. A day that already
 * counted stays counted.
 */
export function useStreakLog(todayKey: string | undefined, zeroToday: boolean): StreakLog {
	const { email } = useAccount();
	const storageKey = `raven-streak:v1:${email}`;
	// Read once on the client; nothing that shows the log renders before mount, so SSR's {} never shows.
	const [stored] = React.useState<StreakLog>(() => (typeof window === "undefined" ? {} : readLog(storageKey)));
	const log = React.useMemo<StreakLog>(
		() => (todayKey ? { ...stored, [todayKey]: stored[todayKey] === 1 || zeroToday ? 1 : 0 } : stored),
		[stored, todayKey, zeroToday],
	);

	React.useEffect(() => {
		if (!todayKey) return;
		try {
			localStorage.setItem(storageKey, JSON.stringify(log));
		} catch {
			/* storage blocked — the streak just won't persist */
		}
	}, [storageKey, log, todayKey]);

	return log;
}
