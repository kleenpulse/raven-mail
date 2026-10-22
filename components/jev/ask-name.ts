"use client";

import { useAccount } from "@/components/providers/account-provider";
import type { JevStatus } from "@/lib/jev/client";

/**
 * Who answers Ask in this session, as the UI names it. With no Jev key
 * (the user's or the server's) Kage answers, so the button reads "Ask Kage".
 * A key that fails mid-call still falls back to Kage; the answer card labels
 * that case on its own.
 */
export function askName(status: JevStatus): "Jev" | "Kage" {
	return status.source === null && status.kage ? "Kage" : "Jev";
}

export function useAskName() {
	return askName(useAccount().jev);
}
