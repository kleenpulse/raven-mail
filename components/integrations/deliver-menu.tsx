"use client";

import * as React from "react";
import Link from "next/link";
import { LoaderCircle, Send, Settings2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/ui/tooltip";
import { BrandTile } from "@/components/integrations/brand-marks";
import { useDeliver, useIntegrations } from "@/hooks/use-integrations";
import type { BriefItem } from "@/lib/insights/types";
import type { ConnectionDTO } from "@/lib/integrations/types";
import type { MailMessage } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

type Props = {
	label: string;
	icon: "share" | "send";
	heading: string;
	footnote: string;
	onPick: (connection: ConnectionDTO) => void;
	triggerClassName?: string;
	disabled?: boolean;
};

/**
 * The destinations menu shared by "Share" (reader) and "Send brief" (Overview).
 * Integrations are fetched only once the menu opens — Mail never waits on the DB.
 */
function DeliverMenu({ label, icon, heading, footnote, onPick, triggerClassName, disabled }: Props) {
	const [open, setOpen] = React.useState(false);
	const { data, isPending, isError, refetch } = useIntegrations({ enabled: open });
	const connections = data?.connections ?? [];
	const Icon = icon === "share" ? Share2 : Send;

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tip
				label={label}
				render={
					<DropdownMenuTrigger
						disabled={disabled}
						render={
							<Button variant="surface" size="circle-sm" aria-label={label} className={cn("text-ink-2 hover:text-foreground", triggerClassName)} />
						}
					/>
				}
			>
				<Icon />
			</Tip>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{heading}</DropdownMenuLabel>
					{isPending && (
						<div className="flex items-center gap-2 px-2 py-2 text-[12px] text-ink-2">
							<LoaderCircle className="size-3.5 animate-spin" />
							Loading destinations…
						</div>
					)}
					{isError && (
						<DropdownMenuItem closeOnClick={false} onClick={() => void refetch()}>
							Couldn’t load destinations — retry
						</DropdownMenuItem>
					)}
					{data && !data.dbReady && (
						<div className="px-2 py-2 text-[12px] leading-relaxed text-ink-2">{data.dbError?.message ?? "Integrations are unavailable."}</div>
					)}
					{data?.dbReady && connections.length === 0 && (
						<DropdownMenuItem render={<Link href="/integrations?i=slack" />}>Connect Slack, Discord or a webhook</DropdownMenuItem>
					)}
					{connections.map((c) => {
						const blocked = c.status !== "active";
						return (
							<DropdownMenuItem key={c.id} disabled={blocked} onClick={() => onPick(c)} className="gap-2.5 py-1.5">
								<BrandTile id={c.kind} size="sm" />
								<span className="min-w-0 flex-1 truncate">{c.label}</span>
								{blocked && (
									<span className="font-mono text-[10px] uppercase text-ink-3">{c.status === "paused" ? "Paused" : "Needs fix"}</span>
								)}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem render={<Link href="/integrations" />} className="gap-2.5">
					<Settings2 className="size-4 text-ink-2" />
					Manage integrations
				</DropdownMenuItem>
				<p className="px-2 pt-1 pb-1.5 text-[11px] leading-snug text-ink-3">{footnote}</p>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Reader toolbar: posts subject, sender, date and a short preview — never the body. */
export function ShareMenu({ folder, message }: { folder: string; message: MailMessage }) {
	const { shareEmail } = useDeliver();
	return (
		<DeliverMenu
			label="Share to…"
			icon="share"
			heading="Share this email"
			footnote="Sends the subject, sender, date and a 280-character preview. Never the full body or attachments."
			onPick={(c) =>
				void shareEmail(c, {
					folder,
					uid: message.uid,
					messageId: message.messageId ?? null,
					subject: message.subject,
					from: { name: message.from.name ?? "", address: message.from.address },
					date: message.date,
					preview: message.text.replace(/\s+/g, " ").trim().slice(0, 280),
				})
			}
		/>
	);
}

/** Daily Brief: sends exactly what's on screen — your order, minus dismissed items. */
export function SendBriefMenu({ items, disabled }: { items: BriefItem[]; disabled?: boolean }) {
	const { sendBrief } = useDeliver();
	return (
		<DeliverMenu
			label="Send brief to…"
			icon="send"
			heading={`Send today's brief (${items.length})`}
			footnote="Subjects, senders and why each one matters — no previews."
			disabled={disabled || items.length === 0}
			triggerClassName="size-8 ring-1 ring-border bg-card-nested dark:ring-glass-border"
			onPick={(c) =>
				void sendBrief(c, {
					dateLabel: new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
					items: items.slice(0, 5).map((item) => ({
						folder: item.folder,
						uid: item.uid,
						messageId: item.messageId ?? null,
						subject: item.subject,
						from: item.from,
						why: item.why.slice(0, 4),
					})),
				})
			}
		/>
	);
}
