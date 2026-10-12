"use client";

import { ArrowUpRight } from "lucide-react";
import { Bento } from "@/components/overview/bento";
import { BrandTile } from "@/components/integrations/brand-marks";
import { StatusPill, type Tone } from "@/components/integrations/status-pill";
import type { CatalogEntry } from "@/lib/integrations/catalog";
import { cn } from "@/lib/utils";

/**
 * A catalog tile. The whole card opens the detail sheet (the action button's
 * hit area stretches over it); anything needing attention wears the red sweep.
 */
export function IntegrationCard({
	entry,
	i,
	tone,
	status,
	lines,
	action,
	onOpen,
	className,
}: {
	entry: CatalogEntry;
	i: number;
	tone: Tone;
	status: string;
	lines: React.ReactNode[];
	action: string;
	onOpen: () => void;
	className?: string;
}) {
	const attention = tone === "attention";
	return (
		<Bento
			i={i}
			aria-label={entry.name}
			className={cn(
				"group/card flex h-full flex-col gap-4 transition-[box-shadow,transform] duration-200 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-lift",
				attention && "glow-sweep [--card-sweep-fill:var(--card)] dark:[--card-sweep-fill:var(--popover)]",
				className,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<BrandTile id={entry.id} />
				<StatusPill tone={tone}>{status}</StatusPill>
			</div>
			<div className="min-w-0">
				<h3 className="font-display text-[17px] leading-tight tracking-[-0.01em]">{entry.name}</h3>
				<p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-ink-2">{entry.blurb}</p>
			</div>
			{lines.length > 0 && (
				<ul className="space-y-1 text-[12px] text-ink-2">
					{lines.map((line, idx) => (
						<li key={idx} className="truncate">
							{line}
						</li>
					))}
				</ul>
			)}
			<div className="mt-auto flex items-center justify-between gap-3 pt-1">
				<button
					type="button"
					onClick={onOpen}
					className={cn(
						"inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] outline-none transition-transform after:absolute after:inset-0 after:rounded-card active:scale-[0.98]",
						attention
							? "bg-critical text-white"
							: tone === "idle"
								? "bg-inverse text-inverse-foreground"
								: "bg-sheet ring-1 ring-border dark:bg-card-nested dark:ring-glass-border",
					)}
				>
					{action}
				</button>
				<ArrowUpRight aria-hidden className="size-4 text-ink-3 transition-transform group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5" />
			</div>
		</Bento>
	);
}
