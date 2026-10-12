import "server-only";
import type { FetchMessageObject, ImapFlow } from "imapflow";
import { pickTextPart, previewFromPart, type TextPartRef } from "@/lib/mail/mime";

const PREVIEW_BYTES = 1536;
const CACHE_LIMIT = 5000;

// uidValidity-scoped keys: a UID never means a different message within one scope.
const cache = new Map<string, string>();

function remember(key: string, value: string) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * Fetches only the first ~1.5KB of each message's best text part, grouped by
 * section so a page of 50 costs a couple of FETCHes instead of 50 full sources.
 * `scope` = session key + folder + uidValidity.
 */
export async function fetchPreviews(
  client: ImapFlow,
  scope: string,
  messages: FetchMessageObject[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const parts = new Map<number, TextPartRef>();
  const groups = new Map<string, number[]>();

  for (const msg of messages) {
    const cached = cache.get(`${scope}:${msg.uid}`);
    if (cached !== undefined) {
      out.set(msg.uid, cached);
      continue;
    }
    const part = pickTextPart(msg.bodyStructure);
    if (!part) {
      out.set(msg.uid, "");
      continue;
    }
    parts.set(msg.uid, part);
    const uids = groups.get(part.key) ?? [];
    uids.push(msg.uid);
    groups.set(part.key, uids);
  }

  for (const [key, uids] of groups) {
    let fetched: FetchMessageObject[] = [];
    try {
      fetched = await client.fetchAll(
        uids,
        { uid: true, bodyParts: [{ key, maxLength: PREVIEW_BYTES }] },
        { uid: true, binary: true },
      );
    } catch {
      continue; // previews are decoration; the list must still render
    }
    const mapKey = key.toLowerCase();
    for (const msg of fetched) {
      const part = parts.get(msg.uid);
      const raw = msg.bodyParts?.get(mapKey);
      if (!part || !raw) continue;
      const text = previewFromPart(raw, part, msg.binaryParts?.has(mapKey) ?? false);
      out.set(msg.uid, text);
      remember(`${scope}:${msg.uid}`, text);
    }
  }
  return out;
}
