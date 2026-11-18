"use client";

import * as React from "react";
import { ExternalLink, LoaderCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/settings/setting-row";
import { useDesktopUpdate } from "@/components/shell/update-pill";
import { ravenDesktop, type DesktopUpdateCheck } from "@/lib/desktop/bridge";

/** What a check says when no update is on its way. A found one shows through the update state instead. */
const ANSWER: Record<DesktopUpdateCheck, string | null> = {
	current: "You have the newest version.",
	found: null,
	failed: "Raven couldn't check for updates. Check your connection and try again.",
	off: "This build doesn't update itself.",
};

/**
 * Desktop only. Settings → About: checks now and answers in the row. An
 * update that's on its way shows the same steps as the pill in the top bar.
 */
export function UpdatesRow() {
	const state = useDesktopUpdate();
	const [busy, setBusy] = React.useState(false);
	const [answer, setAnswer] = React.useState<DesktopUpdateCheck | null>(null);

	async function check() {
		const update = ravenDesktop()?.update;
		setBusy(true);
		setAnswer(null);
		try {
			// A desktop build from before this button has nothing to ask.
			setAnswer(update?.check ? await update.check() : "off");
		} catch {
			setAnswer("failed");
		} finally {
			setBusy(false);
		}
	}

	const act = (action: "restart" | "open-release") => ravenDesktop()?.update.act(action);
	const line =
		state.kind === "downloading"
			? `Downloading Raven ${state.version}: ${state.percent}%`
			: state.kind === "ready"
				? `Raven ${state.version} is ready.`
				: state.kind === "available"
					? `Raven ${state.version} is out.`
					: busy || !answer
						? null
						: ANSWER[answer];

	return (
		<SettingRow id="updates" layout="wide">
			{(labelId) => (
				<div className="flex flex-col items-start sm:items-end">
					{state.kind === "ready" ? (
						<Button
							variant="inverse"
							size="pill-sm"
							aria-describedby={labelId}
							onClick={() => act("restart")}
							// The pill's colours in the dark theme, so both restart buttons read as one.
							className="dark:bg-signal dark:text-primary-foreground dark:hover:bg-signal/88"
						>
							<RotateCw />
							Restart to update
						</Button>
					) : state.kind === "available" ? (
						<Button variant="surface" size="pill-sm" aria-describedby={labelId} onClick={() => act("open-release")}>
							Open the download page
							<ExternalLink />
						</Button>
					) : (
						<Button
							variant="surface"
							size="pill-sm"
							aria-describedby={labelId}
							disabled={busy || state.kind === "downloading"}
							onClick={() => void check()}
						>
							{busy && <LoaderCircle className="animate-spin" />}
							{busy ? "Checking…" : "Check for updates"}
						</Button>
					)}
					{/* Always mounted, so a screen reader hears the answer when it lands. */}
					<p
						role="status"
						className="mt-1.5 max-w-[34ch] text-[12px] leading-snug text-pretty text-ink-2 tabular-nums empty:mt-0 sm:text-right"
					>
						{line}
					</p>
				</div>
			)}
		</SettingRow>
	);
}
