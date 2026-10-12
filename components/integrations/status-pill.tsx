import { LoaderCircle } from "lucide-react";
import type { ConnectionStatus } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "attention" | "running" | "paused" | "idle" | "soon";

const TONE: Record<Tone, { pill: string; dot?: string }> = {
	ok: { pill: "bg-ok/12 text-ok", dot: "bg-ok" },
	warn: { pill: "bg-warn/12 text-warn", dot: "bg-warn" },
	attention: { pill: "bg-critical/12 text-critical", dot: "bg-critical animate-pulse-once" },
	running: { pill: "bg-signal-soft text-signal-ink dark:text-signal" },
	paused: { pill: "bg-foreground/8 text-ink-2", dot: "bg-ink-3" },
	idle: { pill: "text-ink-2 ring-1 ring-border dark:ring-glass-border" },
	soon: { pill: "border border-dashed border-border text-ink-3 dark:border-glass-border" },
};

/** Mono, uppercase status chip — same family as the triage badge in Mail. */
export function StatusPill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
	const t = TONE[tone];
	return (
		<span
			className={cn(
				"inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2.5 font-mono text-[10.5px] tracking-wide uppercase",
				t.pill,
				className,
			)}
		>
			{tone === "running" ? <LoaderCircle aria-hidden className="size-3 animate-spin" /> : t.dot && <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} />}
			{children}
		</span>
	);
}

export function connectionTone(status: ConnectionStatus): Tone {
	return status === "active" ? "ok" : status === "paused" ? "paused" : "attention";
}

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
	active: "Connected",
	paused: "Paused",
	error: "Needs attention",
};
