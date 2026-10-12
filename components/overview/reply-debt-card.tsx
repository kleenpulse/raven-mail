import Link from "next/link";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { CountUp } from "@/components/viz/count-up";
import { formatAge, formatDuration, mailLink } from "@/lib/jev/ask/format";
import { initials } from "@/lib/format";
import type { Overview } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

/**
 * What you owe, as one number that grows like interest — plus the payoff plan
 * and the people who've gone quiet on you (judged against their own pace).
 */
export function ReplyDebtCard({ overview, i = 0 }: { overview: Overview; i?: number }) {
	const { obligations } = overview;
	const debt = obligations.replyDebtHours;
	const prev = obligations.replyDebtPrevHours;
	const meter = Math.min(100, (debt / Math.max(debt, prev, 72)) * 100);
	const trend = prev ? Math.round(((debt - prev) / prev) * 100) : null;

	return (
		<Bento i={i} className="flex flex-col gap-4">
			<div className="flex items-baseline justify-between gap-2">
				<BentoTitle>Reply debt</BentoTitle>
				{trend !== null && (
					<span className={cn("tabular font-mono text-[11px]", trend > 0 ? "text-signal-ink" : "text-ok")}>
						{trend > 0 ? "▲" : "▼"} {Math.abs(trend)}% vs a week ago
					</span>
				)}
			</div>

			<div>
				<p className="flex items-baseline gap-1.5">
					<CountUp value={debt} className="font-display text-kpi" />
					<span className="text-sm text-ink-2">hours owed</span>
				</p>
				<div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10" role="img" aria-label={`Reply debt ${debt} hours`}>
					<div className="h-full rounded-full bg-signal transition-[width] duration-700" style={{ width: `${meter}%` }} />
				</div>
				{obligations.payoff.refs.length > 0 && (
					<p className="mt-2 text-[13px] text-ink-2">
						Answer {obligations.payoff.refs.length === 1 ? "this one" : `these ${obligations.payoff.refs.length}`} →{" "}
						<span className="text-foreground">−{obligations.payoff.sharePct}%</span>
					</p>
				)}
			</div>

			{obligations.payoff.refs.length > 0 && (
				<ul className="space-y-1">
					{obligations.payoff.refs.map((r) => (
						<li key={`${r.folder}:${r.uid}`}>
							<Link
								href={mailLink(r)}
								className="flex items-center gap-3 rounded-[14px] px-2 py-1.5 transition-colors hover:bg-card-nested"
							>
								<span className="grid size-7 shrink-0 place-items-center rounded-full bg-signal-soft font-mono text-[10px] font-semibold text-signal-ink dark:text-signal">
									{initials(r.from.name, r.from.address)}
								</span>
								<span className="min-w-0 flex-1 truncate text-[13px]">{r.subject}</span>
								<span className="tabular shrink-0 font-mono text-[11px] text-ink-2">{formatAge(r.ageHours)}</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			<div className="mt-auto border-t border-border pt-3 dark:border-glass-border">
				<p className="text-[13px] font-medium">
					Gone quiet <span className="text-ink-2">· {obligations.waitingOn.length}</span>
				</p>
				{obligations.waitingOn.length === 0 ? (
					<p className="mt-1 text-[12px] text-ink-2">Everyone you asked got back to you.</p>
				) : (
					<ul className="mt-2 space-y-1">
						{obligations.waitingOn.slice(0, 4).map((w) => (
							<li key={`${w.folder}:${w.uid}`}>
								<Link href={mailLink(w)} className="block rounded-[14px] px-2 py-1.5 transition-colors hover:bg-card-nested">
									<span className="flex items-baseline justify-between gap-2 text-[13px]">
										<span className="truncate">{w.to.name}</span>
										<span className="tabular shrink-0 font-mono text-[11px] text-signal-ink dark:text-signal">
											{formatAge(w.ageHours)} silent
										</span>
									</span>
									<span className="block truncate text-[12px] text-ink-2">
										{w.baselineHours ? `Usually replies in ${formatDuration(w.baselineHours * 60)} · ` : ""}
										{w.subject}
									</span>
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
		</Bento>
	);
}
