"use client";

import { Bento, BentoTitle } from "@/components/overview/bento";
import { Concentric } from "@/components/viz/concentric";
import type { AskOptions } from "@/components/jev/use-ask";
import type { MixBucket, Overview } from "@/lib/insights/types";
import type { Intent } from "@/lib/jev/ask/types";

const META: Record<MixBucket, { label: string; ask: string; intent: Intent }> = {
	people: { label: "People", ask: "What did people send me?", intent: "unread_summary" },
	notifications: { label: "Notifications", ask: "Any security alerts?", intent: "security" },
	newsletters: { label: "Newsletters", ask: "Newsletters I never open", intent: "newsletters" },
	transactions: { label: "Receipts", ask: "Receipts from this month", intent: "receipts" },
};

/** Where the mail actually comes from — the total unread count is mostly noise; the split is signal. */
export function MailMixCard({
	overview,
	onAsk,
	i = 0,
}: {
	overview: Overview;
	onAsk: (question: string, options?: AskOptions) => void;
	i?: number;
}) {
	const mix = overview.mix.filter((m) => m.count > 0);
	const total = mix.reduce((s, m) => s + m.count, 0);
	const people = overview.mix.find((m) => m.bucket === "people")?.count ?? 0;
	return (
		<Bento i={i} className="flex flex-col">
			<div className="flex items-baseline justify-between gap-2">
				<BentoTitle>Mail mix</BentoTitle>
				<span className="font-mono text-[11px] text-ink-2">30 days</span>
			</div>
			<p className="mt-2 flex items-baseline gap-1.5">
				<span className="font-display text-kpi-sm tabular">{total ? Math.round((people / total) * 100) : 0}%</span>
				<span className="text-[13px] text-ink-2">from people</span>
			</p>
			<Concentric
				rings={mix.map((m) => ({ key: m.bucket, label: META[m.bucket].label, value: m.count }))}
				onSelect={(ring) => {
					const meta = META[ring.key as MixBucket];
					onAsk(meta.ask, { forcedIntent: meta.intent });
				}}
				label={`Mail by source: ${mix.map((m) => `${META[m.bucket].label} ${m.count}`).join(", ")}`}
				className="mx-auto my-auto max-w-[240px] py-3"
			/>
			<ul className="space-y-1">
				{overview.mix.map((m) => (
					<li key={m.bucket}>
						<button
							type="button"
							onClick={() => onAsk(META[m.bucket].ask, { forcedIntent: META[m.bucket].intent })}
							className="flex w-full items-baseline gap-2 rounded-md text-left text-[12px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							<span className="flex-1 truncate text-ink-2">{META[m.bucket].label}</span>
							<span className="tabular font-mono">{m.count}</span>
							<span className="tabular w-16 shrink-0 text-right font-mono text-[11px] text-signal-ink dark:text-signal">
								{m.unread > 0 ? `${m.unread} unread` : ""}
							</span>
						</button>
					</li>
				))}
			</ul>
		</Bento>
	);
}
