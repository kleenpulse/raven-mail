"use client";

import * as React from "react";
import { useInView } from "motion/react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { DailyBrief } from "@/components/overview/daily-brief";
import { MailMixCard } from "@/components/overview/mail-mix-card";
import { NeedsReplyCard, obligationsOf } from "@/components/overview/needs-reply-card";
import { RhythmSparkCard } from "@/components/overview/rhythm-spark-card";
import { ThreadsRadar } from "@/components/overview/threads-radar";
import { VolumeCard } from "@/components/overview/volume-card";
import { WeatherCard } from "@/components/overview/weather-card";
import { AccountProvider, type Account } from "@/components/providers/account-provider";
import { DotMatrix, type DotState } from "@/components/viz/dot-matrix";
import { DemoBadge, DemoGuard } from "@/components/landing/demo-guard";
import { useAskFromBoard } from "@/components/landing/demo-ask";
import type { Overview } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

/** DailyBrief reads an account for its triage cache key; nothing is fetched for it. */
const DEMO_ACCOUNT: Account = {
	email: "demo@raven.invalid",
	displayName: "Demo",
	provider: "Demo mailbox",
	jev: { source: null, hint: null, kage: false, live: false },
};

// Illustrative: the real streak is tracked on the visitor's own device, so the demo mailbox has none.
const STREAK: DotState[] = [
	...(["miss", "hit", "hit", "miss", "miss", "hit", "miss", "hit", "miss", "miss"] as const),
	...(["hit", "hit", "hit", "grace", "hit", "hit", "hit", "hit", "hit", "miss"] as const),
];

function StreakDemo({ i }: { i: number }) {
	return (
		<Bento i={i} className="flex flex-col">
			<BentoTitle>Reply-zero streak</BentoTitle>
			<p className="mt-3 font-display text-kpi-sm tabular">
				8 <span className="text-base text-ink-2">days</span>
			</p>
			<p className="mt-1 text-[12px] text-ink-2">Clear your replies to extend it</p>
			<DotMatrix days={STREAK} label="8 day streak of owing no replies, over the last 20 days" className="mt-auto pt-4" />
			<p className="mt-2 font-mono text-[10px] text-ink-3">Tracked on your device only</p>
		</Bento>
	);
}

// lg+: two rows — five small cards, then the three wide ones.
const SPANS = [3, 3, 2, 2, 2, 3, 6, 3];

function Placeholder() {
	return (
		<>
			{SPANS.map((span, idx) => (
				<div
					key={idx}
					aria-hidden
					className={cn("col-span-12 h-[300px] rounded-card bg-card md:col-span-6", {
						"lg:col-span-2": span === 2,
						"lg:col-span-3": span === 3,
						"lg:col-span-6": span === 6,
					})}
				/>
			))}
		</>
	);
}

/**
 * The Overview's essentials on the demo mailbox, zoomed to fit one laptop
 * viewport (`demo-fit`). Cards mount as the sheet arrives, so their entrance
 * choreography plays where it's seen; card actions replay the matching Ask Jev
 * answer further down the page.
 */
export function DemoBoard({ overview }: { overview: Overview }) {
	const ref = React.useRef<HTMLDivElement>(null);
	const arrived = useInView(ref, { once: true, amount: 0.12 });
	const onAsk = useAskFromBoard();
	const obligations = React.useMemo(() => obligationsOf(overview), [overview]);
	// Three hot threads keep the radar under Mail mix, which then sets row two's height.
	const radar = React.useMemo(() => ({ ...overview, hotThreads: overview.hotThreads.slice(0, 3) }), [overview]);
	const todayKey = overview.volume.days.at(-1)?.date ?? "";

	return (
		<div ref={ref} className="demo-fit mx-auto max-w-[1480px] rounded-frame border-glass-border sm:border sm:bg-sheet sm:shadow-card">
			<header className="flex items-center justify-between gap-3 px-2 sm:px-5 sm:pt-5 md:px-6">
				<p className="flex min-w-0 items-baseline gap-2.5">
					<span className="font-display text-[19px] leading-tight tracking-[-0.01em]">Overview</span>
					<span className="truncate text-[13px] text-ink-2">Inbox + Sent · last 30 days</span>
				</p>
				<DemoBadge />
			</header>

			<DemoGuard className="grid grid-cols-12 gap-3 pt-4 sm:px-5 sm:pb-5 md:px-6">
				{!arrived ? (
					<Placeholder />
				) : (
					<AccountProvider account={DEMO_ACCOUNT}>
						<div className="col-span-12 md:col-span-6 lg:col-span-3 *:h-full">
							<NeedsReplyCard
								data={obligations}
								onOpen={(mode) =>
									mode === "needs"
										? onAsk("Who’s waiting on my reply?", { forcedIntent: "needs_reply" })
										: onAsk("Who owes me a reply?", { forcedIntent: "awaiting_others" })
								}
								i={1}
							/>
						</div>
						<div className="col-span-12 md:col-span-6 lg:col-span-3 *:h-full">
							<VolumeCard overview={overview} i={2} />
						</div>
						<div className="col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-2 *:h-full">
							<WeatherCard overview={overview} i={3} />
						</div>
						<div className="col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-2 *:h-full">
							<StreakDemo i={4} />
						</div>
						<div className="col-span-12 md:col-span-4 lg:col-span-2 *:h-full">
							<RhythmSparkCard overview={overview} i={5} />
						</div>

						<div className="col-span-12 md:col-span-6 lg:col-span-3 *:h-full">
							<MailMixCard overview={overview} onAsk={onAsk} i={6} />
						</div>
						{/* Phones: hidden, the board is long enough there. Tablets: full width under Mail mix + brief; desktop: the middle of row two. */}
						<div className="col-span-12 hidden sm:block md:order-last lg:order-none lg:col-span-6 *:h-full">
							<ThreadsRadar
								overview={radar}
								onAsk={onAsk}
								onReviewHygiene={() => onAsk("Newsletters I never open", { forcedIntent: "newsletters" })}
								i={7}
							/>
						</div>
						<div className="col-span-12 md:col-span-6 lg:col-span-3 *:h-full">
							<DailyBrief items={overview.brief} todayKey={todayKey} engine={null} demo i={8} />
						</div>
					</AccountProvider>
				)}
			</DemoGuard>
		</div>
	);
}
