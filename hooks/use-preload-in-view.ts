"use client";

import * as React from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { preloadMessages } from "@/hooks/use-mail";
import { createPreloader, type Preloader } from "@/lib/mail/preload";
import { usePref } from "@/lib/prefs/store";
import { qk } from "@/lib/query-keys";
import type { MailFlags, MailMessage, MailSummary } from "@/lib/mail/types";

// About one row past the bottom edge, so j/k and a short scroll land on warm rows.
const LOOKAHEAD = "0px 0px 96px 0px";

// Module-level so sign-out can stop every preloader before it clears the cache;
// a batch landing after the clear would put this mailbox's mail back.
const live = new Set<Preloader>();

export function stopPreloading() {
  for (const preloader of live) preloader.stop();
}

function sameFlags(a: MailFlags, b: MailFlags) {
  return a.seen === b.seen && a.flagged === b.flagged && a.answered === b.answered && a.draft === b.draft;
}

/**
 * Preloaded bodies can sit in the cache for minutes, and the reader's
 * mark-as-read trusts their flags. The list refetches far more often (focus,
 * after every change), so its flags win.
 */
function syncFlags(client: QueryClient, email: string, folder: string, messages: readonly MailSummary[]) {
  for (const m of messages) {
    const key = qk.message(email, folder, m.uid);
    const cached = client.getQueryData<MailMessage>(key);
    // The Message-ID fallback can park a different message under this key.
    if (cached && cached.uid === m.uid && !sameFlags(cached.flags, m.flags)) {
      client.setQueryData<MailMessage>(key, { ...cached, flags: m.flags });
    }
  }
}

/**
 * Preloads the bodies of the list rows in view, so opening one is instant.
 * Returns a ref for the list's scroll container; rows carry `data-uid`.
 */
export function usePreloadInView(
  folder: string,
  messages: readonly MailSummary[] | undefined,
  selectedUid: string | null,
) {
  const client = useQueryClient();
  const { email } = useAccount();
  const [root, setRoot] = React.useState<HTMLElement | null>(null);
  const preloader = React.useRef<Preloader | null>(null);
  const rowsKey = messages?.map((m) => m.uid).join(",") ?? "";
  const enabled = usePref("mail.preload");

  React.useEffect(() => {
    // Preload Messages off, or data saver: bodies load on open.
    if (!enabled || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const detail = (uid: string) => qk.message(email, folder, uid);
    const p = createPreloader({
      load: (uids, signal) => preloadMessages(folder, uids, signal),
      isWarm: (uid) => {
        const state = client.getQueryState(detail(uid));
        return state !== undefined && (state.data !== undefined || state.fetchStatus !== "idle");
      },
      // Never clobber what the reader fetched, or patched, while the batch was out.
      seed: (message) => {
        if (client.getQueryData(detail(message.uid)) === undefined) client.setQueryData(detail(message.uid), message);
      },
      canRun: () => document.visibilityState === "visible",
    });
    preloader.current = p;
    live.add(p);
    // Unopened preloads are dropped after gcTime; re-warm what's in view on return.
    const onVisibility = () => {
      if (document.visibilityState === "visible") p.poke();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      p.stop();
      live.delete(p);
      preloader.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client, email, folder, enabled]);

  // Rows are observed afresh whenever the set of rows changes, not on flag changes.
  React.useEffect(() => {
    const p = preloader.current;
    if (!root || !p) return;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-uid]")];
    p.setRows(rows.map((row) => row.dataset.uid!));
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) p.see((entry.target as HTMLElement).dataset.uid!, entry.isIntersecting);
      },
      { root, rootMargin: LOOKAHEAD },
    );
    for (const row of rows) io.observe(row);
    return () => {
      io.disconnect();
      p.setRows([]);
    };
  }, [root, rowsKey]);

  // Opening a row means the user is reading down the list: re-warm the rows in
  // view, in case a long read outlasted gcTime.
  React.useEffect(() => {
    preloader.current?.poke();
  }, [selectedUid]);

  React.useEffect(() => {
    if (messages) syncFlags(client, email, folder, messages);
  }, [client, email, folder, messages]);

  return setRoot;
}
