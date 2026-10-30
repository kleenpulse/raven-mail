"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { onlineManager, QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useOffline } from "next/offline";
import { focusRefetch, stale } from "@/lib/prefs/query";

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return new QueryClient();
  browserQueryClient ??= new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: stale(30_000),
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: focusRefetch,
        retry: 1,
      },
    },
  });
  return browserQueryClient;
}

/**
 * Feeds Next's offline state into TanStack. TanStack already follows the
 * browser's online/offline events; this adds Next's own failed-request
 * detection and HEAD polling (captive portals, dead upstreams). Lives here,
 * always mounted, so TanStack can never be left offline by an unmount.
 */
function OnlineBridge() {
  const offline = useOffline();
  const client = useQueryClient();
  const was = React.useRef(false);
  React.useEffect(() => {
    // Only act on a change: Next starts at false before hydration and must not override TanStack's own reading.
    if (offline === was.current) return;
    was.current = offline;
    onlineManager.setOnline(!offline);
    if (!offline) {
      // Errored queries still inside staleTime aren't refetched on reconnect; join, don't cancel, TanStack's own fetches.
      void client.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" }, { cancelRefetch: false });
    }
  }, [offline, client]);
  return null;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = React.useState(getQueryClient);
  return (
    <QueryClientProvider client={client}>
      <OnlineBridge />
      {children}
    </QueryClientProvider>
  );
}
