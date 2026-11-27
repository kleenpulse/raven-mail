import type { MailSummary } from "@/lib/mail/types";

export function detectArrivals(
	watermark: number | null,
	rows: readonly MailSummary[],
): { arrivals: MailSummary[]; watermark: number | null } {
	if (!rows.length) return { arrivals: [], watermark };
	const top = Math.max(...rows.map((m) => Number(m.uid)));
	if (watermark === null || top < watermark) return { arrivals: [], watermark: top };
	const arrivals = rows
		.filter((m) => Number(m.uid) > watermark && !m.flags.seen)
		.sort((a, b) => Number(b.uid) - Number(a.uid));
	return { arrivals, watermark: top };
}
