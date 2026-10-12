"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { qk } from "@/lib/query-keys";
import type { TriageResult } from "@/lib/mail/types";

export type DeepTriageItem = { folder: string; uid: string; messageId?: string; triage: TriageResult };
export type DeepTriage = { items: DeepTriageItem[]; triagedAt: string };

const keyFor = (email: string) => [...qk.all(email), "deep-triage"] as const;

/** Read-only view of cached Jev results — cheap enough to call per mail row. */
export function useDeepTriageMap(): Map<string, TriageResult> {
	const { email } = useAccount();
	const { data } = useQuery<DeepTriage | null>({
		queryKey: keyFor(email),
		queryFn: () => null,
		enabled: false,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
	return React.useMemo(() => {
		const map = new Map<string, TriageResult>();
		for (const item of data?.items ?? []) map.set(`${item.folder}:${item.uid}`, item.triage);
		return map;
	}, [data]);
}

/** Results live only in the query cache: paid once per session, reused by Brief + Mail badges. */
export function useDeepTriage() {
	const { email } = useAccount();
	const client = useQueryClient();
	const key = keyFor(email);
	const byRef = useDeepTriageMap();
	const data = client.getQueryData<DeepTriage | null>(key) ?? null;

	const mutation = useMutation({
		mutationFn: async () => {
			const res = await fetch("/api/jev/triage", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			const body = (await res.json().catch(() => null)) as { ok: boolean; data?: DeepTriage; error?: string } | null;
			if (!res.ok || !body?.ok || !body.data) throw new Error(body?.error ?? `Deep triage failed (${res.status}).`);
			return body.data;
		},
		onSuccess: (result) => {
			client.setQueryData(key, result);
			toast.success(`Jev triaged ${result.items.length} recent ${result.items.length === 1 ? "email" : "emails"}`);
		},
		onError: (err) => toast.error(err instanceof Error ? err.message : "Deep triage failed"),
	});

	return { data: byRef.size ? data : null, byRef, run: () => mutation.mutate(), pending: mutation.isPending };
}
