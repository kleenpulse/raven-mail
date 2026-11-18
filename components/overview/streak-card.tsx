"use client";

import * as React from "react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { DotMatrix, type DotState } from "@/components/viz/dot-matrix";
import { shiftDateKey } from "@/lib/insights/bins";
import { useMounted } from "@/hooks/use-mounted";
import { useStreakLog } from "@/hooks/use-streak-log";

const DAYS = 20;

/**
 * The streak is tracked on this device (see useStreakLog). One grace day per
 * week keeps a single busy day from wiping the habit (streak research: broken
 * streaks demotivate).
 */
export function StreakCard({
	todayKey,
	zeroToday,
	i = 0,
}: {
	todayKey: string;
	zeroToday: boolean;
	i?: number;
}) {
	const mounted = useMounted();
	const log = useStreakLog(todayKey, zeroToday);

	const { dots, streak, tracked } = React.useMemo(() => {
		const keyAt = (back: number) => shiftDateKey(todayKey, -back);
		const stateOf = (k: string): DotState => (log[k] === 1 ? "hit" : log[k] === 0 ? "miss" : "unknown");
		const states = new Map<string, DotState>();
		let count = 0;
		let lastGrace = Number.NEGATIVE_INFINITY;
		let broken = false;
		for (let back = 0; back < DAYS; back++) {
			const key = keyAt(back);
			if (broken || back === 0) {
				// today is still in play: it can extend the streak but never break it
				if (!broken && log[key] === 1) count += 1;
				states.set(key, stateOf(key));
				continue;
			}
			if (log[key] === 1) {
				count += 1;
				states.set(key, "hit");
				continue;
			}
			const bridged = count > 0 && log[keyAt(back + 1)] === 1 && back - lastGrace >= 7;
			if (bridged) {
				lastGrace = back;
				states.set(key, "grace");
				continue;
			}
			broken = true;
			states.set(key, stateOf(key));
		}
		const keys = Array.from({ length: DAYS }, (_, idx) => keyAt(DAYS - 1 - idx));
		return { dots: keys.map((k) => states.get(k) ?? "unknown"), streak: count, tracked: Object.keys(log).length };
	}, [log, todayKey]);

	return (
		<Bento i={i} className="flex flex-col">
			<BentoTitle>Reply-zero streak</BentoTitle>
			<p className="mt-3 font-display text-kpi-sm tabular">
				{mounted ? streak : "—"} <span className="text-base text-ink-2">{streak === 1 ? "day" : "days"}</span>
			</p>
			<p className="mt-1 text-[12px] text-ink-2">
				{zeroToday ? "Owing nobody today" : "Clear your replies to extend it"}
			</p>
			<DotMatrix
				days={mounted ? dots : Array.from({ length: DAYS }, () => "unknown" as DotState)}
				label={`${streak} day streak of owing no replies, over the last ${DAYS} days`}
				className="mt-auto pt-4"
			/>
			<p className="mt-2 font-mono text-[10px] text-ink-3">
				{tracked <= 1 ? "Tracking starts today, on this device" : "Since you started using Raven here"}
			</p>
		</Bento>
	);
}
