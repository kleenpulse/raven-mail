"use client";

import * as React from "react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { heuristicTriage } from "@/lib/triage/heuristic";
import { useDeepTriageMap } from "@/hooks/use-deep-triage";
import type { TriageResult } from "@/lib/mail/types";

const CATEGORY_LABEL: Record<TriageResult["category"], string> = {
	primary: "Primary",
	updates: "Updates",
	receipts: "Receipt",
	promotions: "Promo",
	newsletters: "News",
	social: "Social",
	other: "Other",
};

const URGENCY_LABEL = ["", "Low urgency", "Elevated urgency", "High urgency"] as const;

export function useLocalTriage(input: {
	subject: string;
	snippet?: string;
	from?: string;
}): TriageResult {
	const { subject, snippet, from } = input;
	return React.useMemo(
		() => heuristicTriage({ subject, snippet, from }),
		[subject, snippet, from],
	);
}

/**
 * Urgency as a three-step signal-strength glyph. Absent when there is no
 * signal, so calm mail stays unmarked; only the top step turns critical.
 */
/** Jev's verdict when Deep triage has seen this message, otherwise the free heuristic. */
export function useMessageTriage(
	input: { subject: string; snippet?: string; from?: string },
	ref: { folder: string; uid: string } | null,
): TriageResult {
	const local = useLocalTriage(input);
	const deep = useDeepTriageMap();
	return (ref && deep.get(`${ref.folder}:${ref.uid}`)) || local;
}

export function SignalBar({
	urgency,
	active,
}: {
	urgency: number;
	active: boolean;
}) {
	const level = Math.max(0, Math.min(3, Math.round(urgency * 3))) as 0 | 1 | 2 | 3;
	if (level === 0) return null;
	return (
		<Tip
			label={URGENCY_LABEL[level]}
			render={<span role="img" aria-label={URGENCY_LABEL[level]} data-level={level} className="inline-flex h-2.5 items-end gap-0.5" />}
		>
			{([1, 2, 3] as const).map((step) => (
				<span
					key={step}
					className={cn(
						"w-0.75 rounded-full",
						step === 1 ? "h-1" : step === 2 ? "h-1.75" : "h-2.5",
						step > level
							? "bg-foreground/15"
							: level === 3
								? "bg-critical"
								: active
									? "bg-signal-ink dark:bg-signal"
									: "bg-ink-2",
					)}
				/>
			))}
		</Tip>
	);
}

export function TriageBadge({
	result,
	className,
}: {
	result: TriageResult;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-7 items-center gap-2 rounded-pill bg-card-nested pr-3 pl-3 text-[12px] text-ink-2 ring-1 ring-border dark:ring-glass-border",
				className,
			)}
		>
			<span className="font-mono text-[10.5px] tracking-[0.08em] text-foreground uppercase">
				{CATEGORY_LABEL[result.category]}
			</span>
			{result.source !== "heuristic" && (
				<span className="font-mono text-[10.5px] tracking-[0.08em] uppercase">· {result.source === "kage" ? "Kage" : "Jev"}</span>
			)}
		</span>
	);
}
