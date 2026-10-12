"use client";

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CountUp } from "@/components/viz/count-up";
import { Bento } from "@/components/overview/bento";
import { PeopleStack } from "@/components/overview/people-stack";
import { formatAge } from "@/lib/jev/ask/format";
import type { Overview } from "@/lib/insights/types";

export type ObligationSet = {
	count: number;
	oldest?: { name: string; age: string };
	people: { name: string }[];
};

export type Obligations = {
	needsReply: ObligationSet;
	waitingOn: ObligationSet;
	replyDebtHours: number;
	/** null when there's no earlier debt to compare against. */
	debtDeltaPct: number | null;
};

export function obligationsOf(overview: Overview): Obligations {
	const { obligations, kpis } = overview;
	const unique = (names: string[]) => [...new Set(names)].slice(0, 4).map((name) => ({ name }));
	const oldest = obligations.needsReply[0];
	const silent = obligations.waitingOn[0];
	const prev = obligations.replyDebtPrevHours;
	return {
		needsReply: {
			count: kpis.needsReply,
			oldest: oldest ? { name: oldest.from.name, age: formatAge(oldest.ageHours) } : undefined,
			people: unique(obligations.needsReply.map((r) => r.from.name)),
		},
		waitingOn: {
			count: kpis.waitingOn,
			oldest: silent ? { name: silent.to.name, age: formatAge(silent.ageHours) } : undefined,
			people: unique(obligations.waitingOn.map((w) => w.to.name)),
		},
		replyDebtHours: obligations.replyDebtHours,
		debtDeltaPct: prev ? Math.round(((obligations.replyDebtHours - prev) / prev) * 100) : null,
	};
}

type Mode = "needs" | "waiting";

/** The reference's card widget, re-cast as the two numbers that matter: what you owe, who owes you. */
export function NeedsReplyCard({
	data,
	onOpen,
	i = 0,
}: {
	data: Obligations;
	onOpen: (mode: "needs" | "waiting") => void;
	i?: number;
}) {
	const [mode, setMode] = React.useState<Mode>("needs");
	const set = mode === "needs" ? data.needsReply : data.waitingOn;
	const improving = (data.debtDeltaPct ?? 0) <= 0;

	return (
		<Bento i={i} className="flex flex-col gap-3 p-2.5">
			<div className="flex flex-1 flex-col rounded-[22px] bg-card-nested p-5 dark:ring-1 dark:ring-glass-border">
				<div className="flex items-start justify-between gap-3">
					<p className="text-[13px] text-ink-2">{mode === "needs" ? "People waiting on you" : "You're waiting on"}</p>
					<span className="inline-flex h-7 items-center rounded-pill px-3 font-mono text-[11px] text-ink-2 ring-1 ring-border dark:ring-glass-border">
						last 14 days
					</span>
				</div>

				<div className="mt-3 flex items-end justify-between gap-4">
					<div className="flex items-baseline gap-2">
						<CountUp key={mode} value={set.count} className="font-display text-kpi" />
						<span className="text-sm text-ink-2">threads</span>
					</div>
					<PeopleStack people={set.people} />
				</div>
				<p className="mt-2 mb-5 text-[13px] text-ink-2">
					{set.oldest ? (
						<>
							Oldest: <span className="text-foreground">{set.oldest.name}</span> · {set.oldest.age}
						</>
					) : (
						"All clear"
					)}
				</p>

				<ToggleGroup
					value={[mode]}
					onValueChange={(next) => {
						const value = next[0] as Mode | undefined;
						if (value) setMode(value);
					}}
					variant="pill"
					size="pill"
					spacing={0}
					className="mt-auto w-full rounded-pill bg-card p-1 dark:bg-background/40"
				>
					<ToggleGroupItem value="needs" className="flex-1 rounded-pill">
						Needs reply
					</ToggleGroupItem>
					<ToggleGroupItem value="waiting" className="flex-1 rounded-pill">
						Waiting on
					</ToggleGroupItem>
				</ToggleGroup>
			</div>

			<div className="flex items-end justify-between gap-3 px-3 pb-2">
				<div>
					<p className="text-xs text-ink-2">Reply debt</p>
					<p className="mt-1 flex items-baseline gap-2">
						<CountUp value={data.replyDebtHours} format={(n) => `${Math.round(n).toLocaleString()}h`} className="font-display text-kpi-sm" delay={120} />
						{data.debtDeltaPct !== null && (
							<span className={improving ? "text-xs text-ok" : "text-xs text-signal-ink"}>
								{improving ? "▼" : "▲"} {Math.abs(data.debtDeltaPct)}% vs a week ago
							</span>
						)}
					</p>
				</div>
				<button
					type="button"
					onClick={() => onOpen(mode)}
					className="group flex items-center gap-2.5 text-left text-[12px] leading-tight text-signal-ink dark:text-signal"
				>
					<span className="grid size-8 place-items-center rounded-full bg-signal text-white transition-transform duration-200 group-hover:rotate-45 dark:text-inverse-foreground">
						<ArrowUpRight className="size-4" />
					</span>
					<span>
						Open
						<br />
						the list
					</span>
				</button>
			</div>
		</Bento>
	);
}
