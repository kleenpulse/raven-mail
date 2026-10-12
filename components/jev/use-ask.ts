"use client";

import * as React from "react";
import { useAskStore } from "@/components/jev/ask-store";
import { useTimeZone } from "@/hooks/use-overview";
import type { AskEvent, Intent } from "@/lib/jev/ask/types";

let inflight: AbortController | null = null;

export type AskOptions = {
	forcedIntent?: Intent;
	/** Literal search text that narrows a forced list intent (needs reply, newsletters). */
	filter?: string;
	context?: { folder?: string; uid?: string };
};

/** POST a question and fold the NDJSON stage/answer events into the store. */
export function useAsk() {
	const tz = useTimeZone();

	return React.useCallback(
		async (question: string, options: AskOptions = {}) => {
			const text = question.trim();
			if (!text) return;
			const store = useAskStore.getState();
			const id = crypto.randomUUID();
			store.start({ id, question: text, forcedIntent: options.forcedIntent, status: "running", stages: [], at: Date.now() });

			inflight?.abort();
			const controller = new AbortController();
			inflight = controller;

			try {
				const res = await fetch("/api/jev/ask", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						question: text,
						forcedIntent: options.forcedIntent,
						filter: options.filter || undefined,
						tz: tz || "UTC",
						context: options.context,
					}),
					signal: controller.signal,
				});
				if (res.status === 401) {
					window.location.replace("/login");
					return;
				}
				if (!res.ok || !res.body) {
					const body = (await res.json().catch(() => null)) as { error?: string } | null;
					throw new Error(body?.error ?? `Jev couldn’t answer (${res.status}).`);
				}

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				const handle = (event: AskEvent) => {
					const s = useAskStore.getState();
					if (event.type === "stage") s.pushStage(id, event.stage, event.detail);
					else if (event.type === "answer") s.update(id, { status: "done", answer: event.answer });
					else s.update(id, { status: "error", error: event.message });
				};
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let newline = buffer.indexOf("\n");
					while (newline >= 0) {
						const line = buffer.slice(0, newline).trim();
						buffer = buffer.slice(newline + 1);
						if (line) handle(JSON.parse(line) as AskEvent);
						newline = buffer.indexOf("\n");
					}
				}
				const turn = useAskStore.getState().turns.find((t) => t.id === id);
				if (turn?.status === "running") {
					useAskStore.getState().update(id, { status: "error", error: "The answer stream ended early." });
				}
			} catch (err) {
				if (controller.signal.aborted) {
					useAskStore.getState().update(id, { status: "error", error: "Superseded by a newer question." });
					return;
				}
				useAskStore
					.getState()
					.update(id, { status: "error", error: err instanceof Error ? err.message : "Something went wrong." });
			} finally {
				if (inflight === controller) inflight = null;
			}
		},
		[tz],
	);
}
