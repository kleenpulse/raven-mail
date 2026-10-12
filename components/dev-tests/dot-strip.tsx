"use client";

import * as React from "react";
import { StatusPill } from "@/components/integrations/status-pill";
import type { RunDot } from "@/lib/dev/test-run-state";
import { cn } from "@/lib/utils";
import { formatMs, STATUS_LABEL, STATUS_TONE } from "./shared";

const DOT = { pass: "bg-ok", fail: "bg-critical", skip: "bg-ink-3", todo: "bg-ink-3" } as const;
const TIP_W = 300;

type Tip = { i: number; x: number; y: number };

/**
 * One dot per finished test. A single hover card follows the pointer via event
 * delegation — a tooltip per dot would mean a thousand-plus popovers mid-run.
 */
export function DotStrip({ dots, running }: { dots: RunDot[]; running: boolean }) {
	const ref = React.useRef<HTMLDivElement>(null);
	const [tip, setTip] = React.useState<Tip | null>(null);

	const onPointerMove = (e: React.PointerEvent) => {
		const dot = (e.target as HTMLElement).closest<HTMLElement>("[data-dot]");
		const root = ref.current;
		if (!dot || !root) return setTip(null);
		const i = Number(dot.dataset.dot);
		if (tip?.i === i) return;
		const box = dot.getBoundingClientRect();
		const rootBox = root.getBoundingClientRect();
		const half = TIP_W / 2;
		const x = Math.min(Math.max(box.left - rootBox.left + box.width / 2, half), Math.max(half, root.clientWidth - half));
		setTip({ i, x, y: box.top - rootBox.top });
	};

	const d = tip ? dots[tip.i] : undefined;

	return (
		<div ref={ref} className="relative mt-4" onPointerMove={onPointerMove} onPointerLeave={() => setTip(null)}>
			<div className="flex flex-wrap gap-[3px]">
				{dots.map((dot, i) => (
					<span
						key={i}
						data-dot={i}
						aria-hidden
						className={cn(
							"size-[7px] rounded-full transition-transform duration-100",
							DOT[dot.status],
							tip?.i === i && "scale-[1.8] ring-2 ring-foreground/30",
						)}
					/>
				))}
				{running && <span aria-hidden className="size-[7px] animate-pulse rounded-full bg-signal" />}
			</div>
			{d && tip && (
				<div
					role="tooltip"
					className="pointer-events-none absolute z-20 rounded-[14px] bg-popover px-3.5 py-3 text-popover-foreground shadow-lift ring-1 ring-border dark:ring-glass-border"
					style={{ left: tip.x, top: tip.y - 10, width: TIP_W, transform: "translate(-50%, -100%)" }}
				>
					<div className="flex items-center justify-between gap-2">
						<StatusPill tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</StatusPill>
						<span className="tabular font-mono text-[11px] text-ink-2">
							#{tip.i + 1} of {dots.length}
							{d.ms !== undefined && ` · ${formatMs(d.ms)}`}
						</span>
					</div>
					<p className="mt-2 line-clamp-2 text-[13px] leading-snug">{d.name}</p>
					<p className="mt-1 truncate font-mono text-[11px] text-ink-2">{d.file}</p>
				</div>
			)}
		</div>
	);
}
