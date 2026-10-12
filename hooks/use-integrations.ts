"use client";

import * as React from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { getJson } from "@/hooks/use-mail";
import {
	disconnectIntegrationAction,
	renameIntegrationAction,
	rotateSigningSecretAction,
	setIntegrationPausedAction,
	type IntegrationActionResult,
} from "@/lib/actions/integrations";
import { ApiError, readApiError, toApiError } from "@/lib/api-error";
import { ERROR_COPY, isErrorCode } from "@/lib/integrations/errors";
import type {
	ConnectionDTO,
	DeliveryReport,
	EventsPage,
	EventTarget,
	IntegrationsOverview,
	SendBriefInput,
	SharedEmail,
} from "@/lib/integrations/types";
import { qk } from "@/lib/query-keys";
import { stale } from "@/lib/prefs/query";

const fetchOverview = (signal?: AbortSignal) => getJson<IntegrationsOverview>("/api/integrations", signal);

/** `enabled: false` until needed (e.g. a Share menu opening) keeps Mail off the DB. */
export function useIntegrations({ enabled = true }: { enabled?: boolean } = {}) {
	const { email } = useAccount();
	return useQuery({
		queryKey: qk.integrations(email),
		queryFn: ({ signal }) => fetchOverview(signal),
		staleTime: stale(60_000),
		enabled,
	});
}

/** Cache only — rail badges must not wake the database on every page. */
export function useCachedIntegrations(): IntegrationsOverview | undefined {
	const { email } = useAccount();
	return useQuery({ queryKey: qk.integrations(email), queryFn: ({ signal }) => fetchOverview(signal), enabled: false }).data;
}

/** Connections worth a look: flagged, or last delivery failed after the last success. */
export function needsAttention(c: ConnectionDTO): boolean {
	return c.status === "error";
}

export function useIntegrationEvents(filter: { integrationId?: string; target?: EventTarget } = {}, enabled = true) {
	const { email } = useAccount();
	return useInfiniteQuery({
		queryKey: qk.integrationEvents(email, filter),
		queryFn: ({ pageParam, signal }) => {
			const params = new URLSearchParams({ limit: "15" });
			if (filter.integrationId) params.set("integrationId", filter.integrationId);
			if (filter.target) params.set("target", filter.target);
			if (pageParam) params.set("cursor", String(pageParam));
			return getJson<EventsPage>(`/api/integrations/events?${params}`, signal);
		},
		initialPageParam: null as number | null,
		getNextPageParam: (last) => last.nextCursor,
		enabled,
		staleTime: stale(15_000),
	});
}

export function useRefreshIntegrations() {
	const queryClient = useQueryClient();
	const { email } = useAccount();
	// Prefix match: the overview and every activity list.
	return React.useCallback(() => queryClient.invalidateQueries({ queryKey: qk.integrations(email) }), [queryClient, email]);
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (res.status === 401) {
		window.location.replace("/login");
		throw new ApiError("Your session expired.", { status: 401, code: "unauthorized" });
	}
	if (!res.ok) throw await readApiError(res);
	const data = (await res.json()) as { ok: true; data: T };
	return data.data;
}

export function isAttentionCode(code: string): boolean {
	return isErrorCode(code) && ERROR_COPY[code].attention;
}

function waitHint(err: ApiError): string | undefined {
	if (err.retryAfterMs) return `Try again in ${Math.max(1, Math.ceil(err.retryAfterMs / 1000))}s.`;
	return err.hint;
}

/** Share + brief with one toast per send: sending → sent / failed, with Retry or Fix. */
export function useDeliver() {
	const router = useRouter();
	const refresh = useRefreshIntegrations();

	const deliver = React.useCallback(
		async function run(conn: ConnectionDTO, url: string, body: unknown, verb: { doing: string; done: string }): Promise<boolean> {
			const id = `deliver:${conn.id}:${url}`;
			toast.loading(`${verb.doing} ${conn.label}…`, { id, description: undefined, action: undefined });
			try {
				const report = await postJson<DeliveryReport>(url, body);
				toast.success(`${verb.done} ${conn.label}`, {
					id,
					description: `Delivered in ${report.latencyMs} ms${report.attempts > 1 ? ` after ${report.attempts} tries` : ""}.`,
					action: { label: "Activity", onClick: () => router.push(`/integrations?i=${conn.id}`) },
				});
				void refresh();
				return true;
			} catch (err) {
				const e = toApiError(err);
				const fix = isAttentionCode(e.code) || e.code === "paused";
				toast.error(e.message, {
					id,
					description: waitHint(e),
					action: fix
						? { label: "Fix", onClick: () => router.push(`/integrations?i=${conn.id}`) }
						: e.retryable
							? { label: "Retry", onClick: () => void run(conn, url, body, verb) }
							: undefined,
				});
				void refresh();
				return false;
			}
		},
		[router, refresh],
	);

	return React.useMemo(
		() => ({
			shareEmail: (conn: ConnectionDTO, email: SharedEmail) =>
				deliver(conn, "/api/integrations/share", { integrationId: conn.id, email }, { doing: "Sharing to", done: "Shared to" }),
			sendBrief: (conn: ConnectionDTO, input: Omit<SendBriefInput, "integrationId">) =>
				deliver(conn, "/api/integrations/brief", { ...input, integrationId: conn.id }, { doing: "Sending the brief to", done: "Brief sent to" }),
		}),
		[deliver],
	);
}

/** Rename / pause / disconnect / rotate: server actions, toasts on failure, fresh data after. */
export function useConnectionActions() {
	const refresh = useRefreshIntegrations();

	return React.useMemo(() => {
		async function settle<T>(promise: Promise<IntegrationActionResult<T>>, success?: string): Promise<T | null> {
			try {
				const res = await promise;
				if (!res.ok) {
					toast.error(res.error, { description: res.hint });
					return null;
				}
				if (success) toast.success(success);
				return res.data;
			} catch {
				// A deploy can retire the action ID this tab was built with.
				toast.error("Raven was updated in the background.", {
					description: "Reload to pick up the new version.",
					action: { label: "Reload", onClick: () => window.location.reload() },
				});
				return null;
			} finally {
				void refresh();
			}
		}
		return {
			rename: (id: string, label: string) => settle(renameIntegrationAction({ id, label })),
			setPaused: (id: string, paused: boolean) => settle(setIntegrationPausedAction({ id, paused }), paused ? "Paused" : "Resumed"),
			disconnect: (id: string, label: string) => settle(disconnectIntegrationAction(id), `Disconnected ${label}`),
			rotate: (id: string) => settle(rotateSigningSecretAction(id)),
		};
	}, [refresh]);
}
