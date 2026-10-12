import { cn } from "@/lib/utils";

export type DotState = "hit" | "grace" | "miss" | "unknown";

/** The reference's "13 Days" dot grid; fills diagonally on entrance. */
export function DotMatrix({
	days,
	columns = 10,
	label,
	className,
}: {
	days: DotState[];
	columns?: number;
	label: string;
	className?: string;
}) {
	return (
		<ol role="img" aria-label={label} className={cn("grid gap-1.5", className)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
			{days.map((state, i) => (
				<li
					key={i}
					className={cn(
						"entrance aspect-square rounded-full",
						state === "hit" && "bg-signal",
						state === "grace" && "bg-signal/40",
						state === "miss" && "bg-foreground/15",
						state === "unknown" && "ring-1 ring-foreground/15",
					)}
					style={{ ["--i" as string]: Math.floor(i / columns) + (i % columns) * 0.5 }}
				/>
			))}
		</ol>
	);
}
