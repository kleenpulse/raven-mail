"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useStore } from "zustand";
import { formatBytes, percent } from "@/lib/integrations/export/progress";
import { useExportRun } from "@/lib/store/export-run";

const TOAST_ID = "raven-export";
const ACTIVE = new Set(["planning", "running", "paused", "saving"]);

/**
 * While an export runs and you're elsewhere in the app, one toast mirrors it;
 * "View" jumps back to the panel. On the Integrations page the panel is enough.
 */
export function ExportRunToast() {
	const pathname = usePathname();
	const router = useRouter();
	const phase = useStore(useExportRun, (s) => s.phase);
	const folder = useStore(useExportRun, (s) => s.folder);
	const outcome = useStore(useExportRun, (s) => s.outcome);
	const failed = useStore(useExportRun, (s) => s.error);
	const pct = useStore(useExportRun, (s) => (s.progress ? percent(s.progress) : 0));
	const bytes = useStore(useExportRun, (s) => s.progress?.receivedBytes ?? 0);
	const onPage = pathname.startsWith("/integrations");
	const wasActive = React.useRef(false);

	React.useEffect(() => {
		const name = folder === "INBOX" ? "Inbox" : folder;
		const view = { label: "View", onClick: () => router.push("/integrations?i=export") };
		const active = ACTIVE.has(phase);

		if (active && !onPage) {
			wasActive.current = true;
			const title =
				phase === "paused" ? (failed ? "Export paused — needs you" : "Export paused") : phase === "saving" ? "Finishing export…" : `Exporting ${name} · ${pct}%`;
			toast(title, {
				id: TOAST_ID,
				duration: Infinity,
				description: phase === "paused" ? (failed?.message ?? "Resume from Integrations.") : `${formatBytes(bytes)} saved so far`,
				action: view,
			});
			return;
		}

		if (!active && wasActive.current && !onPage && (phase === "done" || phase === "stopped")) {
			wasActive.current = false;
			if (phase === "done") toast.success(`Exported ${name}`, { id: TOAST_ID, duration: 8000, description: outcome ?? undefined, action: view });
			else toast(outcome ?? "Export stopped", { id: TOAST_ID, duration: 8000, action: view });
			return;
		}

		if (!active) wasActive.current = false;
		toast.dismiss(TOAST_ID);
	}, [phase, pct, bytes, onPage, folder, outcome, failed, router]);

	return null;
}
