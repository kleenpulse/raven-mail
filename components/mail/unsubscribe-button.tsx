"use client";

import * as React from "react";
import { Check, LoaderCircle, MailX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { postJson } from "@/hooks/use-integrations";
import { useComposeStore } from "@/lib/store/compose";
import { parseMailto, unsubscribeOptions, type UnsubscribeOptions } from "@/lib/mail/headers";
import type { MailMessage } from "@/lib/mail/types";

type Method = "one-click" | "page" | "email";

function methodOf(options: UnsubscribeOptions): Method {
	if (options.oneClick) return "one-click";
	return options.https ? "page" : "email";
}

function hostOf(href: string): string {
	try {
		return new URL(href).hostname.replace(/^www\./, "");
	} catch {
		return href;
	}
}

/**
 * Unsubscribe from the list a message came from. One-click (RFC 8058) runs on
 * the server; otherwise it opens the sender's page or a prefilled email.
 */
export function UnsubscribeButton({ message }: { message: MailMessage }) {
	const options = React.useMemo(() => unsubscribeOptions(message.headers), [message.headers]);
	const openCompose = useComposeStore((s) => s.openCompose);
	const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
	if (!options) return null;

	const method = methodOf(options);
	const mailto = options.mailto ? parseMailto(options.mailto) : undefined;
	if (method === "email" && !mailto) return null;
	const sender = message.from.name || hostOf(options.https ?? `https://${message.from.address.split("@")[1] ?? ""}`);

	const openPage = () => {
		if (options.https) window.open(options.https, "_blank", "noopener,noreferrer");
	};
	const writeEmail = () => {
		// Read by a machine: no signature.
		if (mailto) openCompose("new", { to: mailto.to, subject: mailto.subject, text: mailto.body }, { signature: false });
	};

	async function confirm() {
		if (method === "page") return openPage();
		if (method === "email") return writeEmail();
		setState("busy");
		try {
			await postJson("/api/mail/unsubscribe", { folder: message.folder, uid: message.uid });
			setState("done");
			toast.success(`Unsubscribed from ${sender}`, { description: "Their emails can take a few days to stop." });
		} catch (err) {
			setState("idle");
			const fallback = options!.https
				? { label: "Open their page", onClick: openPage }
				: mailto
					? { label: "Email them", onClick: writeEmail }
					: undefined;
			toast.error("Couldn't unsubscribe", {
				description: err instanceof Error ? err.message : undefined,
				action: fallback,
			});
		}
	}

	if (state === "done") {
		return (
			<span className="inline-flex h-7 items-center gap-1.5 rounded-pill px-3 text-[12px] text-ink-2 ring-1 ring-border dark:ring-glass-border">
				<Check aria-hidden className="size-3.5 text-ok" />
				Unsubscribed
			</span>
		);
	}

	const description =
		method === "one-click"
			? `Raven asks ${hostOf(options.https!)} to take you off this list.`
			: method === "page"
				? `This opens ${hostOf(options.https!)} in a new tab. Finish there.`
				: `This starts an email to ${mailto!.to} asking to be taken off. Send it to finish.`;

	return (
		<Dialog>
			<DialogTrigger
				render={
					<button
						type="button"
						disabled={state === "busy"}
						className="inline-flex h-7 items-center gap-1.5 rounded-pill px-3 text-[12px] text-ink-2 ring-1 ring-border outline-none transition-colors hover:bg-signal-soft hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 dark:ring-glass-border"
					/>
				}
			>
				{state === "busy" ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <MailX aria-hidden className="size-3.5" />}
				Unsubscribe
			</DialogTrigger>
			<DialogContent className="rounded-[24px] p-5">
				<DialogHeader>
					<DialogTitle>Unsubscribe from {sender}?</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{/* DialogFooter's bleed assumes p-4; this dialog is p-5 with 24px corners. */}
				<DialogFooter className="-mx-5 -mb-5 rounded-b-[24px] px-5">
					<DialogClose render={<Button variant="surface" size="pill-sm" />}>Cancel</DialogClose>
					<DialogClose render={<Button size="pill-sm" onClick={() => void confirm()} />}>
						{method === "page" ? "Open page" : method === "email" ? "Write email" : "Unsubscribe"}
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
