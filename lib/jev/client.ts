import "server-only";
import { AuthenticationError, PermissionDeniedError, TypeSafeClient } from "@typesafe-ai/sdk";
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
export async function verifyJevKey(apiKey: string, timeout = 5_000): Promise<void> {
  // A throwaway client: rejected keys never enter the cache.
  await createClient(apiKey).models.list({ timeout, retry: { maxRetries: 0 } });
  remember(apiKey, true, LIVE_TTL_MS);
}

/*
 * Key health, per server instance. A key can be set and still dead (revoked,
 * expired), and then every answer quietly comes from Kage. The layout checks
 * once before it renders so the UI names the engine that will really answer,
 * and jevFor skips a key TypeSafe rejected instead of waiting on it each time.
 */
const LIVE_TTL_MS = 10 * 60_000;
/**
 * A rejected key stays dead until replaced, and replacing it resets this: a new
 * env key restarts the server, a saved user key is verified (and cached) on save.
 */
const REJECTED_TTL_MS = 60 * 60_000;
/** Timeouts and outages may pass quickly. */
const UNSURE_TTL_MS = 30_000;
const CHECK_TIMEOUT_MS = 3_000;
const MAX_HEALTH = 100;
const health = new Map<string, { live: boolean; rejected: boolean; until: number }>();
const checking = new Map<string, Promise<boolean>>();

function remember(apiKey: string, live: boolean, ttl: number, rejected = false) {
  health.delete(apiKey);
  if (health.size >= MAX_HEALTH) health.delete(health.keys().next().value!);
  health.set(apiKey, { live, rejected, until: Date.now() + ttl });
}

function cached(apiKey: string) {
  const entry = health.get(apiKey);
  return entry && entry.until > Date.now() ? entry : undefined;
}

/** Whether TypeSafe accepts the key right now. Cached; concurrent checks share one call. */
async function keyLive(apiKey: string): Promise<boolean> {
  const hit = cached(apiKey);
  if (hit) return hit.live;
  let pending = checking.get(apiKey);
  if (!pending) {
    pending = verifyJevKey(apiKey, CHECK_TIMEOUT_MS)
      .then(() => true)
      .catch((err: unknown) => {
        const rejected = err instanceof AuthenticationError || err instanceof PermissionDeniedError;
        remember(apiKey, false, rejected ? REJECTED_TTL_MS : UNSURE_TTL_MS, rejected);
        return false;
      })
      .finally(() => checking.delete(apiKey));
    checking.set(apiKey, pending);
  }
  return pending;
}

function keyFor(session: Pick<MailSession, "jevKey"> | null): { key: string; source: Exclude<JevSource, "kage"> } | null {
  if (session?.jevKey) return { key: session.jevKey, source: "user" };
  const key = serverKey();
  return key ? { key, source: "server" } : null;
}

/** The raw TypeSafe client, for diagnostics that must talk to Jev itself. */
export function typesafeFor(session: Pick<MailSession, "jevKey"> | null): TypeSafeAccess | null {
  const found = keyFor(session);
  if (!found) return null;
  if (found.source === "user") return { client: clientForKey(found.key), source: "user" };
  serverClient ??= createClient(found.key);
  return { client: serverClient, source: "server" };
}

/**
 * The engine this request may use. A key the user saved in Settings wins over
 * the deployment's TYPESAFE_API_KEY, and a failed Jev call is answered by Kage.
 * With no key, or a key TypeSafe recently rejected, Kage answers alone; with
 * KAGE=off too, callers use heuristics.
 */
export function jevFor(session: Pick<MailSession, "jevKey"> | null): Jev | null {
  const found = keyFor(session);
  const rejected = found ? cached(found.key)?.rejected === true : false;
  const typesafe = rejected && kageEnabled() ? null : typesafeFor(session);
  if (typesafe) return { client: withKageFallback(typesafe.client), source: typesafe.source };
  return kageEnabled() ? { client: kage, source: "kage" } : null;
}

/** Which engine Ask and Deep triage run on, for labels and live dots. */
export type DecisionEngine = "jev" | "kage";

/** Checks the key with TypeSafe (cached), so a dead key reads "kage", not "jev". */
export async function decisionEngine(session: Pick<MailSession, "jevKey"> | null): Promise<DecisionEngine | null> {
  const found = keyFor(session);
  if (found && (await keyLive(found.key))) return "jev";
  // A dead key with KAGE=off still runs Jev's path, which ends in heuristics.
  if (found && !kageEnabled()) return "jev";
  return kageEnabled() ? "kage" : null;
}

/**
 * What the UI may know about the key: never the key, only its last four
 * characters. `live` is false when TypeSafe didn't accept it at the last check.
 */
export type JevStatus = { source: Exclude<JevSource, "kage"> | null; hint: string | null; kage: boolean; live: boolean };

export async function jevStatus(session: Pick<MailSession, "jevKey"> | null): Promise<JevStatus> {
  const kage = kageEnabled();
  const found = keyFor(session);
  if (!found) return { source: null, hint: null, kage, live: false };
  const live = await keyLive(found.key);
  return { source: found.source, hint: found.source === "user" ? found.key.slice(-4) : null, kage, live };
}
