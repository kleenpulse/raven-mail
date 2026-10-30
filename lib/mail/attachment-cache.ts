import "server-only";

/**
 * Attachment bytes the server already holds from reading a message.
 *
 * Opening a message fetches its whole source, attachments included, but a
 * click on a file used to fetch that part again over a fresh IMAP connection:
 * connect, sign in, open the folder, FETCH, about 5 s on a slow link. Keeping
 * the decoded parts for a few minutes serves that click from memory.
 *
 * Keyed by mailbox (see sessionKey) so one account never reads another's
 * files. Per process: on serverless a click can land on an instance that never
 * read the message, and then it downloads as before. Lives on globalThis so
 * the message and attachment routes share one store even if bundled apart.
 */

export type CachedAttachment = {
  bytes: Uint8Array;
  filename?: string;
  contentType?: string;
  charset?: string;
};

type Entry = CachedAttachment & { owner: string; expiresAt: number };

export const ATTACHMENT_TTL_MS = 5 * 60_000;
/** Bigger files download as before rather than crowd out everything else. */
export const ATTACHMENT_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const ATTACHMENT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

type Store = { entries: Map<string, Entry>; bytes: number };
const STORE = Symbol.for("raven.attachmentCache");

function store(): Store {
  const g = globalThis as typeof globalThis & { [STORE]?: Store };
  return (g[STORE] ??= { entries: new Map(), bytes: 0 });
}

const keyOf = (owner: string, folder: string, uid: string, part: string) => [owner, folder, uid, part].join("\0");

function drop(s: Store, key: string) {
  const entry = s.entries.get(key);
  if (!entry) return;
  s.entries.delete(key);
  s.bytes -= entry.bytes.byteLength;
}

function sweep(s: Store, now: number) {
  for (const [key, entry] of s.entries) {
    if (entry.expiresAt <= now) drop(s, key);
  }
}

export function rememberAttachment(
  owner: string,
  folder: string,
  uid: string,
  part: string,
  file: CachedAttachment,
  now = Date.now(),
): void {
  if (file.bytes.byteLength > ATTACHMENT_MAX_FILE_BYTES) return;
  const s = store();
  const key = keyOf(owner, folder, uid, part);
  drop(s, key);
  sweep(s, now);
  // Map order is insertion order: the first entries are the least recently used.
  for (const oldest of s.entries.keys()) {
    if (s.bytes + file.bytes.byteLength <= ATTACHMENT_MAX_TOTAL_BYTES) break;
    drop(s, oldest);
  }
  // A copy, so a small part never pins the whole message source it was sliced from.
  const bytes = new Uint8Array(file.bytes);
  s.entries.set(key, { ...file, bytes, owner, expiresAt: now + ATTACHMENT_TTL_MS });
  s.bytes += bytes.byteLength;
}

export function recallAttachment(
  owner: string,
  folder: string,
  uid: string,
  part: string,
  now = Date.now(),
): CachedAttachment | undefined {
  const s = store();
  const key = keyOf(owner, folder, uid, part);
  const entry = s.entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    drop(s, key);
    return undefined;
  }
  s.entries.delete(key);
  s.entries.set(key, entry);
  const { bytes, filename, contentType, charset } = entry;
  return { bytes, filename, contentType, charset };
}

/** At sign-out: nothing of that mailbox stays in memory. */
export function forgetAttachments(owner: string): void {
  const s = store();
  for (const [key, entry] of s.entries) {
    if (entry.owner === owner) drop(s, key);
  }
}

/** For tests. */
export function clearAttachmentCache(): void {
  const s = store();
  s.entries.clear();
  s.bytes = 0;
}
