import { Database, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DbProblem } from "@/lib/integrations/types";

/** Why saved integrations are unavailable, and the exact fix. Built-ins keep working. */
export function DbCallout({ problem, onRetry, compact = false }: { problem: DbProblem; onRetry?: () => void; compact?: boolean }) {
	const unavailable = problem.code === "db_unavailable";
	return (
		<div
			role={unavailable ? "alert" : "status"}
			className="flex flex-wrap items-start gap-3 rounded-[20px] bg-card-nested p-4 ring-1 ring-border dark:ring-glass-border"
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-full bg-sheet ring-1 ring-border dark:bg-background/40 dark:ring-glass-border">
				<Database className="size-4 text-ink-2" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-[13px] font-medium">{problem.message}</p>
				<p className="mt-1 text-[12px] leading-relaxed text-ink-2">{problem.hint}</p>
				{!compact && !unavailable && (
					<p className="mt-2 text-[12px] leading-relaxed text-ink-2">
						Health checks and mailbox export still work without it.
					</p>
				)}
			</div>
			{unavailable && onRetry && (
				<Button variant="surface" size="pill-sm" onClick={onRetry}>
					<RotateCw />
					Retry
				</Button>
			)}
		</div>
	);
}
