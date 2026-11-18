"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { HeroBand } from "@/components/overview/hero-band";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { NeedsReplyCard, obligationsOf } from "@/components/overview/needs-reply-card";
import { VolumeCard } from "@/components/overview/volume-card";
import { WeatherCard } from "@/components/overview/weather-card";
import { StreakCard } from "@/components/overview/streak-card";
import { RhythmSparkCard } from "@/components/overview/rhythm-spark-card";
import { MailMixCard } from "@/components/overview/mail-mix-card";
import { ThreadsRadar } from "@/components/overview/threads-radar";
import { DailyBrief } from "@/components/overview/daily-brief";
import type { DecisionEngine } from "@/lib/jev/client";
import { ReplyDebtCard } from "@/components/overview/reply-debt-card";
import { FollowUpsCard } from "@/components/overview/follow-ups-card";
import { OrbitCard } from "@/components/overview/orbit-card";
import { BoardGrid } from "@/components/overview/board-grid";
import { OverviewSearch } from "@/components/overview/overview-search";
import { SponsorButton } from "@/components/shell/sponsor-button";
import { UpdatePill } from "@/components/shell/update-pill";
import { useAccount } from "@/components/providers/account-provider";
import { useAsk, type AskOptions } from "@/components/jev/use-ask";
import { useOverview } from "@/hooks/use-overview";
import { useIntroGate } from "@/hooks/use-intro-gate";
import { useNow } from "@/hooks/use-now";
import { useStreakLog } from "@/hooks/use-streak-log";
import { smartChips } from "@/lib/jev/ask/chips";
import { formatRelative, initials } from "@/lib/format";
import { initBoardState } from "@/lib/overview-board/state";
import type { WidgetId } from "@/lib/overview-board/widgets";
import { cn } from "@/lib/utils";
import { LayoutScroll } from "@/components/ui/layout-scroll";

const FALLBACK_SUGGESTIONS = ["Who’s waiting on my reply?", "What did I miss today?", "Newsletters I never open"];

function useSyncedLabel(syncedAt: string | undefined): string {
	const now = useNow();
	if (now === null || !syncedAt) return "syncing…";
	// A reload paints the cached board first, so this can read hours old until the refetch lands.
	return now - Date.parse(syncedAt) < 60_000 ? "synced just now" : `synced ${formatRelative(syncedAt)}`;
}

function BoardSkeleton() {
	const block = "animate-in fade-in fill-mode-both delay-300 duration-200 rounded-card bg-card";
	return (
		<div className="grid grid-cols-12 gap-4" aria-busy="true" aria-label="Loading overview">
			{[4, 4, 2, 2, 3, 6, 3].map((span, idx) => (
				<div
					key={idx}
					className={cn(block, "col-span-12 h-[300px] animate-pulse md:col-span-6", {
						"xl:col-span-4": span === 4,
						"xl:col-span-2": span === 2,
						"xl:col-span-3": span === 3,
						"xl:col-span-6": span === 6,
					})}
				/>
			))}
		</div>
	);
}

export function OverviewBoard({
	firstName,
	engine,
	owner,
}: {
	firstName: string;
	engine: DecisionEngine | null;
	/** The signed-in mailbox's opaque id: the saved board is kept per mailbox. */
	owner: string | null;
}) {
	const account = useAccount();
	const introRef = useIntroGate<HTMLDivElement>();
	const { data, isPending, isError, error, refetch, isFetching } = useOverview(30);
	const ask = useAsk();
	const synced = useSyncedLabel(data?.syncedAt);

	const onAsk = React.useCallback((question: string, options?: AskOptions) => void ask(question, options), [ask]);
	const suggestions = data ? smartChips(data).map((c) => c.label) : FALLBACK_SUGGESTIONS;
	const todayKey = data?.volume.days.at(-1)?.date;

	// Before paint, so the saved board is in place when the first card draws.
	React.useLayoutEffect(() => {
		if (owner) initBoardState(owner);
	}, [owner]);

	// Here, not in the streak card: the day still counts when that card is off the board.
	useStreakLog(todayKey, data?.today.needsReplyZero ?? false);

	// One element per card, rebuilt only when what the cards show changes. The grid re-renders
	// on every drag step and clock tick; with stable elements the cards themselves do not.
	const tiles = React.useMemo(() => {
		if (!data || !todayKey) return null;
		return {
			"needs-reply": (
				<NeedsReplyCard
					data={obligationsOf(data)}
					onOpen={(mode) =>
						mode === "needs"
							? onAsk("Who’s waiting on my reply?", { forcedIntent: "needs_reply" })
							: onAsk("Who owes me a reply?", { forcedIntent: "awaiting_others" })
					}
					i={2}
				/>
			),
			volume: <VolumeCard overview={data} i={3} />,
			"inbox-weather": <WeatherCard overview={data} i={4} />,
			streak: <StreakCard todayKey={todayKey} zeroToday={data.today.needsReplyZero} i={5} />,
			"mail-mix": <MailMixCard overview={data} onAsk={onAsk} i={6} />,
			"threads-radar": (
				<ThreadsRadar
					overview={data}
					onAsk={onAsk}
					onReviewHygiene={() => onAsk("Newsletters I never open", { forcedIntent: "newsletters" })}
					i={7}
				/>
			),
			"daily-brief": <DailyBrief items={data.brief} todayKey={todayKey} engine={engine} i={8} />,
			"rhythm-spark": <RhythmSparkCard overview={data} i={9} />,
			orbit: <OrbitCard overview={data} i={10} />,
			"reply-debt": <ReplyDebtCard overview={data} i={11} />,
		} satisfies Record<WidgetId, React.ReactNode>;
	}, [data, todayKey, engine, onAsk]);

	return (
		<LayoutScroll ref={introRef} className="h-full overflow-y-auto">
			<div className="mx-auto max-w-[calc(1900px-84px)] px-5 pt-6 md:px-8">
				<header className="entrance flex items-center justify-between gap-4">
					<div className="min-w-0">
						<h1 className="font-display text-[22px] leading-tight tracking-[-0.01em]">Overview</h1>
						<p className="flex items-center gap-2 text-[13px] text-ink-2">
							<span className="truncate">Inbox + Sent · last 30 days · {synced}</span>
							<button
								type="button"
								onClick={() => void refetch()}
								aria-label="Refresh overview"
								className="grid size-6 place-items-center rounded-full hover:bg-card-nested hover:text-foreground"
							>
								<RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
							</button>
						</p>
					</div>
					<div className="flex items-center gap-3">
						<OverviewSearch />
						<div className="hidden items-center gap-3 sm:flex">
							<span className="grid size-11 place-items-center rounded-full bg-signal-soft font-display text-sm font-semibold text-signal-ink dark:text-signal">
								{initials(account.displayName, account.email)}
							</span>
							<div className="leading-tight">
								<p className="text-sm font-medium">{account.displayName}</p>
								<p className="text-xs text-ink-2">{account.provider}</p>
							</div>
						</div>
						<UpdatePill />
						<SponsorButton />
					</div>
				</header>

				<div className="mt-9 pb-10">
					<HeroBand
						firstName={firstName}
						engine={engine}
						suggestions={suggestions}
						invites={data?.invites.length ?? 0}
						onAsk={(q) => onAsk(q)}
					/>
				</div>
			</div>

			<div className="min-h-[70%] rounded-t-frame bg-sheet dark:border-t dark:border-glass-border">
				<div className="mx-auto flex max-w-[calc(1900px-84px)] flex-col gap-4 px-5 py-6 md:px-8 md:py-8">
					{isPending && <BoardSkeleton />}

					{isError && (
						<Bento className="flex flex-col items-start gap-3">
							<BentoTitle>Couldn’t read your mailbox</BentoTitle>
							<p className="text-[13px] text-ink-2">{error instanceof Error ? error.message : "Unknown error"}</p>
							<button
								type="button"
								onClick={() => void refetch()}
								className="h-9 rounded-pill bg-primary px-4 text-[13px] font-medium text-primary-foreground"
							>
								Try again
							</button>
						</Bento>
					)}

					{tiles && (
						<>
							{data?.truncated && (
								<p className="-mb-1 font-mono text-[11px] text-ink-2">Based on the latest 1,500 messages per folder.</p>
							)}
							{/* Pinned above the board: it shows nothing when no reminder is set, so it cannot hold a place on the grid. */}
							<FollowUpsCard i={1} />
							<BoardGrid tiles={tiles} />
						</>
					)}
				</div>
			</div>
		</LayoutScroll>
	);
}
