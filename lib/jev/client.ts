import "server-only";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { MailSession } from "@/lib/session";

/** Whose key pays for the call: the signed-in user's (BYOK) or the deployment's. */
export type JevSource = "user" | "server";
export type Jev = { client: TypeSafeClient; source: JevSource };

const MAX_USER_CLIENTS = 50;
let serverClient: TypeSafeClient | null = null;
const userClients = new Map<string, TypeSafeClient>();

function serverKey(): string | undefined {
  return process.env.TYPESAFE_API_KEY?.trim() || undefined;
}

/** Interactive asks can't wait out long retry chains. */
function createClient(apiKey: string): TypeSafeClient {
  return new TypeSafeClient({
    apiKey,
    defaultModel: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest",
    timeout: 8_000,
    retry: { maxRetries: 1 },
  });
}

function clientForKey(apiKey: string): TypeSafeClient {
  let client = userClients.get(apiKey);
  if (client) {
    // Refresh recency so the busiest keys survive eviction.
    userClients.delete(apiKey);
  } else {
    client = createClient(apiKey);
    if (userClients.size >= MAX_USER_CLIENTS) userClients.delete(userClients.keys().next().value!);
  }
  userClients.set(apiKey, client);
  return client;
}

/** One free call that proves TypeSafe accepts the key. Throws the SDK's error. */
export async function verifyJevKey(apiKey: string): Promise<void> {
  // A throwaway client: rejected keys never enter the cache.
  await createClient(apiKey).models.list({ timeout: 5_000, retry: { maxRetries: 0 } });
}

/**
 * The Jev this request may use. A key the user saved in Settings wins over the
 * deployment's TYPESAFE_API_KEY; with neither, callers fall back to heuristics.
 */
export function jevFor(session: Pick<MailSession, "jevKey"> | null): Jev | null {
  if (session?.jevKey) return { client: clientForKey(session.jevKey), source: "user" };
  const key = serverKey();
  if (!key) return null;
  serverClient ??= createClient(key);
  return { client: serverClient, source: "server" };
}

/** What the UI may know about the key: never the key, only its last four characters. */
export type JevStatus = { source: JevSource | null; hint: string | null };

export function jevStatus(session: Pick<MailSession, "jevKey"> | null): JevStatus {
  if (session?.jevKey) return { source: "user", hint: session.jevKey.slice(-4) };
  return { source: serverKey() ? "server" : null, hint: null };
}
