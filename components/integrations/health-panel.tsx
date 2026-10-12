"use client";

import { Activity, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActivityList } from "@/components/integrations/activity-list";
import { StatusPill, type Tone } from "@/components/integrations/status-pill";
import { StepList } from "@/components/integrations/step-list";
import { ago, duration } from "@/components/integrations/time";
import { useRefreshIntegrations } from "@/hooks/use-integrations";
import { useNow } from "@/hooks/use-now";
import { useStepStream } from "@/hooks/use-step-stream";
import type { CheckResult, CheckSummary, IntegrationsOverview } from "@/lib/integrations/types";

const SECURITY = { tls: "TLS", starttls: "STARTTLS", plain: "plain (loopback)" } as const;

export function checkTone(check: CheckSummary | null): Tone {
	if (!check) return "idle";
	return check.outcome === "ok" ? "ok" : check.outcome === "warn" ? "warn" : "attention";
}

function LastCheck({ check }: { check: CheckSummary | null }) {
	const now = useNow();
	if (!check) return <p className="text-[12px] text-ink-2">Never checked from this mailbox.</p>;
	return (
		<p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
			<StatusPill tone={checkTone(check)}>{check.outcome === "error" ? "Failed" : check.outcome === "warn" ? "Warnings" : "Passed"}</StatusPill>
			<span className="min-w-0">
				{check.summary}
				{now !== null && ` · ${ago(check.at, now)}`}
				{check.latencyMs !== null && ` · ${duration(check.latencyMs)}`}
			</span>
		</p>
	);
}

function Readouts({ rows }: { rows: [string, React.ReactNode][] }) {
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 rounded-[20px] bg-card-nested p-4 text-[13px] ring-1 ring-border dark:ring-glass-border">
			{rows.map(([term, value]) => (
				<div key={term} className="contents">
					<dt className="readout self-center">{term}</dt>
					<dd className="min-w-0 truncate">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function Diagnostics({ target, check, hasHistory }: { target: "mail" | "jev"; check: CheckSummary | null; hasHistory: boolean }) {
	const stream = useStepStream<CheckResult>("/api/integrations/check");
	const refresh = useRefreshIntegrations();
	const run = async () => {
		await stream.run({ target });
		void refresh();
	};
	return (
		<section aria-label="Diagnostics" className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-display text-[15px]">Diagnostics</h3>
				<Button size="pill-sm" variant="inverse" onClick={() => void run()} disabled={stream.status === "running"}>
					<Activity />
					{stream.status === "idle" ? "Run check" : stream.status === "running" ? "Checking…" : "Run again"}
				</Button>
			</div>
			{stream.status === "idle" ? <LastCheck check={check} /> : <StepList stream={stream} onRetry={() => void run()} />}
			{!hasHistory && stream.status !== "idle" && (
				<p className="text-[11px] text-ink-3">Results aren’t kept — connect a database to build a history.</p>
			)}
		</section>
	);
}

export function MailPanel({ data }: { data: IntegrationsOverview }) {
	const { mail } = data.builtins;
	return (
		<div className="space-y-6">
			<Readouts
				rows={[
					["Address", mail.email],
					["Account", mail.dev ? "Dev mailbox (in-process)" : mail.provider],
					["Incoming", <span key="in" className="font-mono text-[12px]">{`${mail.imap.host}:${mail.imap.port} · ${SECURITY[mail.imap.security]}`}</span>],
					["Outgoing", <span key="out" className="font-mono text-[12px]">{`${mail.smtp.host}:${mail.smtp.port} · ${SECURITY[mail.smtp.security]}`}</span>],
				]}
			/>
			<Diagnostics target="mail" check={mail.lastCheck} hasHistory={data.dbReady} />
			<p className="text-[12px] leading-relaxed text-ink-2">
				Checks resolve the host, open a secure channel, sign in, read the mailbox and verify sending — each timed, so a
				slow or failing hop is easy to spot. To use a different account, sign out from the account menu.
			</p>
			{data.dbReady && (
				<section aria-label="History" className="space-y-1">
					<h3 className="font-display text-[15px]">History</h3>
					<ActivityList filter={{ target: "mail" }} showLabel={false} empty="No checks yet." />
				</section>
			)}
		</div>
	);
}

export function JevPanel({ data }: { data: IntegrationsOverview }) {
	const { jev } = data.builtins;
	return (
		<div className="space-y-6">
			<Readouts
				rows={[
					["Mode", jev.configured ? <span key="m" className="text-ok">Live — decisions by Jev</span> : "Heuristic — free local rules"],
					["Model", <span key="model" className="font-mono text-[12px]">{jev.model}</span>],
					["Used by", "Ask Jev (⌘K) · Deep triage · Daily brief re-rank"],
				]}
			/>
			{!jev.configured && (
				<div className="rounded-[20px] bg-signal-soft/60 p-4 ring-1 ring-signal/25">
					<p className="flex items-center gap-2 text-[13px] font-medium">
						<Sparkles className="size-4 text-signal-ink [&>path:first-child]:fill-current dark:text-signal" />
						Turn on Jev
					</p>
					<ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-ink-2">
						<li>
							Create a key at{" "}
							<a href="https://console.typesafe.ai/keys" target="_blank" rel="noreferrer" className="text-signal-ink underline-offset-2 hover:underline dark:text-signal">
								console.typesafe.ai
							</a>
							.
						</li>
						<li>
							Set <code className="font-mono">TYPESAFE_API_KEY</code> in the server environment and restart.
						</li>
						<li>Run the check below. Everything keeps working on heuristics until then.</li>
					</ol>
				</div>
			)}
			<Diagnostics target="jev" check={jev.lastCheck} hasHistory={data.dbReady} />
			{data.dbReady && (
				<section aria-label="History" className="space-y-1">
					<h3 className="font-display text-[15px]">History</h3>
					<ActivityList filter={{ target: "jev" }} showLabel={false} empty="No checks yet." />
				</section>
			)}
		</div>
	);
}
