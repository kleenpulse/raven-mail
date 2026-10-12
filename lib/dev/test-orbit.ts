import type { SenderStat } from "@/lib/insights/types";
import type { TriageCategory } from "@/lib/mail/types";
import { AREAS, AREA_LABEL, type TestArea, type TestFile, type TestHistory, type TestReport } from "./test-report";

/*
 * Maps a test report onto Orbit's mail-shaped input, so the dev board reuses
 * the constellation unchanged: the suite is the sun, areas take the seven
 * category slots, test files are the ring-2 "senders". Two fields are
 * borrowed: `unread`/`needsReply` carry failures (Orbit's attention flag),
 * and `daily` carries the file's duration per run (drives the sun's ring).
 */

export const AREA_SLOT: Record<TestArea, TriageCategory> = {
	mail: "primary",
	integrations: "updates",
	jev: "receipts",
	insights: "promotions",
	server: "newsletters",
	ui: "social",
	other: "other",
};

export const SLOT_LABEL: Record<TriageCategory, string> = Object.fromEntries(
	AREAS.map((a) => [AREA_SLOT[a], AREA_LABEL[a]]),
) as Record<TriageCategory, string>;

const MAX_FILES = 24;

export function fileTitle(file: string): string {
	const base = file.split("/").pop() ?? file;
	return base.replace(/\.(dom\.)?test\.[cm]?[jt]sx?$/, "");
}

function fileDir(file: string): string {
	const parts = file.split("/");
	return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
}

/** Failing files always make the cut; then the biggest; path breaks ties. */
export function pickFiles(files: readonly TestFile[], max = MAX_FILES): TestFile[] {
	return [...files]
		.sort((a, b) => b.counts.fail - a.counts.fail || b.counts.total - a.counts.total || a.file.localeCompare(b.file))
		.slice(0, max);
}

export function toOrbitInput(
	report: TestReport,
	history: TestHistory | null,
): { senders: SenderStat[]; categories: { category: TriageCategory; count: number }[] } {
	const runs = history?.runs ?? [];
	const last4 = runs.slice(-4);

	const byArea = new Map<TestArea, number>();
	for (const f of report.files) byArea.set(f.area, (byArea.get(f.area) ?? 0) + f.counts.total);
	const categories = AREAS.filter((a) => (byArea.get(a) ?? 0) > 0).map((a) => ({ category: AREA_SLOT[a], count: byArea.get(a)! }));

	const senders = pickFiles(report.files).map((f): SenderStat => {
		const weekly = last4.map((r) => r.files[f.file]?.total ?? 0);
		while (weekly.length < 4) weekly.unshift(0);
		const daily = runs.map((r) => Math.round(r.files[f.file]?.ms ?? 0));
		return {
			address: f.file,
			name: fileTitle(f.file),
			domain: fileDir(f.file),
			category: AREA_SLOT[f.area],
			bucket: f.layer === "unit" ? "notifications" : "people",
			count: f.counts.total,
			unread: f.counts.fail,
			needsReply: f.counts.fail,
			sentToThem: 0,
			lastAt: report.finishedAt,
			daily: daily.length ? daily : [Math.round(f.ms)],
			weekly,
			yourReplyMedianMin: null,
			theirReplyMedianMin: null,
			recent: [],
		};
	});

	return { senders, categories };
}
