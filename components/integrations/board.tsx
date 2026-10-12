"use client";

import * as React from "react";
import { parseAsString, useQueryState } from "nuqs";
import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { PaneState } from "@/components/mail/skeletons";
import { Button } from "@/components/ui/button";
import { ActivityList } from "@/components/integrations/activity-list";
import { SoonTile } from "@/components/integrations/brand-marks";
import { DbCallout } from "@/components/integrations/db-callout";
import { checkTone } from "@/components/integrations/health-panel";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { IntegrationSheet } from "@/components/integrations/integration-sheet";
import { SectionBoundary } from "@/components/integrations/section-boundary";
import { CONNECTION_LABEL, StatusPill, type Tone } from "@/components/integrations/status-pill";
import { ago } from "@/components/integrations/time";
import { needsAttention, useIntegrations } from "@/hooks/use-integrations";
import { useIntroGate } from "@/hooks/use-intro-gate";
import { useNow } from "@/hooks/use-now";
import { BUILT_IN, CHAT, COMING_SOON, EXPORT_ENTRY, isCatalogId } from "@/lib/integrations/catalog";
import { percent } from "@/lib/integrations/export/progress";
import type { CatalogId, ConnectionDTO, IntegrationsOverview } from "@/lib/integrations/types";
import { useExportRun } from "@/lib/store/export-run";
import { cn } from "@/lib/utils";

function useSyncedLabel(syncedAt: string | undefined): string {
	const now = useNow();
	if (now === null || !syncedAt) return "syncing…";
	const minutes = Math.round((now - Date.parse(syncedAt)) / 60_000);
	return minutes < 1 ? "synced just now" : `synced ${minutes} min ago`;
}

/** `?i=` opens a panel. Opening pushes history so Back closes it; closing pops it again. */
function useSelection() {
	const router = useRouter();
	const [raw, setRaw] = useQueryState("i", parseAsString);
	const pushed = React.useRef(false);
	const selected = raw && isCatalogId(raw) ? raw : null;
	// Back (or any navigation) closed it: nothing of ours left to pop.
	React.useEffect(() => {
		if (!raw) pushed.current = false;
	}, [raw]);

	const open = React.useCallback(
		(id: CatalogId) => {
			pushed.current = true;
			void setRaw(id, { history: "push", scroll: false });
		},
		[setRaw],
	);
	const close = React.useCallback(() => {
		if (pushed.current) {
			pushed.current = false;
			router.back();
		} else {
			void setRaw(null, { history: "replace", scroll: false });
		}
	}, [router, setRaw]);
	return { selected, open, close };
}

/* ── Hero: health strip ──────────────────────────────────────────────────── */

function Tile({
	label,
	value,
	sub,
	tone,
	i,
	onClick,
}: {
	label: string;
	value: string;
	sub: string;
	tone: Tone;
	i: number;
	onClick: () => void;
}) {
	const dot = { ok: "bg-ok", warn: "bg-warn", attention: "bg-critical", running: "bg-signal", paused: "bg-ink-3", idle: "bg-ink-3", soon: "bg-ink-3" }[tone];
	return (
		<button
			type="button"
			onClick={onClick}
			style={{ ["--i" as string]: i }}
			className="entrance group flex min-w-0 flex-col items-start gap-1 rounded-card bg-sheet p-4 text-left ring-1 ring-border outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring dark:bg-card-nested dark:ring-glass-border [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5"
		>
			<span className="readout">{label}</span>
			<span className="flex items-center gap-2 font-display text-[20px] leading-tight tracking-[-0.01em]">
				<span aria-hidden className={cn("size-2 rounded-full", dot)} />
				{value}
			</span>
			<span className="w-full truncate text-[12px] text-ink-2">{sub}</span>
		</button>
	);
}

function HealthStrip({ data, now, open }: { data: IntegrationsOverview; now: number | null; open: (id: CatalogId) => void }) {
	const { mail, jev } = data.builtins;
	const run = useStore(useExportRun);
	const connections = data.connections ?? [];
	const flagged = connections.filter(needsAttention).length;
	const exporting = ["planning", "running", "paused", "saving"].includes(run.phase);

	// Signed in = connected; diagnostics only sharpen that into healthy / warnings / failing.
	const mailTone = mail.lastCheck ? checkTone(mail.lastCheck) : "ok";
	const mailValue = !mail.lastCheck ? "Connected" : mail.lastCheck.outcome === "error" ? "Check failed" : mail.lastCheck.outcome === "warn" ? "Warnings" : "Healthy";
	const exportValue = exporting ? (run.progress ? `${percent(run.progress)}%` : "Starting") : data.lastExport && now !== null ? ago(data.lastExport.createdAt, now) : "Never";

	return (
		<section aria-label="Health" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<Tile
				i={1}
				label="Mail account"
				value={mailValue}
				tone={mailTone}
				sub={mail.lastCheck && now !== null ? `Checked ${ago(mail.lastCheck.at, now)}` : "Diagnostics not run yet"}
				onClick={() => open("mail")}
			/>
			<Tile
				i={2}
				label="Jev"
				value={jev.configured ? "Live" : "Heuristic"}
				tone={jev.configured ? checkTone(jev.lastCheck) === "attention" ? "attention" : "ok" : "idle"}
				sub={jev.configured ? jev.model : "No API key — free local rules"}
				onClick={() => open("jev")}
			/>
			<Tile
				i={3}
				label="Connections"
				value={data.connections === null ? (dbDown(data) ? "Unavailable" : "Not set up") : connections.length ? `${connections.length} connected` : "None yet"}
				tone={data.connections === null ? (dbDown(data) ? "attention" : "idle") : flagged ? "attention" : connections.length ? "ok" : "idle"}
				sub={
					data.connections === null
						? (data.dbError?.message ?? "Database unavailable")
						: flagged
							? `${flagged} ${flagged === 1 ? "needs" : "need"} attention`
							: connections.length
								? "All delivering"
								: "Slack, Discord or a webhook"
				}
				onClick={() => open(connections.find(needsAttention)?.kind ?? connections[0]?.kind ?? "slack")}
			/>
			<Tile
				i={4}
				label="Last export"
				value={exportValue}
				tone={exporting ? (run.phase === "paused" && run.error ? "attention" : "running") : data.lastExport ? (data.lastExport.outcome === "error" ? "attention" : "ok") : "idle"}
				sub={exporting ? `${run.folder === "INBOX" ? "Inbox" : run.folder} · in progress` : (data.lastExport?.summary ?? "Download any folder as .mbox")}
				onClick={() => open("export")}
			/>
		</section>
	);
}

/* ── Cards ───────────────────────────────────────────────────────────────── */

/** Missing/unmigrated DB is a setup step (neutral); an unreachable one is a fault (red). */
function dbDown(data: IntegrationsOverview): boolean {
	return data.dbError?.code === "db_unavailable";
}

function chatCardState(
	kind: string,
	connections: ConnectionDTO[] | null,
	down: boolean,
): { tone: Tone; status: string; lines: string[]; action: string } {
	if (connections === null) {
		return down
			? { tone: "attention", status: "Unavailable", lines: [], action: "Details" }
			: { tone: "idle", status: "Needs database", lines: [], action: "Details" };
	}
	const mine = connections.filter((c) => c.kind === kind);
	if (mine.length === 0) return { tone: "idle", status: "Not connected", lines: [], action: "Connect" };
	const flagged = mine.filter(needsAttention);
	const tone: Tone = flagged.length ? "attention" : mine.every((c) => c.status === "paused") ? "paused" : "ok";
	return {
		tone,
		status: flagged.length ? CONNECTION_LABEL.error : mine.length === 1 ? CONNECTION_LABEL[mine[0]!.status] : `${mine.length} connected`,
		lines: mine.slice(0, 3).map((c) => (c.status === "error" && c.lastError ? `${c.label} — ${c.lastError.message}` : c.label)),
		action: flagged.length ? "Fix" : "Manage",
	};
}

function BoardSkeleton() {
	const block = "animate-in fade-in fill-mode-both delay-300 duration-200 rounded-card bg-card animate-pulse";
	return (
		<div aria-busy="true" aria-label="Loading integrations" className="grid gap-4 sm:grid-cols-2 wide:grid-cols-3">
			{[0, 1, 2, 3, 4].map((n) => (
				<div key={n} className={cn(block, "h-[220px]")} />
			))}
		</div>
	);
}

function Section({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section aria-label={title} className="space-y-3">
			<div className="flex items-baseline justify-between gap-3 px-1">
				<h2 className="font-display text-[17px] leading-tight tracking-[-0.01em]">{title}</h2>
				{note && <span className="text-[12px] text-ink-2">{note}</span>}
			</div>
			<SectionBoundary title={title}>{children}</SectionBoundary>
		</section>
	);
}

export function IntegrationsBoard() {
	const introRef = useIntroGate<HTMLDivElement>("raven-intro:integrations");
	const { data, isPending, isError, error, refetch, isFetching } = useIntegrations();
	const synced = useSyncedLabel(data?.syncedAt);
	const now = useNow();
	const { selected, open, close } = useSelection();
	const connections = data?.connections ?? null;
	const flagged = connections?.filter(needsAttention).length ?? 0;
	const retry = React.useCallback(() => void refetch(), [refetch]);

	const summary = data
		? [
				connections ? `${connections.length} ${connections.length === 1 ? "connection" : "connections"}` : "Connections unavailable",
				flagged ? `${flagged} ${flagged === 1 ? "needs" : "need"} attention` : null,
				synced,
			]
				.filter(Boolean)
				.join(" · ")
		: synced;

	return (
		<div ref={introRef} className="h-full overflow-y-auto">
			<div className="mx-auto max-w-[calc(1900px-84px)] px-5 pt-6 md:px-8">
				<header className="entrance flex items-center justify-between gap-4">
					<div className="min-w-0">
						<h1 className="font-display text-[22px] leading-tight tracking-[-0.01em]">Integrations</h1>
						<p className="flex items-center gap-2 text-[13px] text-ink-2">
							<span className="truncate">{summary}</span>
							<button
								type="button"
								onClick={retry}
								aria-label="Refresh integrations"
								className="grid size-6 place-items-center rounded-full hover:bg-card-nested hover:text-foreground"
							>
								<RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
							</button>
						</p>
					</div>
					<p className="hidden items-center gap-2 text-[12px] text-ink-2 md:flex">
						<ShieldCheck className="size-4 text-ok" />
						Secrets encrypted at rest · sends only when you ask
					</p>
				</header>

				<div className="mt-8 pb-10">
					{data ? (
						<HealthStrip data={data} now={now} open={open} />
					) : (
						<div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
							{[0, 1, 2, 3].map((n) => (
								<div key={n} className="h-[92px] animate-pulse rounded-card bg-sheet ring-1 ring-border delay-300 dark:bg-card-nested dark:ring-glass-border" />
							))}
						</div>
					)}
				</div>
			</div>

			<div className="min-h-[70%] rounded-t-frame bg-sheet pb-28 dark:border-t dark:border-glass-border">
				<div className="mx-auto grid max-w-[calc(1900px-84px)] grid-cols-12 gap-x-4 gap-y-8 px-5 py-6 md:px-8 md:py-8">
					{isError && (
						<div className="col-span-12">
							<PaneState title="Couldn't load integrations" tone="critical" action={<Button variant="surface" size="pill-sm" onClick={retry}>Try again</Button>}>
								{error.message}
							</PaneState>
						</div>
					)}

					{isPending && (
						<div className="col-span-12">
							<BoardSkeleton />
						</div>
					)}

					{data && (
						<>
							<div className="col-span-12 space-y-8 xl:col-span-8">
								{data.dbError && <DbCallout problem={data.dbError} onRetry={retry} />}

								<Section title="Built in">
									<div className="grid gap-4 sm:grid-cols-2">
										<IntegrationCard
											i={5}
											entry={BUILT_IN[0]!}
											tone={data.builtins.mail.lastCheck ? checkTone(data.builtins.mail.lastCheck) : "ok"}
											status={data.builtins.mail.lastCheck ? (data.builtins.mail.lastCheck.outcome === "error" ? "Failing" : "Connected") : "Connected"}
											lines={[
												data.builtins.mail.email,
												data.builtins.mail.lastCheck && now !== null
													? `${data.builtins.mail.lastCheck.summary} · ${ago(data.builtins.mail.lastCheck.at, now)}`
													: "Diagnostics not run yet",
											]}
											action="Run diagnostics"
											onOpen={() => open("mail")}
										/>
										<IntegrationCard
											i={6}
											entry={BUILT_IN[1]!}
											tone={data.builtins.jev.configured ? (data.builtins.jev.lastCheck?.outcome === "error" ? "attention" : "ok") : "idle"}
											status={data.builtins.jev.configured ? "Live" : "Heuristic"}
											lines={[
												data.builtins.jev.configured
													? `Model ${data.builtins.jev.model} · ${data.builtins.jev.source === "user" ? "your key" : "server key"}`
													: "Add your TypeSafe key to turn it on",
												data.builtins.jev.lastCheck && now !== null
													? `${data.builtins.jev.lastCheck.summary} · ${ago(data.builtins.jev.lastCheck.at, now)}`
													: "Not checked yet",
											]}
											action={data.builtins.jev.configured ? "Check" : "Set up"}
											onOpen={() => open("jev")}
										/>
									</div>
								</Section>

								<Section title="Chat & automation" note="Only sends when you press Share or Send">
									<div className="grid gap-4 sm:grid-cols-2 wide:grid-cols-3">
										{CHAT.map((entry, idx) => {
											const state = chatCardState(entry.id, connections, dbDown(data));
											return (
												<IntegrationCard
													key={entry.id}
													i={7 + idx}
													entry={entry}
													tone={state.tone}
													status={state.status}
													lines={state.lines}
													action={state.action}
													onOpen={() => open(entry.id)}
												/>
											);
										})}
									</div>
								</Section>

								<Section title="Data">
									<ExportCard lastExport={data.lastExport} now={now} onOpen={() => open("export")} />
								</Section>

								<section aria-label="Coming soon" className="space-y-3">
									<h2 className="px-1 font-display text-[17px] leading-tight tracking-[-0.01em]">Coming soon</h2>
									<ul className="flex flex-wrap gap-2">
										{COMING_SOON.map((name) => (
											<li key={name} className="flex items-center gap-2 rounded-pill py-1 pr-3.5 pl-1 text-[12px] text-ink-2 ring-1 ring-border dark:ring-glass-border">
												<SoonTile name={name} />
												{name}
											</li>
										))}
									</ul>
								</section>
							</div>

							<aside className="col-span-12 xl:col-span-4">
								<Bento i={11} className="xl:sticky xl:top-6">
									<div className="flex items-center justify-between gap-3">
										<BentoTitle>Activity</BentoTitle>
										{flagged > 0 && <StatusPill tone="attention">{flagged} to fix</StatusPill>}
									</div>
									<p className="mt-1 text-[12px] text-ink-2">Every connect, test, share and export — newest first.</p>
									{data.dbReady ? (
										<ActivityList compact className="mt-3" empty="Nothing yet. Connect something, or run a check." />
									) : (
										<p className="mt-4 text-[12px] text-ink-2">Activity is stored in the database; it’ll show up once one is connected.</p>
									)}
								</Bento>
							</aside>
						</>
					)}
				</div>
			</div>

			<IntegrationSheet id={selected} data={data} onClose={close} onRetry={retry} />
		</div>
	);
}

function ExportCard({ lastExport, now, onOpen }: { lastExport: IntegrationsOverview["lastExport"]; now: number | null; onOpen: () => void }) {
	const run = useStore(useExportRun);
	const active = ["planning", "running", "paused", "saving"].includes(run.phase);
	const pct = run.progress ? percent(run.progress) : 0;
	const tone: Tone = active ? (run.phase === "paused" && run.error ? "attention" : "running") : "idle";
	const status = active ? (run.phase === "paused" ? "Paused" : `${pct}%`) : "Ready";
	const lines = active
		? [`${run.folder === "INBOX" ? "Inbox" : run.folder} → ${run.fileName}`]
		: lastExport && now !== null
			? [`${lastExport.summary} · ${ago(lastExport.createdAt, now)}`]
			: ["Read-only · whole messages per batch · safe to pause"];
	return (
		<IntegrationCard
			i={10}
			entry={EXPORT_ENTRY}
			tone={tone}
			status={status}
			lines={lines}
			action={active ? "View progress" : "Export a folder"}
			onOpen={onOpen}
			className={cn(active && "[&_ul]:text-foreground")}
		/>
	);
}

