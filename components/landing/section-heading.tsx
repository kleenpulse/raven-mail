import type * as React from "react";
import { cn } from "@/lib/utils";

/** Numbered like the login page's value props: mono index, display headline, ink-2 lede. */
export function SectionHeading({
	id,
	index,
	eyebrow,
	title,
	children,
	center = false,
	className,
}: {
	id: string;
	index: string;
	eyebrow: string;
	title: React.ReactNode;
	children?: React.ReactNode;
	center?: boolean;
	className?: string;
}) {
	return (
		<div className={cn("max-w-[52rem]", center && "mx-auto text-center", className)}>
			<p className={cn("readout flex items-center gap-2.5", center && "justify-center")}>
				<span className="text-signal tabular">{index}</span>
				<span aria-hidden className="h-px w-6 bg-glass-border" />
				{eyebrow}
			</p>
			<h2 id={id} className="mt-5 font-display text-[clamp(2.25rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.035em] text-balance">
				{title}
			</h2>
			{children && (
				<p className={cn("mt-5 max-w-[38rem] text-[16px] leading-relaxed text-pretty text-ink-2", center && "mx-auto")}>
					{children}
				</p>
			)}
		</div>
	);
}
