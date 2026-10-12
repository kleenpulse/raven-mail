"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { readApiError, toApiError } from "@/lib/api-error";
import type { TestRunEvent } from "@/lib/dev/test-report";
import { applyRunEvent, IDLE_RUN, RUNNING, type RunState } from "@/lib/dev/test-run-state";
import { readNdjson } from "@/lib/ndjson-client";

/** Starts a suite run on the dev server and mirrors its NDJSON progress. */
export function useTestRun(url = "/api/dev/tests/run") {
	const router = useRouter();
	const [state, setState] = React.useState<RunState>(IDLE_RUN);
	const controller = React.useRef<AbortController | null>(null);

	React.useEffect(() => () => controller.current?.abort(), []);

	const run = React.useCallback(
		async () => {
			if (controller.current) return;
			const ctrl = new AbortController();
			controller.current = ctrl;
			let current: RunState = RUNNING;
			const commit = (next: RunState) => {
				current = next;
				if (!ctrl.signal.aborted) setState(next);
			};
			commit(current);

			try {
				const res = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/x-ndjson" },
					// Coverage adds ~0.1s on this suite, so the page always collects it.
					body: JSON.stringify({ coverage: true }),
					signal: ctrl.signal,
				});
				if (res.status === 401) {
					window.location.replace("/login");
					return;
				}
				if (!res.ok || !res.body) {
					commit({ ...current, status: "error", error: (await readApiError(res)).message });
					return;
				}
				await readNdjson<TestRunEvent>(res.body, (event) => commit(applyRunEvent(current, event)));
				if (current.status === "running") commit({ ...current, status: "error", error: "The run ended without a report." });
				if (current.status === "done") router.refresh();
			} catch (err) {
				if (!ctrl.signal.aborted) commit({ ...current, status: "error", error: toApiError(err).message });
			} finally {
				if (controller.current === ctrl) controller.current = null;
			}
		},
		[url, router],
	);

	return { state, run, running: state.status === "running" };
}
