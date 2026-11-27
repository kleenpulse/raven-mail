# 0007. Lists page by UID, and everything keyed by UID is scoped by UIDVALIDITY

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/imap.ts`, `lib/mail/cache-pages.ts`, `lib/mail/arrivals.ts`, `lib/mail/preview.ts`, `lib/mail/dev-store.ts`, `lib/mail/dev-seed.ts`

## Context

IMAP UIDs only grow within a folder. A UID never means a different message while the folder's UIDVALIDITY stays the same. When the server renumbers a folder, UIDVALIDITY changes and every old UID is void.

## Decision

- **Paging:** a list page's cursor is `before`, the lowest UID the client already holds. The cache stores folder lists as pages keyed by that cursor. `count` is the whole folder (or all matches), and `before` only pages.
- **Newest first without SEARCH ALL:** the newest messages have the highest sequence numbers, so the first page is fetched by sequence range.
- **New mail:** the highest UID seen is enough to tell a new arrival from a row that was re-fetched. `null` means no baseline yet: the first look records one and reports nothing, so opening the app never pops a banner for mail that was already waiting. A UID below the mark means the folder was renumbered, so the baseline starts over.
- **Caches:** preview keys are scoped by session key + folder + UIDVALIDITY.
- **Deep links** carry the Message-ID, so a UIDVALIDITY reset can't strand them.
- **Rules** use the folder's UIDVALIDITY as part of the fingerprint for mail with no Message-ID.
- **UIDPLUS is optional.** Moves return the COPYUID map (old UID to new UID), and appends return APPENDUID. A server without UIDPLUS answers with an empty map: those moves can't be undone by UID, and after an append the caller has to search.
- **Dev mailbox:** UIDs and Message-IDs follow arrival order across both folders, so UIDs are unique store-wide and a move keeps its UID. Hand seeds and synthetic mail are renumbered by date, because paging relies on UIDs rising with arrival.

## Consequences

Never use a bare UID as a long-lived key. Pair it with UIDVALIDITY, or use the Message-ID.
