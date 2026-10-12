import type * as React from "react";
import { cn } from "@/lib/utils";

/** Bento card. `i` staggers its entrance (first session load only). */
export function Bento({
	i = 0,
	className,
	style,
	children,
	...props
}: React.ComponentProps<"section"> & { i?: number }) {
	return (
		<section
			className={cn("bento entrance relative min-w-0 p-5", className)}
			style={{ ["--i" as string]: i, ...style }}
			{...props}
		>
			{children}
		</section>
	);
}

export function BentoTitle({ className, ...props }: React.ComponentProps<"h2">) {
	return <h2 className={cn("font-display text-[17px] leading-tight tracking-[-0.01em]", className)} {...props} />;
}
