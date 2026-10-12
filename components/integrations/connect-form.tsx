"use client";

import * as React from "react";
import { Check, ChevronDown, Copy, KeyRound, LoaderCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StepList } from "@/components/integrations/step-list";
import { useRefreshIntegrations } from "@/hooks/use-integrations";
import { useStepStream } from "@/hooks/use-step-stream";
import type { ChatEntry } from "@/lib/integrations/catalog";
import type { ConnectionDTO, ConnectResult } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

const field = "h-11 rounded-xl px-3.5";

/** Instant feedback while typing; the server's "Check URL" step has the final word. */
function quickCheck(raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return "Webhook URLs start with https://";
		return null;
	} catch {
		return "That isn't a complete URL yet.";
	}
}

export function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
	const [copied, setCopied] = React.useState(false);
	return (
		<div className="space-y-3 rounded-[20px] bg-signal-soft/60 p-4 ring-1 ring-signal/30">
			<p className="flex items-center gap-2 text-[13px] font-medium">
				<KeyRound className="size-4 text-signal-ink dark:text-signal" />
				Signing secret — shown once
			</p>
			<p className="text-[12px] leading-relaxed text-ink-2">
				Deliveries carry <code className="font-mono">webhook-signature</code> headers (Standard Webhooks). Store this in
				your receiver to verify them; Raven keeps only an encrypted copy.
			</p>
			<div className="flex items-center gap-2 rounded-xl bg-sheet p-1.5 pl-3 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
				<code className="min-w-0 flex-1 truncate font-mono text-[12px]">{secret}</code>
				<Button
					variant="surface"
					size="pill-sm"
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(secret);
							setCopied(true);
						} catch {
							toast.error("Couldn't copy — select the text instead.");
						}
					}}
				>
					{copied ? <Check /> : <Copy />}
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			<Button size="pill-sm" variant="inverse" onClick={onDone}>
				I’ve saved it
			</Button>
		</div>
	);
}

/**
 * Paste → streamed check (validate, look up, test delivery, seal) → done.
 * Nothing is stored unless the test message actually landed.
 */
export function ConnectForm({
	entry,
	replace,
	onDone,
	onCancel,
}: {
	entry: ChatEntry;
	replace?: ConnectionDTO;
	onDone: (connection: ConnectionDTO) => void;
	onCancel?: () => void;
}) {
	const id = React.useId();
	const [url, setUrl] = React.useState("");
	const [label, setLabel] = React.useState(replace?.label ?? "");
	const [signed, setSigned] = React.useState(replace?.meta.signed ?? true);
	const [editing, setEditing] = React.useState(true);
	const [showHelp, setShowHelp] = React.useState(!replace);
	const stream = useStepStream<ConnectResult>("/api/integrations/connect");
	const refresh = useRefreshIntegrations();
	const problem = quickCheck(url);
	const busy = stream.status === "running";

	async function submit(e?: React.FormEvent) {
		e?.preventDefault();
		if (!url.trim() || problem) return;
		setEditing(false);
		const end = await stream.run({
			kind: entry.id,
			url: url.trim(),
			...(label.trim() ? { label: label.trim() } : {}),
			...(entry.id === "webhook" ? { signed } : {}),
			...(replace ? { replaceId: replace.id } : {}),
		});
		// Failures are logged too — keep the activity list honest either way.
		void refresh();
		if (end.status === "done" && end.result && !end.result.signingSecret) onDone(end.result.connection);
	}

	if (!editing) {
		const result = stream.result;
		return (
			<div className="space-y-4">
				<StepList
					stream={stream}
					onRetry={() => void submit()}
					extraAction={
						<Button variant="ghost" size="pill-sm" onClick={() => setEditing(true)}>
							<Pencil />
							Edit
						</Button>
					}
				/>
				{stream.status === "done" && result?.signingSecret && (
					<SecretReveal secret={result.signingSecret} onDone={() => onDone(result.connection)} />
				)}
			</div>
		);
	}

	return (
		<form onSubmit={submit} className="space-y-4" noValidate>
			<div className="space-y-2">
				<Label htmlFor={`${id}-url`}>{replace ? "New webhook URL" : "Webhook URL"}</Label>
				<Input
					id={`${id}-url`}
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder={entry.placeholder}
					autoComplete="off"
					spellCheck={false}
					inputMode="url"
					aria-invalid={problem ? true : undefined}
					aria-describedby={problem ? `${id}-url-error` : undefined}
					className={cn(field, "font-mono text-[12px] md:text-[12px]")}
				/>
				{problem && (
					<p id={`${id}-url-error`} className="text-[12px] text-critical">
						{problem}
					</p>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor={`${id}-label`}>
					Name <span className="font-normal text-ink-3">(optional)</span>
				</Label>
				<Input
					id={`${id}-label`}
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder={entry.labelPlaceholder}
					maxLength={60}
					className={field}
				/>
			</div>

			{entry.id === "webhook" && (
				<label className="flex items-start justify-between gap-4 rounded-[18px] bg-card-nested p-4 ring-1 ring-border dark:ring-glass-border">
					<span>
						<span className="block text-[13px] font-medium">Sign deliveries</span>
						<span className="mt-0.5 block text-[12px] leading-relaxed text-ink-2">
							HMAC-SHA256 per Standard Webhooks, so your receiver can prove a request came from Raven.
						</span>
					</span>
					<Switch checked={signed} onCheckedChange={setSigned} className="mt-0.5" />
				</label>
			)}

			<div className="rounded-[18px] ring-1 ring-border dark:ring-glass-border">
				<button
					type="button"
					onClick={() => setShowHelp((v) => !v)}
					aria-expanded={showHelp}
					className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[18px]"
				>
					Where do I find this URL?
					<ChevronDown className={cn("size-4 text-ink-2 transition-transform", showHelp && "rotate-180")} />
				</button>
				{showHelp && (
					<ol className="list-decimal space-y-1.5 px-4 pb-4 pl-8 text-[12px] leading-relaxed text-ink-2 marker:font-mono marker:text-ink-3">
						{entry.howTo.map((step) => (
							<li key={step}>{step}</li>
						))}
						{entry.docsUrl && (
							<li className="list-none -ml-4">
								<a href={entry.docsUrl} target="_blank" rel="noreferrer" className="text-signal-ink underline-offset-2 hover:underline dark:text-signal">
									{entry.name} docs ↗
								</a>
							</li>
						)}
					</ol>
				)}
			</div>

			<p className="text-[12px] leading-relaxed text-ink-2">
				Raven sends one test message now. The URL is encrypted at rest and never shown again in full.
			</p>

			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="pill" disabled={!url.trim() || Boolean(problem) || busy}>
					{busy && <LoaderCircle className="animate-spin" />}
					{replace ? "Replace and test" : "Connect and test"}
				</Button>
				{onCancel && (
					<Button type="button" variant="ghost" size="pill" onClick={onCancel}>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
