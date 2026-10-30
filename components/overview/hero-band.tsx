"use client";

import * as React from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import { HeroAsk } from "@/components/jev/hero-ask";
import { LocalWeather } from "@/components/overview/local-weather";
import type { DecisionEngine } from "@/lib/jev/client";
import { cn } from "@/lib/utils";

const minuteStamp = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Ticks on each minute boundary so the clock never lags the system time. */
function subscribeMinute(notify: () => void) {
	let timer: ReturnType<typeof setTimeout>;
	const schedule = () => {
		timer = setTimeout(() => {
			notify();
			schedule();
		}, minuteStamp() + 60_000 - Date.now());
	};
	schedule();
	return () => clearTimeout(timer);
}

/** Client clock only: the server's timezone must never pick the user's date. */
function useToday(): Date | null {
	const stamp = React.useSyncExternalStore(subscribeMinute, minuteStamp, () => null);
	return stamp === null ? null : new Date(stamp);
}

export function HeroBand({
	firstName,
	engine,
	suggestions,
	invites,
	onAsk,
}: {
	firstName: string;
	engine: DecisionEngine | null;
	suggestions: string[];
	invites: number;
	onAsk: (question: string) => void;
}) {
	const today = useToday();

	return (
		<section aria-label="Today" className="flex flex-col gap-8 xl:flex-row xl:items-center xl:gap-10">
			<div className="flex shrink-0 flex-wrap items-center gap-4 entrance" style={{ ["--i" as string]: 0 }}>
				<div className="flex items-center gap-3.5">
					<div className="grid size-[76px] place-items-center rounded-full bg-sheet ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
						<span className="tabular font-display text-[28px] leading-none tracking-tight">
							{today ? today.getDate() : "—"}
						</span>
					</div>
					<div className="font-display text-lg leading-tight">
						<div>
							{today ? today.toLocaleDateString(undefined, { weekday: "short" }) : " "},{" "}
							{today && (
								<time dateTime={today.toISOString()} className="tabular">
									{today.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
								</time>
							)}
						</div>
						<div className="text-ink-2">{today ? today.toLocaleDateString(undefined, { month: "long" }) : " "}</div>
						<LocalWeather />
					</div>
				</div>

				<span aria-hidden className="mx-1 hidden h-10 w-px bg-border sm:block" />

				<button
					type="button"
					onClick={() => onAsk("What needs my reply today?")}
					className="group inline-flex h-12 items-center gap-3 rounded-pill bg-primary pr-5 pl-6 text-sm font-medium text-primary-foreground transition-[box-shadow,transform] duration-200 hover:shadow-glow active:scale-[0.98]"
				>
					What needs me today
					<ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
				</button>

				<button
					type="button"
					onClick={() => onAsk("Any meeting invites this week?")}
					aria-label={invites ? `${invites} meeting invites` : "Meeting invites"}
					className="relative grid size-12 place-items-center rounded-full bg-sheet ring-1 ring-border transition-colors hover:bg-card dark:bg-card-nested dark:ring-glass-border dark:hover:bg-accent"
				>
					<CalendarDays className="size-[18px]" />
					{invites > 0 && (
						<span className={cn("absolute top-2.5 right-2.5 size-2 rounded-full bg-signal ring-2 ring-sheet dark:ring-transparent")} />
					)}
				</button>
			</div>

			<div className="min-w-0 flex-1 entrance" style={{ ["--i" as string]: 1 }}>
				<HeroAsk firstName={firstName} engine={engine} suggestions={suggestions} onAsk={onAsk} />
			</div>
		</section>
	);
}
