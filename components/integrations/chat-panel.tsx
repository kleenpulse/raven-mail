"use client";

import * as React from "react";
import { MoreHorizontal, Plus, RefreshCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ActivityList } from "@/components/integrations/activity-list";
import { ConnectForm, SecretReveal } from "@/components/integrations/connect-form";
import { DbCallout } from "@/components/integrations/db-callout";
import { CONNECTION_LABEL, StatusPill, connectionTone } from "@/components/integrations/status-pill";
import { StepList } from "@/components/integrations/step-list";
import { ago } from "@/components/integrations/time";
import { useConnectionActions, useRefreshIntegrations } from "@/hooks/use-integrations";
import { useNow } from "@/hooks/use-now";
import { useStepStream } from "@/hooks/use-step-stream";
import type { ChatEntry } from "@/lib/integrations/catalog";
import type { CheckResult, ConnectionDTO, IntegrationsOverview } from "@/lib/integrations/types";
import { MAX_CONNECTIONS } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

type Mode = { kind: "idle" } | { kind: "test" } | { kind: "rename" } | { kind: "replace" } | { kind: "secret"; secret: string };

function ConnectionRow({ entry, connection }: { entry: ChatEntry; connection: ConnectionDTO }) {
	const now = useNow();
	const actions = useConnectionActions();
	const refresh = useRefreshIntegrations();
	const test = useStepStream<CheckResult>("/api/integrations/check");
	const [mode, setMode] = React.useState<Mode>({ kind: "idle" });
	const [draft, setDraft] = React.useState(connection.label);
	const [confirming, setConfirming] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const paused = connection.status === "paused";

	React.useEffect(() => {
		if (!confirming) return;
		const t = setTimeout(() => setConfirming(false), 4000);
		return () => clearTimeout(t);
	}, [confirming]);

	async function runTest() {
		setMode({ kind: "test" });
		await test.run({ id: connection.id });
		void refresh();
	}

	async function saveName() {
		const label = draft.trim();
		if (label && label !== connection.label) await actions.rename(connection.id, label);
		setMode({ kind: "idle" });
	}

	const meta = [
		connection.lastOkAt && now !== null && `Last delivered ${ago(connection.lastOkAt, now)}`,
		entry.id === "webhook" && (connection.meta.signed ? "Signed" : "Unsigned"),
		connection.meta.service,
	].filter(Boolean);

	return (
		<li
			className={cn(
				"rounded-[20px] bg-card-nested p-4 ring-1 ring-border dark:ring-glass-border",
				connection.status === "error" && "ring-critical/40 dark:ring-critical/40",
			)}
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					{mode.kind === "rename" ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								void saveName();
							}}
							className="flex items-center gap-2"
						>
							<Input
								autoFocus
								value={draft}
								maxLength={60}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => e.key === "Escape" && setMode({ kind: "idle" })}
								aria-label="Connection name"
								className="h-9 rounded-xl"
							/>
							<Button type="submit" size="pill-sm">
								Save
							</Button>
						</form>
					) : (
						<p className="truncate text-[14px] font-medium">{connection.label}</p>
					)}
					<p className="mt-1 truncate font-mono text-[11px] text-ink-2">{connection.hint}</p>
					{meta.length > 0 && <p className="mt-1 text-[11px] text-ink-3">{meta.join(" · ")}</p>}
				</div>
				<StatusPill tone={connectionTone(connection.status)}>{CONNECTION_LABEL[connection.status]}</StatusPill>
			</div>

			{connection.status === "error" && connection.lastError && mode.kind === "idle" && (
				<div role="alert" className="mt-3 rounded-[16px] bg-critical/8 px-3.5 py-3 ring-1 ring-critical/20">
					<p className="text-[12px] font-medium">{connection.lastError.message}</p>
					<Button size="pill-sm" variant="surface" className="mt-2" onClick={() => setMode({ kind: "replace" })}>
						<RefreshCcw />
						Reconnect
					</Button>
				</div>
			)}

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button variant="surface" size="pill-sm" onClick={() => void runTest()} disabled={paused || test.status === "running"}>
					<Send />
					{test.status === "running" ? "Sending…" : "Send test"}
				</Button>
				<label className="ml-1 flex items-center gap-2 text-[12px] text-ink-2">
					<Switch
						size="sm"
						checked={!paused}
						disabled={busy}
						onCheckedChange={async (on) => {
							setBusy(true);
							await actions.setPaused(connection.id, !on);
							setBusy(false);
						}}
						aria-label={paused ? "Resume deliveries" : "Pause deliveries"}
					/>
					{paused ? "Paused" : "Active"}
				</label>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="circle-sm" className="ml-auto" aria-label={`More for ${connection.label}`}>
								<MoreHorizontal />
							</Button>
						}
					/>
					<DropdownMenuContent align="end" className="min-w-48">
						<DropdownMenuItem onClick={() => (setDraft(connection.label), setMode({ kind: "rename" }))}>Rename</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setMode({ kind: "replace" })}>Replace URL</DropdownMenuItem>
						{entry.id === "webhook" && (
							<DropdownMenuItem
								onClick={async () => {
									const res = await actions.rotate(connection.id);
									if (res) setMode({ kind: "secret", secret: res.signingSecret });
								}}
							>
								Rotate signing secret
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" closeOnClick={false} onClick={async () => {
							if (!confirming) return setConfirming(true);
							await actions.disconnect(connection.id, connection.label);
						}}>
							{confirming ? "Click again to disconnect" : "Disconnect…"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{mode.kind === "test" && test.status !== "idle" && (
				<div className="mt-4 border-t border-border pt-4 dark:border-glass-border">
					<StepList stream={test} onRetry={() => void runTest()} />
					{test.status !== "running" && (
						<Button variant="ghost" size="pill-sm" className="mt-2" onClick={() => (test.reset(), setMode({ kind: "idle" }))}>
							Close
						</Button>
					)}
				</div>
			)}
			{mode.kind === "replace" && (
				<div className="mt-4 border-t border-border pt-4 dark:border-glass-border">
					<ConnectForm entry={entry} replace={connection} onDone={() => (setMode({ kind: "idle" }), void refresh())} onCancel={() => setMode({ kind: "idle" })} />
				</div>
			)}
			{mode.kind === "secret" && (
				<div className="mt-4">
					<SecretReveal secret={mode.secret} onDone={() => setMode({ kind: "idle" })} />
				</div>
			)}
		</li>
	);
}

export function ChatPanel({ entry, data, onRetry }: { entry: ChatEntry; data: IntegrationsOverview; onRetry: () => void }) {
	const refresh = useRefreshIntegrations();
	const connections = (data.connections ?? []).filter((c) => c.kind === entry.id);
	const total = data.connections?.length ?? 0;
	const [adding, setAdding] = React.useState(false);
	const showForm = adding || connections.length === 0;

	if (!data.dbReady) {
		return (
			<div className="space-y-4">
				<p className="text-[13px] leading-relaxed text-ink-2">{entry.blurb}</p>
				{data.dbError && <DbCallout problem={data.dbError} onRetry={onRetry} />}
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<p className="text-[13px] leading-relaxed text-ink-2">{entry.blurb}</p>

			{connections.length > 0 && (
				<section aria-label="Connections" className="space-y-3">
					<div className="flex items-center justify-between gap-3">
						<h3 className="font-display text-[15px]">
							{connections.length === 1 ? "1 connection" : `${connections.length} connections`}
						</h3>
						{!adding && total < MAX_CONNECTIONS && (
							<Button variant="surface" size="pill-sm" onClick={() => setAdding(true)}>
								<Plus />
								Add another
							</Button>
						)}
					</div>
					<ul className="space-y-3">
						{connections.map((c) => (
							<ConnectionRow key={c.id} entry={entry} connection={c} />
						))}
					</ul>
				</section>
			)}

			{showForm && (
				<section aria-label="Connect" className="space-y-3">
					<h3 className="font-display text-[15px]">{connections.length ? "Add a connection" : `Connect ${entry.name}`}</h3>
					{total >= MAX_CONNECTIONS ? (
						<p className="text-[12px] text-ink-2">You’ve reached {MAX_CONNECTIONS} connections. Disconnect one first.</p>
					) : (
						<ConnectForm
							entry={entry}
							onDone={() => (setAdding(false), void refresh())}
							onCancel={connections.length ? () => setAdding(false) : undefined}
						/>
					)}
				</section>
			)}

			<section aria-label="Activity" className="space-y-1">
				<h3 className="font-display text-[15px]">Activity</h3>
				<ActivityList filter={{ target: entry.id }} empty="Shares, tests and changes will show up here." />
			</section>
		</div>
	);
}
