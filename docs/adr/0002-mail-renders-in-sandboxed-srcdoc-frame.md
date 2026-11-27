# 0002. Mail HTML renders in a sandboxed srcdoc frame

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/sanitize.ts`, `lib/mail/headers.ts` (`isAbsoluteMailLink`), `lib/mail/imap.ts` (cid inlining), `lib/mail/mime.ts`, `lib/mail/dev-store.ts`, `components/mail/email-frame.tsx`

## Context

Mail bodies are hostile HTML. They also need to look the way the sender designed them. The body renders in its own document: an iframe with `srcdoc`, sandboxed without `allow-scripts`, behind a CSP that blocks remote fetches until the reader opts in.

A srcdoc frame has two side effects:

- Relative links (`#`, `unsubscribe`, an unfilled `*|UNSUB|*`) resolve against Raven's own URL. A newsletter's "Unsubscribe" opened a second Raven window.
- `cid:` image references can't resolve inside it.

## Decision

- The sanitizer keeps presentational markup (classes, inline styles, `<style>`) because the frame can't run scripts. It still strips scripts, event handlers, forms and embeds.
- Links must name their own destination. `isAbsoluteMailLink` decides, and the sanitizer drops relative hrefs.
- Small `cid:` images are inlined into the HTML as `data:` URLs, and they aren't listed as attachments. A cid-referenced image is part of the body. The dev mailbox does the same, so dev reads mail like production.

## Consequences

- If you loosen the sandbox or the CSP, the sanitizer rules have to be checked again, since they assume no scripts can run.
- Bodies cached before relative links were dropped can still hold some. The frame ignores clicks on them.
- Known gap: double-quoted CSS `url()` comes out of the sanitizer as `url(&quot;…&quot;)`, and `hasRemoteContent` misses it. The CSP still blocks the fetch, but the "Load images" banner doesn't show. Tracked in [#47](https://github.com/kleenpulse/raven-mail/issues/47).
