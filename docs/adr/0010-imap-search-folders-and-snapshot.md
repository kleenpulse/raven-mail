# 0010. Search, the folder index, and the shared mailbox snapshot

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/imap.ts`, `lib/mail/snapshot.ts`, `lib/mail/dev-store.ts`

## Context

imapflow can't AND repeated `or` / `text` keys in one SEARCH. IMAP SEARCH is substring matching and can't do fuzzy matching. Mutations need special-use folder paths (Trash, Archive) often. Several features read the same 30-day mailbox snapshot, often at the same moment.

## Decision

- **Term-wise search:** one SEARCH per term, and the UID sets are combined in Raven with the same acceptance rule as `searchText` (`acceptTerms`). SEARCH is already substring, so prefixes match while the user types. The dev store uses the same rule (every token, else any token) plus prefix and typo tiers, ordered by date.
- **Folder index for mutations** uses LIST only, cached, with no STATUS per folder.
- **Snapshot cache:** a TTL cache (90 s, 20 entries) shared by every snapshot caller (the Overview, Ask Jev, triage, contacts, the rules run). Parallel callers share one in-flight IMAP pass.
- **Gmail labels** can list one message twice. The snapshot keeps the first copy.

## Consequences

A new feature that needs recent mail should read the snapshot, not open its own IMAP pass.
