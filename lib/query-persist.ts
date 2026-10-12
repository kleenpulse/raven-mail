import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { defaultShouldDehydrateQuery, type InfiniteData, type Query } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { createStore, del, get, set, type UseStore } from "idb-keyval";
import { getPref } from "@/lib/prefs/store";

/**
 * How long a reload may paint from the cache before falling back to a cold
 * load. Also the gcTime of the persisted kinds: a query dropped from memory
 * drops out of the next save.
 */
export const PERSIST_MAX_AGE = 7 * 24 * 3_600_000;

let db: UseStore | undefined;
const store = () => (db ??= createStore("raven", "query-cache"));

// Closed by `forgetPersistedQueries` until the next restore: a throttled save
// still queued must not write this mailbox back after sign-out.
let writable = true;

/**
 * Cheap to keep, slow to rebuild: the overview's IMAP snapshot, folder counts,
 * each folder's first page, paid Jev results. Message bodies and searches stay
 * in memory only.
 */
export function shouldPersist(query: Query, account: string): boolean {
  if (!getPref("sync.offlineCache")) return false;
  const [scope, owner, kind, , search] = query.queryKey;
  if (scope !== "acct" || owner !== account || !defaultShouldDehydrateQuery(query)) return false;
  return kind === "overview" || kind === "folders" || kind === "deep-triage" || (kind === "messages" && search === "");
}

/** A restored list refetches every page it holds, one IMAP round-trip each; keep the first. */
function firstPagesOnly(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries.map((query) => {
    const data = query.state.data as InfiniteData<unknown> | undefined;
    if (query.queryKey[2] !== "messages" || !data || data.pages.length <= 1) return query;
    return {
      ...query,
      state: { ...query.state, data: { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } },
    };
  });
  return { ...client, clientState: { ...client.clientState, queries } };
}

const idbPersister = createAsyncStoragePersister({
  // IndexedDB, not localStorage: no 5 MB cap, and writes don't block the main thread.
  storage:
    typeof window === "undefined"
      ? undefined
      : {
          getItem: (key) => get<string>(key, store()),
          setItem: async (key, value) => {
            // Offline Cache off (Settings → Sync): nothing reaches disk.
            if (writable && getPref("sync.offlineCache")) await set(key, value, store());
          },
          removeItem: (key) => del(key, store()),
        },
  key: "queries",
  serialize: (client) => JSON.stringify(firstPagesOnly(client)),
});

export const persister: Persister = {
  ...idbPersister,
  restoreClient: () => {
    writable = true;
    return idbPersister.restoreClient();
  },
};

/** Sign-out and sign-in: nothing from a mailbox outlives its session on this device. */
export async function forgetPersistedQueries(): Promise<void> {
  writable = false;
  await idbPersister.removeClient();
}

/** Settings → Clear Local Cache / Offline Cache off: empty the store but keep saving afterwards. */
export async function clearPersistedQueries(): Promise<void> {
  await idbPersister.removeClient();
}
