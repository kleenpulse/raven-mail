import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONES = [
	"bg-signal-soft text-signal-ink",
	"bg-inverse text-inverse-foreground dark:bg-orb-2/20 dark:text-orb-2",
	"bg-card text-foreground ring-1 ring-border dark:bg-orb-4/15 dark:text-orb-4",
];

export function PeopleStack({ people, className }: { people: { name: string }[]; className?: string }) {
	return (
		<ul className={cn("flex -space-x-2", className)} aria-label={people.map((p) => p.name).join(", ")}>
			{people.slice(0, 4).map((p, idx) => (
				<li
					key={p.name}
					className={cn(
						"grid size-8 place-items-center rounded-full font-mono backdrop-blur-md text-[10px] font-semibold ring-2 ring-card-nested dark:ring-background",
						TONES[idx % TONES.length],
					)}
				>
					{initials(p.name)}
				</li>
			))}
		</ul>
	);
}
