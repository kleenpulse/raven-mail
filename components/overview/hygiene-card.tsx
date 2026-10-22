"use client";

import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { Ring } from "@/components/viz/ring";
import { useComposeStore } from "@/lib/store/compose";
import { formatBytes, mailLink } from "@/lib/jev/ask/format";
import type { NewsletterStat, Overview } from "@/lib/insights/types";
import { cn } from "@/lib/utils";
import { parseMailto } from "@/lib/mail/headers";

const GRADE_TONE: Record<NewsletterStat["grade"], string> = {
	A: "bg-ok/15 text-ok",
	B: "bg-ok/10 text-ok",
	C: "bg-foreground/10 text-foreground",
	D: "bg-signal-soft text-signal-ink dark:text-signal",
	F: "bg-critical/15 text-critical",
};

/**
 * Newsletter ROI (opened-rate per list, A–F) and storage. Unsubscribe opens the
 * sender's own page or a prefilled draft — Raven never unsubscribes on its own.
 */
export function HygieneCard({ overview, i = 0, id }: { overview: Overview; i?: number; id?: string }) {
	const openCompose = useComposeStore((s) => s.openCompose);
	const lists = overview.newsletters.slice(0, 6);
	const quota = overview.quota;
	const usedPct = quota ? Math.round((quota.usedBytes / quota.limitBytes) * 100) : null;
	const largest = overview.attachments.largest[0];

	return (
		<Bento i={i} id={id} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
			<div className="min-w-0">
				<div className="flex items-baseline justify-between gap-2">
					<BentoTitle>Newsletters</BentoTitle>
					<span className="font-mono text-[11px] text-ink-2">opened · per month</span>
				</div>
				{lists.length === 0 ? (
					<p className="mt-3 text-[13px] text-ink-2">No mailing lists in the last 30 days.</p>
				) : (
					<ul className="mt-3 divide-y divide-border dark:divide-glass-border">
						{lists.map((list) => (
							<li key={list.key} className="flex items-center gap-3 py-2.5">
								<span className={cn("grid size-8 shrink-0 place-items-center rounded-full font-display text-sm font-semibold", GRADE_TONE[list.grade])} aria-label={`Grade ${list.grade}`}>
									{list.grade}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[13px] font-medium">{list.name}</span>
									<span className="mt-1 flex items-center gap-2">
										<span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-foreground/10 sm:w-20" aria-hidden>
											<span className="block h-full rounded-full bg-signal" style={{ width: `${Math.round(list.openRate * 100)}%` }} />
										</span>
										<span className="tabular font-mono text-[11px] whitespace-nowrap text-ink-2">
											{Math.round(list.openRate * 100)}% · {list.issuesPerMonth}/mo
										</span>
									</span>
								</span>
								{list.unsubscribe?.https ? (
									<a
										href={list.unsubscribe.https}
										target="_blank"
										rel="noopener noreferrer nofollow"
										className="inline-flex h-8 shrink-0 items-center gap-1 rounded-pill px-3 text-[12px] ring-1 ring-border transition-colors hover:bg-signal-soft dark:ring-glass-border"
									>
										Unsubscribe
										<ArrowUpRight className="size-3.5" />
									</a>
								) : list.unsubscribe?.mailto ? (
									<button
										type="button"
										onClick={() => {
											const mailto = parseMailto(list.unsubscribe!.mailto!);
											if (!mailto) return;
											// Read by a machine: no signature.
											openCompose("new", { to: mailto.to, subject: mailto.subject, text: mailto.body }, { signature: false });
										}}
										className="inline-flex h-8 shrink-0 items-center gap-1 rounded-pill px-3 text-[12px] ring-1 ring-border transition-colors hover:bg-signal-soft dark:ring-glass-border"
									>
										<Mail className="size-3.5" />
										Unsubscribe
									</button>
								) : null}
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="flex flex-row items-center gap-5 rounded-[22px] bg-card-nested p-4 lg:w-52 lg:flex-col lg:justify-center dark:ring-1 dark:ring-glass-border">
				{usedPct !== null ? (
					<Ring value={usedPct} size={112} stroke={9} label={`Storage ${usedPct}% used`} delay={400}>
						<span className="block font-display text-[26px] leading-none tabular">{usedPct}%</span>
						<span className="mt-1 block text-[10px] opacity-70">storage</span>
					</Ring>
				) : null}
				<div className="min-w-0 flex-1 text-[12px] lg:w-full lg:flex-none lg:text-center">
					<p className="font-medium">
						{overview.attachments.count} {overview.attachments.count === 1 ? "email" : "emails"} with files ·{" "}
						{formatBytes(overview.attachments.bytes)}
					</p>
					{quota && (
						<p className="text-ink-2">
							{formatBytes(quota.usedBytes)} of {formatBytes(quota.limitBytes)}
						</p>
					)}
					{largest && (
						<Link
							href={mailLink(largest)}
							title={largest.subject}
							className="mt-2 block truncate rounded-md text-ink-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							Largest · {formatBytes(largest.bytes)} · {largest.subject}
						</Link>
					)}
				</div>
			</div>
		</Bento>
	);
}
