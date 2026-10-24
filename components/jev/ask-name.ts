"use client";

import { useAccount } from "@/components/providers/account-provider";
import { useAskStore, type AskTurn } from "@/components/jev/ask-store";
import type { JevStatus } from "@/lib/jev/client";

/**
 * Who answers Ask in this session, as the UI names it. With no working Jev
 * key (none set, or TypeSafe rejected it at the server's last check) Kage
 * answers, so the button reads "Ask Kage".
 */
export function askName(status: JevStatus): "Jev" | "Kage" {
	return status.kage && !(status.source !== null && status.live) ? "Kage" : "Jev";
}

/**
 * The engine behind the latest real answer. A key can exist and still fail
 * (expired, revoked), and then every answer comes from the Kage fallback, so
 * this beats the guess from the key. Keyword and suggested answers name no engine.
 */
export function answeredBy(turns: AskTurn[]): "Jev" | "Kage" | null {
	for (let i = turns.length - 1; i >= 0; i--) {
		const source = turns[i]!.answer?.plan.source;
		if (source === "jev") return "Jev";
		if (source === "kage") return "Kage";
	}
	return null;
}

export function useAnsweredBy() {
	return useAskStore((s) => answeredBy(s.turns));
}

export function useAskName() {
	const guess = askName(useAccount().jev);
	return useAnsweredBy() ?? guess;
}
