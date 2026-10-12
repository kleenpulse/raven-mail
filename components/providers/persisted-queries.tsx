"use client";

import * as React from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useAccount } from "@/components/providers/account-provider";
import { PERSIST_MAX_AGE, persister, shouldPersist } from "@/lib/query-persist";

/**
 * A reload paints from the last session's cache and refetches stale queries
 * behind it; only a first visit, a new build or another account loads cold.
 * Queries below wait for the restore instead of fetching.
 */
export function PersistedQueries({ children }: { children: React.ReactNode }) {
  const client = useQueryClient();
  const { email } = useAccount();
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        // A new build or another account discards the cache instead of loading it.
        buster: `${process.env.BUILD_STAMP}:${email}`,
        dehydrateOptions: { shouldDehydrateQuery: (query: Query) => shouldPersist(query, email) },
        hydrateOptions: { defaultOptions: { queries: { gcTime: PERSIST_MAX_AGE } } },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
