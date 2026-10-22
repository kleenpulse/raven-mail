"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { getJson, sendJson } from "@/hooks/use-mail";
import { ApiError, toApiError } from "@/lib/api-error";
import { blockMatcher } from "@/lib/blocks/match";
import type { BlockDTO, BlockKind } from "@/lib/blocks/types";
import { qk } from "@/lib/query-keys";

/** The mailbox's blocked senders. Errors (no database) never retry. */
export function useBlocks({ enabled = true }: { enabled?: boolean } = {}) {
	const { email } = useAccount();
	return useQuery({
		queryKey: qk.blocks(email),
		queryFn: ({ signal }) => getJson<BlockDTO[]>("/api/blocks", signal),
		enabled,
		staleTime: 5 * 60_000,
		retry: (count, err) => count < 2 && !(err instanceof ApiError && !err.retryable),
	});
}

/** Which block covers a sender, if any. Nothing is blocked while loading or without a database. */
export function useBlockedSender() {
	const { data } = useBlocks();
	return React.useMemo(() => blockMatcher(data ?? []), [data]);
}

const isPending = (b: BlockDTO) => b.id.startsWith("pending:");

/** Block and unblock with the list updated first, so rows hide (or come back) at once. */
export function useBlockActions() {
	const queryClient = useQueryClient();
	const { email } = useAccount();

	const block = React.useCallback(
		async (kind: BlockKind, value: string): Promise<BlockDTO | null> => {
			const key = qk.blocks(email);
			const temp: BlockDTO = { id: `pending:${kind}:${value}`, kind, value: value.toLowerCase(), createdAt: new Date().toISOString() };
			await queryClient.cancelQueries({ queryKey: key });
			const loaded = queryClient.getQueryData<BlockDTO[]>(key) !== undefined;
			if (loaded) queryClient.setQueryData<BlockDTO[]>(key, (list = []) => [...list, temp]);
			try {
				const saved = await sendJson<BlockDTO>("POST", "/api/blocks", { kind, value });
				if (loaded) {
					queryClient.setQueryData<BlockDTO[]>(key, (list = []) => [...list.filter((b) => b.id !== temp.id && b.id !== saved.id), saved]);
				} else {
					void queryClient.invalidateQueries({ queryKey: key });
				}
				return saved;
			} catch (err) {
				if (loaded) queryClient.setQueryData<BlockDTO[]>(key, (list = []) => list.filter((b) => b.id !== temp.id));
				const e = toApiError(err);
				toast.error(e.message, { description: e.hint });
				return null;
			}
		},
		[queryClient, email],
	);

	const unblock = React.useCallback(
		async (entry: BlockDTO): Promise<boolean> => {
			if (isPending(entry)) return false;
			const key = qk.blocks(email);
			await queryClient.cancelQueries({ queryKey: key });
			const before = queryClient.getQueryData<BlockDTO[]>(key);
			queryClient.setQueryData<BlockDTO[]>(key, (list) => list?.filter((b) => b.id !== entry.id));
			try {
				await sendJson("DELETE", `/api/blocks?${new URLSearchParams({ id: entry.id })}`);
				return true;
			} catch (err) {
				const e = toApiError(err);
				// Already gone (another tab) is what we wanted.
				if (e.code === "not_found") return true;
				queryClient.setQueryData(key, before);
				toast.error(e.message, { description: e.hint });
				return false;
			}
		},
		[queryClient, email],
	);

	return { block, unblock };
}
