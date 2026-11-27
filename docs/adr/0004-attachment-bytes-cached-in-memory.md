# 0004. Attachment bytes are cached in memory, on the server and in the browser

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/attachment-cache.ts`, `lib/mail/preview-cache.ts`, `lib/mail/imap.ts` (`DOWNLOAD_CHUNK_BYTES`, message parsing, attachment streams)

## Context

Opening a message fetches its whole source, attachments included. A click on a file then used to fetch that part again over a fresh IMAP connection: connect, sign in, open the folder, FETCH. That took about 5 s on a slow link. Downloads were slow too: parts arrive base64-encoded (about 1.37x larger), and imapflow's 64 KB default window spent about 64 round trips on a 3 MB photo.

## Decision

- **Server cache** (`attachment-cache.ts`): after a message is parsed with an `owner`, its decoded attachment parts are kept for a few minutes, so a click skips the IMAP round trip.
  - It is keyed by mailbox (`sessionKey`), so one account never reads another's files. Sign-out drops everything for that mailbox.
  - It lives on `globalThis`, so the message route and the attachment route share one store even when bundled apart.
  - It is per process. On serverless a click can land on an instance that never read the message, and then it downloads as before.
  - Files over the size limit aren't cached, so they don't push out everything else. Each part is copied, so a small part never pins the whole message source it was sliced from. Eviction is least recently used, through `Map` insertion order.
- **Uncached downloads** stream through imapflow in `DOWNLOAD_CHUNK_BYTES` (1 MB) FETCH windows, which keeps most previews to one or two round trips. The connection and mailbox lock stay held until the stream ends, errors or is cancelled.
- **Browser cache** (`preview-cache.ts`): bytes fetched for a preview are kept, so reopening a file or stepping back in the gallery doesn't download it again.
  - The budget fits a few large photos, or one video at the preview limit plus some images. Oldest files go first. A file bigger than the whole budget isn't kept.
  - A click joins a download already running for the same file, such as a hover prefetch. A caller whose `signal` aborts stops waiting, but the download is cancelled only once nobody waits. A prefetch has no signal, so a viewer moving on never cancels it.
  - Memory only: a reload starts empty. Sign-out clears it, and bytes that land after the clear are dropped.

## Consequences

Neither cache ever writes attachment bytes to disk or `localStorage`. Memory use is bounded by the budgets, so raise them with care.
