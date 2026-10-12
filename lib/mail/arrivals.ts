import type { MailSummary } from "@/lib/mail/types";

/**
 * IMAP UIDs only grow within a folder, so the highest UID seen is enough to
 * tell a new arrival from a row that was merely re-fetched. `null` = no
 * baseline yet: the first look records one and reports nothing, so opening the
 * app never pops a banner for mail that was already waiting.
 */
export function detectArrivals(
	watermark: number | null,
	rows: readonly MailSummary[],
): { arrivals: MailSummary[]; watermark: number | null } {
	if (!rows.length) return { arrivals: [], watermark };
	const top = Math.max(...rows.map((m) => Number(m.uid)));
	// Below the mark means the server renumbered the folder (UIDVALIDITY): re-baseline.
	if (watermark === null || top < watermark) return { arrivals: [], watermark: top };
	const arrivals = rows
		.filter((m) => Number(m.uid) > watermark && !m.flags.seen)
		.sort((a, b) => Number(b.uid) - Number(a.uid));
	return { arrivals, watermark: top };
}
