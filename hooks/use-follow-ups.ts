"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { getJson, sendJson } from "@/hooks/use-mail";
import { ApiError, toApiError } from "@/lib/api-error";
import type { FollowUpDTO, FollowUpView } from "@/lib/follow-ups/types";
import { dueLabel, SNOOZE_MS, type RemindChoice } from "@/lib/follow-ups/when";
import { qk } from "@/lib/query-keys";

/**
 * Open reminders, with `due` worked out by the server at load time. Rechecked
 * every 15 minutes while Raven is open. Errors (no database) never retry.
 */
export function useFollowUps({ enabled = true }: { enabled?: boolean } = {}) {
	const { email } = useAccount();
	return useQuery({
		queryKey: qk.followUps(email),
		queryFn: ({ signal }) => getJson<FollowUpView[]>("/api/follow-ups", signal),
		enabled,
		staleTime: 5 * 60_000,
		refetchInterval: 15 * 60_000,
		retry: (count, err) => count < 2 && !(err instanceof ApiError && !err.retryable),
	});
}

/** Due reminders only, soonest first. */
export function useDueFollowUps() {
	const query = useFollowUps();
	const due = React.useMemo(() => (query.data ?? []).filter((f) => f.due), [query.data]);
	return { ...query, due };
}

/** The open reminder watching this message, if any. */
export function useFollowUpFor(messageId: string | undefined) {
	const { data } = useFollowUps({ enabled: Boolean(messageId) });
	return messageId ? data?.find((f) => f.messageId === messageId) : undefined;
}

function report(err: unknown) {
	const e = toApiError(err);
	toast.error(e.message, { description: e.hint });
}

/** Set, finish, snooze and cancel, with the list updated first. */
export function useFollowUpActions() {
	const queryClient = useQueryClient();
	const { email } = useAccount();

	/** Change the cached list now; hand back a way to put it back. */
	const patch = React.useCallback(
		async (fn: (list: FollowUpView[]) => FollowUpView[]) => {
			const key = qk.followUps(email);
			await queryClient.cancelQueries({ queryKey: key });
			const before = queryClient.getQueryData<FollowUpView[]>(key);
			queryClient.setQueryData<FollowUpView[]>(key, (list) => (list ? fn(list) : list));
			return () => queryClient.setQueryData(key, before);
		},
		[queryClient, email],
	);

	const remind = React.useCallback(
		async (ref: { folder: string; uid: string }, choice: RemindChoice): Promise<FollowUpDTO | null> => {
			try {
				const saved = await sendJson<FollowUpDTO>("POST", "/api/follow-ups", { ...ref, remind: choice });
				void queryClient.invalidateQueries({ queryKey: qk.followUps(email) });
				toast.success(`Reminder set for ${dueLabel(saved.dueAt)}`, {
					description: "If no one replies by then, Raven reminds you.",
				});
				return saved;
			} catch (err) {
				report(err);
				return null;
			}
		},
		[queryClient, email],
	);

	const done = React.useCallback(
		async (f: FollowUpView): Promise<boolean> => {
			const undo = await patch((list) => list.filter((x) => x.id !== f.id));
			try {
				await sendJson("PATCH", "/api/follow-ups", { id: f.id, action: "done" });
				return true;
			} catch (err) {
				// Already gone (another tab) is what we wanted.
				if (toApiError(err).code === "not_found") return true;
				undo();
				report(err);
				return false;
			}
		},
		[patch],
	);

	const snooze = React.useCallback(
		async (f: FollowUpView): Promise<boolean> => {
			const dueAt = new Date(Date.now() + SNOOZE_MS).toISOString();
			const undo = await patch((list) => list.map((x) => (x.id === f.id ? { ...x, dueAt, due: false } : x)));
			try {
				await sendJson("PATCH", "/api/follow-ups", { id: f.id, action: "snooze" });
				return true;
			} catch (err) {
				undo();
				report(err);
				return false;
			}
		},
		[patch],
	);

	const cancel = React.useCallback(
		async (f: FollowUpView): Promise<boolean> => {
			const undo = await patch((list) => list.filter((x) => x.id !== f.id));
			try {
				await sendJson("DELETE", `/api/follow-ups?${new URLSearchParams({ id: f.id })}`);
				return true;
			} catch (err) {
				if (toApiError(err).code === "not_found") return true;
				undo();
				report(err);
				return false;
			}
		},
		[patch],
	);

	return { remind, done, snooze, cancel };
}
