"use client";

import { ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resetPrefs, setPref, usePrefsStore } from "@/lib/prefs/store";

const PROMPT_ID = "remote-images-prompt";

/** `null` means the user hasn't answered the "always load?" prompt yet. */
export type RemoteImagesPref = "always" | "once" | null;

/** Backed by the Load Remote Images setting; an untouched setting means "never asked". */
function writePref(pref: RemoteImagesPref) {
	if (pref === null) resetPrefs(["mail.remoteImages"]);
	else setPref("mail.remoteImages", pref === "always");
}

export function useRemoteImagesPref(): RemoteImagesPref {
	return usePrefsStore((s) => {
		const value = s.overrides["mail.remoteImages"];
		return value === undefined ? null : value ? "always" : "once";
	});
}

/** Asks once whether remote images should always load. Dismissing leaves it unanswered. */
export function promptAlwaysLoadImages() {
	toast.custom(
		(id) => (
			<div className="flex w-full gap-3 rounded-[20px] bg-popover p-4 text-popover-foreground shadow-card ring-1 ring-border dark:ring-glass-border">
				<ImageIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
				<div className="min-w-0 flex-1">
					<p className="text-[13.5px] font-medium text-foreground">Always load images?</p>
					<p className="mt-0.5 text-[13px] leading-snug text-ink-2">
						Skip this step for every email. Senders may be able to tell when you open their mail.
					</p>
					<div className="mt-3 flex flex-wrap justify-end gap-2">
						<Button
							variant="surface"
							size="pill-sm"
							onClick={() => {
								writePref("once");
								toast.dismiss(id);
							}}
						>
							Just this once
						</Button>
						<Button
							size="pill-sm"
							onClick={() => {
								writePref("always");
								toast.dismiss(id);
								toast.success("Images will load automatically", {
									action: { label: "Undo", onClick: () => writePref(null) },
								});
							}}
						>
							Always load
						</Button>
					</div>
				</div>
			</div>
		),
		{ id: PROMPT_ID, position: "top-right", duration: 15_000, className: "toast-from-right" },
	);
}
