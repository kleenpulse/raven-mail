# 0011. Conversation threading and whole-thread actions

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/thread.ts`, `lib/mail/imap.ts` (`getThread`, thread UIDs), `lib/mail/deferred-actions.ts`, `lib/mail/dev-store.ts`

## Context

Gmail and RFC 8474 servers give each message a thread id. Others only have headers, and some replies (phone clients) lose their headers. A list only loads one page, but a thread's first message can sit past it.

## Decision

- **Grouping has three tiers, strongest first:**
  1. The server's thread id (Gmail `X-GM-THRID`, RFC 8474 `THREADID`). It is only asked of servers that have one.
  2. The header chain: Message-ID to In-Reply-To to every References entry.
  3. A guarded subject match for replies with no headers. It joins only when the message says it is a reply, both share a person besides you, and they are within a month of each other. Same sender and same subject without a reply prefix (two receipts) never join.
- Grouping is pure and client-safe, so the list and the shell's j/k group the same way.
- **The thread view** searches the message's folder plus Sent (or Inbox plus Sent when opened from Sent), one SEARCH per folder on one connection. Servers with a thread id answer exactly. Others match the header chain, bounded by SINCE. The oldest come first and the newest `THREAD_LIMIT` are kept. A copy in the asked folder beats one elsewhere (mail to yourself).
- **Whole-thread actions** (archive, trash, read) act on every message of the thread in the folder, loaded or not, through the server thread ids of the rows acted on. Undo restores the rows that showed.

## Consequences

The dev mailbox seeds each tier (a Gmail-style thread whose first message is past page one, a headerless phone reply, two same-subject receipts, a thread with an archived middle message). Keep those seeds when you change grouping.
