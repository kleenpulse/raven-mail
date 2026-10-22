"use client";

import * as React from "react";
import { Ellipsis, ShieldBan, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
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
import { PickTimeDialog, RemindItems } from "@/components/mail/remind-menu";
import { useBlockActions, useBlockedSender } from "@/hooks/use-blocks";
import { useFollowUpActions, useFollowUpFor } from "@/hooks/use-follow-ups";
import { dueLabel } from "@/lib/follow-ups/when";
import { canBlockDomain, senderDomain } from "@/lib/blocks/match";
import type { BlockKind } from "@/lib/blocks/types";
import type { MailMessage } from "@/lib/mail/types";

type Props = {
	message: MailMessage;
	accountEmail: string;
	/** The sender was just blocked: in the Inbox the message's row is gone. */
	onBlocked: () => void;
	/** Undo of a block brought it back. */
	onUnblocked: () => void;
	/** A message you sent: it can get "Remind me if no reply". */
	sent?: boolean;
};

/** The reader's ⋯ menu: a reminder on mail you sent, and block or unblock the sender. */
export function ReaderMoreMenu({ message, accountEmail, onBlocked, onUnblocked, sent = false }: Props) {
	const address = message.from.address.toLowerCase();
	const domain = senderDomain(address);
	const covering = useBlockedSender()(address);
	const { block, unblock } = useBlockActions();
	const own = !address || address === accountEmail.toLowerCase();
	const reminder = useFollowUpFor(sent ? message.messageId : undefined);
	const reminders = useFollowUpActions();
	const [picking, setPicking] = React.useState(false);
	const remind = (choice: Parameters<typeof reminders.remind>[1]) =>
		void reminders.remind({ folder: message.folder, uid: message.uid }, choice);

	async function blockAs(kind: BlockKind) {
		const value = kind === "address" ? address : domain;
		const saved = await block(kind, value);
		if (!saved) return;
		onBlocked();
		toast.success(`Blocked ${kind === "domain" ? `everyone at ${value}` : value}`, {
			description: "Their mail is hidden from your Inbox. Unblock in Settings → Mail.",
			action: {
				label: "Undo",
				onClick: () => void unblock(saved).then((ok) => ok && onUnblocked()),
			},
		});
	}

	return (
		<DropdownMenu>
			<Tip
				label="More"
				render={
					<DropdownMenuTrigger
						render={<Button variant="surface" size="circle-sm" aria-label="More" className="text-ink-2 hover:text-foreground" />}
					/>
				}
			>
				<Ellipsis />
			</Tip>
			<DropdownMenuContent align="end" className="w-72">
				{sent && (
					<>
						<RemindItems
							status={reminder ? `Set for ${dueLabel(reminder.dueAt)}` : undefined}
							onPick={remind}
							onCustom={() => setPicking(true)}
							onClear={reminder ? () => void reminders.cancel(reminder) : undefined}
						/>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuGroup>
					<DropdownMenuLabel>Sender</DropdownMenuLabel>
					{own ? (
						<div className="px-2 py-2 text-[12px] text-ink-2">This is your own email.</div>
					) : covering ? (
						<DropdownMenuItem className="gap-2.5" onClick={() => void unblock(covering)}>
							<ShieldCheck className="size-4 text-ink-2" />
							<span className="min-w-0 truncate">
								Unblock {covering.kind === "domain" ? `everyone at ${covering.value}` : covering.value}
							</span>
						</DropdownMenuItem>
					) : (
						<>
							<DropdownMenuItem className="gap-2.5" onClick={() => void blockAs("address")}>
								<ShieldBan className="size-4 text-ink-2" />
								<span className="min-w-0 truncate">Block {address}</span>
							</DropdownMenuItem>
							{canBlockDomain(address, accountEmail) && (
								<DropdownMenuItem className="gap-2.5" onClick={() => void blockAs("domain")}>
									<ShieldBan className="size-4 text-ink-2" />
									<span className="min-w-0 truncate">Block everyone at {domain}</span>
								</DropdownMenuItem>
							)}
						</>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
			<PickTimeDialog open={picking} onOpenChange={setPicking} onPick={remind} />
		</DropdownMenu>
	);
}
