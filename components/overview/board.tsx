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
import { OverviewSearch } from "@/components/overview/overview-search";
import { SponsorButton } from "@/components/shell/sponsor-button";
import { useAccount } from "@/components/providers/account-provider";
import { useAsk, type AskOptions } from "@/components/jev/use-ask";
import { useOverview } from "@/hooks/use-overview";
import { useIntroGate } from "@/hooks/use-intro-gate";
import { useNow } from "@/hooks/use-now";
import { smartChips } from "@/lib/jev/ask/chips";
import { formatRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TOUR_TARGET, tourAttr } from "@/components/tour/anchors";
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
		<div className="col-span-12 grid grid-cols-12 gap-4" aria-busy="true" aria-label="Loading overview">
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

export function OverviewBoard({ firstName, engine }: { firstName: string; engine: DecisionEngine | null }) {
	const account = useAccount();
	const introRef = useIntroGate<HTMLDivElement>();
	const { data, isPending, isError, error, refetch, isFetching } = useOverview(30);
	const ask = useAsk();
	const synced = useSyncedLabel(data?.syncedAt);

	const onAsk = React.useCallback((question: string, options?: AskOptions) => void ask(question, options), [ask]);
	const suggestions = data ? smartChips(data).map((c) => c.label) : FALLBACK_SUGGESTIONS;
	const todayKey = data?.volume.days.at(-1)?.date;

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
				<div className="mx-auto grid max-w-[calc(1900px-84px)] grid-cols-12 gap-4 px-5 py-6 md:px-8 md:py-8">
					{isPending && <BoardSkeleton />}

					{isError && (
						<Bento className="col-span-12 flex flex-col items-start gap-3">
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

					{data && todayKey && (
						<>
							{data.truncated && (
								<p className="col-span-12 -mb-1 font-mono text-[11px] text-ink-2">
									Based on the latest 1,500 messages per folder.
								</p>
							)}
							<FollowUpsCard className="order-first col-span-12" i={1} />
							<div
								{...tourAttr(TOUR_TARGET.needsReply)}
								className="order-2 col-span-12 md:order-3 md:col-span-6 xl:order-none xl:col-span-4 *:h-full"
							>
								<NeedsReplyCard
									data={obligationsOf(data)}
									onOpen={(mode) =>
										mode === "needs"
											? onAsk("Who’s waiting on my reply?", { forcedIntent: "needs_reply" })
											: onAsk("Who owes me a reply?", { forcedIntent: "awaiting_others" })
									}
									i={2}
								/>
							</div>
							<div className="order-4 col-span-12 md:col-span-6 xl:order-none xl:col-span-4 *:h-full">
								<VolumeCard overview={data} i={3} />
							</div>
							<div className="order-5 col-span-12 sm:col-span-6 md:order-6 md:col-span-3 xl:order-none xl:col-span-2 *:h-full">
								<WeatherCard overview={data} i={4} />
							</div>
							<div className="order-5 col-span-12 sm:col-span-6 md:order-6 md:col-span-3 xl:order-none xl:col-span-2 *:h-full">
								<StreakCard todayKey={todayKey} zeroToday={data.today.needsReplyZero} i={5} />
							</div>

							<div className="order-6 col-span-12 md:order-5 md:col-span-6 xl:order-none xl:col-span-3 *:h-full">
								<MailMixCard overview={data} onAsk={onAsk} i={6} />
							</div>
							<div className="order-7 col-span-12 xl:order-none xl:col-span-6 *:h-full">
								<ThreadsRadar
									overview={data}
									onAsk={onAsk}
									onReviewHygiene={() => onAsk("Newsletters I never open", { forcedIntent: "newsletters" })}
									i={7}
								/>
							</div>
							<div className="order-1 col-span-12 flex flex-col gap-4 md:col-span-6 xl:order-none xl:col-span-3 [&>section:first-child]:flex-1">
								<DailyBrief items={data.brief} todayKey={todayKey} engine={engine} i={8} />
								<RhythmSparkCard overview={data} i={9} />
							</div>

							<div
								{...tourAttr(TOUR_TARGET.orbit)}
								className="order-8 col-span-12 xl:order-none xl:col-span-8 *:h-full"
							>
								<OrbitCard overview={data} i={10} />
							</div>
							<div className="order-3 col-span-12 md:order-2 md:col-span-6 xl:order-none xl:col-span-4 *:h-full">
								<ReplyDebtCard overview={data} i={11} />
							</div>
						</>
					)}
				</div>
			</div>
		</LayoutScroll>
	);
}
