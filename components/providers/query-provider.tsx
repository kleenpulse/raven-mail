"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = React.useState(getQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
