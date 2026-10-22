import "server-only";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { kage, kageEnabled, withKageFallback, type DecisionClient } from "@/lib/kage";
import type { MailSession } from "@/lib/session";

/**
 * Whose engine answers: the signed-in user's Jev key (BYOK), the deployment's,
 * or Kage — the built-in engine for everyone without a key.
 */
export type JevSource = "user" | "server" | "kage";
export type Jev = { client: DecisionClient; source: JevSource };
export type TypeSafeAccess = { client: TypeSafeClient; source: Exclude<JevSource, "kage"> };

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

/** The raw TypeSafe client, for diagnostics that must talk to Jev itself. */
export function typesafeFor(session: Pick<MailSession, "jevKey"> | null): TypeSafeAccess | null {
  if (session?.jevKey) return { client: clientForKey(session.jevKey), source: "user" };
  const key = serverKey();
  if (!key) return null;
  serverClient ??= createClient(key);
  return { client: serverClient, source: "server" };
}

/**
 * The engine this request may use. A key the user saved in Settings wins over
 * the deployment's TYPESAFE_API_KEY, and a failed Jev call is answered by Kage.
 * With no key, Kage answers alone; with KAGE=off too, callers use heuristics.
 */
export function jevFor(session: Pick<MailSession, "jevKey"> | null): Jev | null {
  const typesafe = typesafeFor(session);
  if (typesafe) return { client: withKageFallback(typesafe.client), source: typesafe.source };
  return kageEnabled() ? { client: kage, source: "kage" } : null;
}

/** Which engine Ask and Deep triage run on, for labels and live dots. */
export type DecisionEngine = "jev" | "kage";

export function decisionEngine(session: Pick<MailSession, "jevKey"> | null): DecisionEngine | null {
  if (session?.jevKey || serverKey()) return "jev";
  return kageEnabled() ? "kage" : null;
}

/** What the UI may know about the key: never the key, only its last four characters. */
export type JevStatus = { source: Exclude<JevSource, "kage"> | null; hint: string | null; kage: boolean };

export function jevStatus(session: Pick<MailSession, "jevKey"> | null): JevStatus {
  const kage = kageEnabled();
  if (session?.jevKey) return { source: "user", hint: session.jevKey.slice(-4), kage };
  return { source: serverKey() ? "server" : null, hint: null, kage };
}
