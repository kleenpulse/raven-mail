# 0008. Message bodies: peek, partial previews, and a budgeted preload

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/imap.ts`, `lib/mail/preview.ts`, `lib/mail/mime.ts`, `lib/mail/preload.ts`, `lib/mail/snapshot.ts`

## Context

A list shows 50 rows with a line of preview text each. Fetching 50 full sources for that is far too slow. Opening a message should feel instant, but downloading every body in a folder wastes the connection budget (ADR 0005).

## Decision

- **Reading never marks mail read.** Message fetches use `BODY.PEEK[]`, so reading a message never sets `\Seen` by itself. `bodyStructure` comes along, so each attachment has its section number for download.
- **Previews from a partial fetch:** only the first ~1.5 KB of each message's best text part is fetched, grouped by section, so a page of 50 costs a couple of FETCHes. The slice can be cut mid-sequence: it is decoded as truncated transfer-encoded text, and a cut multi-byte character (which decodes to U+FFFD at the tail) is dropped. Previews are decoration, so a failure never stops the list from rendering. The Overview snapshot uses the same grouped partial FETCHes for the Daily Brief and the "expects a reply?" check.
- **Preload** warms the cache with the bodies of the rows in view:
  - One request at a time, and the visible set has to hold still for `settleMs` first, so rows flicked past are never fetched.
  - One request carries at most about a tall screen of UIDs.
  - Messages above a raw RFC822 size (attachments, heavy inline images) load on open instead.
  - The first eligible message is always taken, so every request makes progress. A reply that settles nothing would ask for the same rows forever, so that case is handled.
  - A failing mail server gets a growing pause, not a request on every scroll.

## Consequences

If you change the preview size or the preload limits, measure on a slow link with a big folder.
