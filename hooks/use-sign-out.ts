"use client";

import { useQueryClient } from "@tanstack/react-query";
import { logoutAction } from "@/lib/actions/auth";
import { useComposeStore } from "@/lib/store/compose";
import { exportRun } from "@/lib/store/export-run";
import { forgetWeatherPlace } from "@/hooks/use-local-weather";
import { stopPreloading } from "@/hooks/use-preload-in-view";
import { forgetPersistedQueries } from "@/lib/query-persist";
import { forgetPreviews } from "@/lib/mail/preview-cache";

/** Nothing from this mailbox may survive into the next session on this device. */
export function useSignOut() {
	const queryClient = useQueryClient();
	return async () => {
		// An export in flight belongs to this mailbox; its partial file is discarded.
		exportRun.abort();
		// Before the clear: a preload landing after it would put this mailbox's mail back.
		stopPreloading();
		queryClient.clear();
		forgetPreviews();
		// Where this person said they are is theirs, not the next person's on this device.
		forgetWeatherPlace();
		await forgetPersistedQueries();
		useComposeStore.getState().closeCompose();
		try {
			localStorage.removeItem("em-compose");
			localStorage.removeItem("em-compose-local");
			sessionStorage.clear();
		} catch {
			/* storage unavailable */
		}
		await logoutAction();
	};
}
