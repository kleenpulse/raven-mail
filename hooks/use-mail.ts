"use client";

import * as React from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { setFlagsAction } from "@/lib/actions/mail";
import { useAccount } from "@/components/providers/account-provider";
import { readApiError } from "@/lib/api-error";
import { qk } from "@/lib/query-keys";
import { PERSIST_MAX_AGE } from "@/lib/query-persist";
import type { MailFlags, MailFolder, MailMessage, MailSummary, MailThread } from "@/lib/mail/types";
import type { PreloadResult } from "@/lib/mail/preload";
import { stale } from "@/lib/prefs/query";
import { usePref } from "@/lib/prefs/store";
import { mapCachedPages, type MessagesCache, type MessagesPage } from "@/lib/mail/cache-pages";

export { mapCachedPages, type MessagesCache, type MessagesPage };

/** GET a `{ ok, data }` route; 401 → back to login. Aborts via TanStack's signal. */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
  if (res.status === 401) {
    // Hard navigation on purpose: drops every in-memory cache of the expired session.
    window.location.replace("/login");
    throw new Error("Your session expired.");
  }
  // ApiError extends Error: callers reading `.message` keep working; new ones get `.code`/`.hint`.
  if (!res.ok) throw await readApiError(res);
  const body = (await res.json().catch(() => null)) as { ok: true; data: T } | { ok: false; error: string } | null;
  if (!body || !body.ok) throw new Error(body && !body.ok ? body.error : `Request failed (${res.status})`);
  return body.data;
}

export function useFolders() {
  const { email } = useAccount();
  return useQuery({
    queryKey: qk.folders(email),
    queryFn: ({ signal }) => getJson<MailFolder[]>("/api/mail/folders", signal),
    staleTime: stale(60_000),
    gcTime: PERSIST_MAX_AGE,
  });
}

const PAGE_SIZE = 50;

function flattenPages(data: MessagesCache): MessagesPage {
  const seen = new Set<string>();
  const messages: MailSummary[] = [];
  for (const page of data.pages) {
    for (const m of page.messages) {
      if (seen.has(m.uid)) continue;
      seen.add(m.uid);
      messages.push(m);
    }
  }
  return { messages, count: data.pages[0]?.count ?? messages.length };
}

export function useMessages(folder: string, search?: string) {
  const { email } = useAccount();
  return useInfiniteQuery({
    queryKey: qk.messages(email, folder, search ?? ""),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ folder, limit: String(PAGE_SIZE) });
      if (search) params.set("q", search);
      if (pageParam) params.set("before", pageParam);
      return getJson<MessagesPage>(`/api/mail/messages?${params}`, signal);
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.messages.length, 0);
      if (last.messages.length < PAGE_SIZE || loaded >= last.count) return undefined;
      return String(Math.min(...last.messages.map((m) => Number(m.uid))));
    },
    select: flattenPages,
    enabled: Boolean(folder),
    // Plain lists are persisted across reloads; searches are throwaway.
    ...(search ? {} : { gcTime: PERSIST_MAX_AGE }),
  });
}

export function messageQuery(email: string, folder: string, uid: string, mid?: string | null) {
  return {
    queryKey: qk.message(email, folder, uid),
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const params = new URLSearchParams({ folder, uid });
      if (mid) params.set("mid", mid);
      return getJson<MailMessage>(`/api/mail/message?${params}`, signal);
    },
    staleTime: stale(5 * 60_000),
  };
}

export function useMessage(folder: string, uid: string | null) {
  const { email } = useAccount();
  // Links from Overview/Ask carry `mid` as a fallback locator; it isn't part of the cache key.
  const mid = useSearchParams().get("mid");
  return useQuery({
    ...messageQuery(email, folder, uid ?? "", mid),
    enabled: Boolean(folder && uid),
  });
}

/** The conversation around the open message (its folder plus Sent). Off when threading is. */
export function useThread(folder: string, uid: string | null) {
  const { email } = useAccount();
  const threading = usePref("mail.threading");
  return useQuery({
    queryKey: qk.thread(email, folder, uid ?? ""),
    queryFn: ({ signal }) =>
      getJson<MailThread>(`/api/mail/thread?${new URLSearchParams({ folder, uid: uid ?? "" })}`, signal),
    enabled: threading && Boolean(folder && uid),
    staleTime: stale(5 * 60_000),
  });
}

/**
 * Warms the messages either side of the open one, so prev/next and j/k open
 * instantly even while the list — and its in-view preloader — is hidden.
 * Same key and fetcher as the reader, so a step taken mid-flight joins the
 * request instead of starting another. Bodies are fetched with PEEK, so
 * nothing is marked read.
 */
export function usePrefetchNeighbours(folder: string, uids: readonly (string | undefined)[]) {
  const client = useQueryClient();
  const { email } = useAccount();
  const key = uids.join(",");
  const preload = usePref("mail.preload");
  React.useEffect(() => {
    if (!preload || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
    for (const uid of key.split(",")) {
      if (uid) void client.prefetchQuery(messageQuery(email, folder, uid));
    }
  }, [client, email, folder, key, preload]);
}

/** Bodies for the list rows in view; see `usePreloadInView`. */
export function preloadMessages(folder: string, uids: string[], signal: AbortSignal): Promise<PreloadResult> {
  const params = new URLSearchParams({ folder, uids: uids.join(",") });
  return getJson<PreloadResult>(`/api/mail/preload?${params}`, signal);
}

export function useInvalidateMail() {
  const client = useQueryClient();
  const { email } = useAccount();
  // Stable identity: consumers put this in effect deps.
  return React.useMemo(
    () => ({
      invalidateFolders: () => client.invalidateQueries({ queryKey: qk.folders(email) }),
      // Anything that changes messages also changes the Overview numbers.
      invalidateMessages: (folder?: string) =>
        Promise.all([
          client.invalidateQueries({
            queryKey: folder ? [...qk.messagesRoot(email), folder] : qk.messagesRoot(email),
          }),
          client.invalidateQueries({ queryKey: [...qk.all(email), "overview"] }),
        ]),
      invalidateMessage: () => client.invalidateQueries({ queryKey: qk.messageRoot(email) }),
    }),
    [client, email],
  );
}

type FlagPatch = Partial<Pick<MailFlags, "seen" | "flagged">>;

/** Optimistic flag changes across every cached list + the open message. */
export function useSetFlags() {
  const client = useQueryClient();
  const { email } = useAccount();
  const invalidate = useInvalidateMail();

  return useMutation({
    mutationFn: async (input: { folder: string; uids: string[] } & FlagPatch) => {
      const res = await setFlagsAction(input);
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async ({ folder, uids, ...patch }) => {
      const listRoot = [...qk.messagesRoot(email), folder];
      const detailRoot = [...qk.messageRoot(email), folder];
      await Promise.all([
        client.cancelQueries({ queryKey: listRoot }),
        client.cancelQueries({ queryKey: detailRoot }),
      ]);
      const ids = new Set(uids);
      const previous: [QueryKey, unknown][] = [
        ...client.getQueriesData({ queryKey: listRoot }),
        ...client.getQueriesData({ queryKey: detailRoot }),
        ...client.getQueriesData({ queryKey: qk.folders(email) }),
      ];

      // The same message can sit in several cached lists (plain + search); count it once.
      const counted = new Set<string>();
      let unreadDelta = 0;
      client.setQueriesData<MessagesCache>({ queryKey: listRoot }, (old) =>
        mapCachedPages(old, (messages) =>
          messages.map((m) => {
            if (!ids.has(m.uid)) return m;
            if (patch.seen !== undefined && m.flags.seen !== patch.seen && !counted.has(m.uid)) {
              counted.add(m.uid);
              unreadDelta += patch.seen ? -1 : 1;
            }
            return { ...m, flags: { ...m.flags, ...patch } };
          }),
        ),
      );
      client.setQueriesData<MailMessage>({ queryKey: detailRoot }, (old) =>
        old && ids.has(old.uid) ? { ...old, flags: { ...old.flags, ...patch } } : old,
      );
      if (unreadDelta !== 0) {
        client.setQueryData<MailFolder[]>(qk.folders(email), (old) =>
          old?.map((f) => (f.path === folder ? { ...f, unread: Math.max(0, f.unread + unreadDelta) } : f)),
        );
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) client.setQueryData(key, data);
      toast.error(err instanceof Error ? err.message : "Could not update message");
    },
    onSettled: (_data, _err, { folder }) => {
      void invalidate.invalidateMessages(folder);
      void invalidate.invalidateFolders();
    },
  });
}
