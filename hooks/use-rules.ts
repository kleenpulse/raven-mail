"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { getJson, sendJson, useInvalidateMail } from "@/hooks/use-mail";
import { ApiError, toApiError } from "@/lib/api-error";
import { qk } from "@/lib/query-keys";
import type { DecisionEngine } from "@/lib/jev/client";
import { RUN_UID_LIMIT, type PreviewItem, type RuleAction, type RuleDTO, type RuleEventDTO, type RunSummary } from "@/lib/rules/types";

export type RulesData = { rules: RuleDTO[]; engine: DecisionEngine | null };
export type RuleInput = { criteria: string; action: RuleAction; folder?: string };

const noRetryOnFixable = (count: number, err: unknown) => count < 2 && !(err instanceof ApiError && !err.retryable);

/** The mailbox's rules in run order, and the engine that judges them. Errors (no database) never retry. */
export function useRules({ enabled = true }: { enabled?: boolean } = {}) {
	const { email } = useAccount();
	return useQuery({
		queryKey: qk.rules(email),
		queryFn: ({ signal }) => getJson<RulesData>("/api/rules", signal),
		enabled,
		staleTime: 5 * 60_000,
		retry: noRetryOnFixable,
	});
}

/** Recent activity: the newest 50 judgments. */
export function useRuleEvents({ enabled = true }: { enabled?: boolean } = {}) {
	const { email } = useAccount();
	return useQuery({
		queryKey: qk.ruleEvents(email),
		queryFn: ({ signal }) => getJson<RuleEventDTO[]>("/api/rules/events", signal),
		enabled,
		staleTime: 30_000,
		retry: noRetryOnFixable,
	});
}

function report(err: unknown) {
	const e = toApiError(err);
	toast.error(e.message, { description: e.hint });
}

/** What a run changed, in words. */
export function runMessage(s: RunSummary): string {
	if (s.checked === 0) return "No rules are on.";
	const checked = `Checked ${s.checked} ${s.checked === 1 ? "message" : "messages"}.`;
	return s.applied ? `${checked} ${s.applied} changed.` : `${checked} Nothing to change.`;
}

export function useRuleActions() {
	const queryClient = useQueryClient();
	const { email } = useAccount();
	const invalidate = useInvalidateMail();

	const setRules = React.useCallback(
		async (fn: (rules: RuleDTO[]) => RuleDTO[]) => {
			const key = qk.rules(email);
			await queryClient.cancelQueries({ queryKey: key });
			const before = queryClient.getQueryData<RulesData>(key);
			queryClient.setQueryData<RulesData>(key, (data) => (data ? { ...data, rules: fn(data.rules) } : data));
			return () => queryClient.setQueryData(key, before);
		},
		[queryClient, email],
	);
	const refresh = React.useCallback(() => void queryClient.invalidateQueries({ queryKey: qk.rules(email) }), [queryClient, email]);
	const afterRun = React.useCallback(
		(s: RunSummary) => {
			void queryClient.invalidateQueries({ queryKey: qk.ruleEvents(email) });
			if (s.applied) {
				void invalidate.invalidateMessages();
				void invalidate.invalidateFolders();
			}
		},
		[queryClient, email, invalidate],
	);

	const create = React.useCallback(
		async (input: RuleInput): Promise<RuleDTO | null> => {
			try {
				const saved = await sendJson<RuleDTO>("POST", "/api/rules", input);
				refresh();
				toast.success("Rule saved", { description: "It runs on new mail while Raven is open." });
				return saved;
			} catch (err) {
				report(err);
				return null;
			}
		},
		[refresh],
	);

	const update = React.useCallback(
		async (rule: RuleDTO, patch: Partial<RuleInput & { enabled: boolean }>): Promise<boolean> => {
			const next = { ...rule, ...patch };
			const undo = await setRules((rules) => rules.map((r) => (r.id === rule.id ? next : r)));
			try {
				await sendJson("PATCH", "/api/rules", {
					id: rule.id,
					criteria: next.criteria,
					action: next.action,
					...(next.action === "move" ? { folder: next.folder } : {}),
					enabled: next.enabled,
				});
				return true;
			} catch (err) {
				undo();
				report(err);
				return false;
			}
		},
		[setRules],
	);

	const move = React.useCallback(
		async (rule: RuleDTO, direction: "up" | "down") => {
			const undo = await setRules((rules) => {
				const i = rules.findIndex((r) => r.id === rule.id);
				const j = direction === "up" ? i - 1 : i + 1;
				if (i < 0 || j < 0 || j >= rules.length) return rules;
				const next = [...rules];
				[next[i], next[j]] = [next[j]!, next[i]!];
				return next;
			});
			try {
				await sendJson("PATCH", "/api/rules", { id: rule.id, move: direction });
			} catch (err) {
				undo();
				report(err);
			}
		},
		[setRules],
	);

	const remove = React.useCallback(
		async (rule: RuleDTO) => {
			const undo = await setRules((rules) => rules.filter((r) => r.id !== rule.id));
			try {
				await sendJson("DELETE", `/api/rules?${new URLSearchParams({ id: rule.id })}`);
				void queryClient.invalidateQueries({ queryKey: qk.ruleEvents(email) });
			} catch (err) {
				if (toApiError(err).code === "not_found") return;
				undo();
				report(err);
			}
		},
		[setRules, queryClient, email],
	);

	const preview = React.useCallback(async (input: RuleInput): Promise<PreviewItem[] | null> => {
		try {
			return await sendJson<PreviewItem[]>("POST", "/api/rules/preview", input);
		} catch (err) {
			report(err);
			return null;
		}
	}, []);

	/** "Run rules now": the newest 50 Inbox messages. */
	const runNow = React.useCallback(async (): Promise<RunSummary | null> => {
		try {
			const summary = await sendJson<RunSummary>("POST", "/api/rules/run", {});
			afterRun(summary);
			toast.success(runMessage(summary));
			return summary;
		} catch (err) {
			report(err);
			return null;
		}
	}, [afterRun]);

	const undo = React.useCallback(
		async (event: RuleEventDTO): Promise<boolean> => {
			try {
				await sendJson("POST", "/api/rules/events", { id: event.id });
				void queryClient.invalidateQueries({ queryKey: qk.ruleEvents(email) });
				void invalidate.invalidateMessages();
				void invalidate.invalidateFolders();
				toast.success("Moved back to your Inbox");
				return true;
			} catch (err) {
				report(err);
				return false;
			}
		},
		[queryClient, email, invalidate],
	);

	return { create, update, move, remove, preview, runNow, undo, afterRun };
}

/**
 * Rules on new mail: hands the arrivals' uids to the server, but only when a
 * rule is on and an engine can judge. Quiet: a failed background run is
 * logged, never toasted.
 */
export function useRulesOnArrival(): (uids: string[]) => void {
	const { data } = useRules();
	const { afterRun } = useRuleActions();
	const ready = Boolean(data?.engine && data.rules.some((r) => r.enabled));
	return React.useCallback(
		(uids: string[]) => {
			if (!ready || uids.length === 0) return;
			sendJson<RunSummary>("POST", "/api/rules/run", { uids: uids.slice(0, RUN_UID_LIMIT) })
				.then(afterRun)
				.catch((err) => console.warn("[rules] new-mail run failed", err));
		},
		[ready, afterRun],
	);
}
