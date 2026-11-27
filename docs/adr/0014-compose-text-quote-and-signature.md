# 0014. Compose text: HTML plus plain text, the quote kept apart, the signature above it

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/rich-text.ts`, `lib/mail/reply.ts`, `lib/mail/signature.ts`, `lib/mail/types.ts`

## Context

Mail should go out as `multipart/alternative`: the editor's HTML and a plain text part. Quoted originals clutter the text box. Signatures need a standard marker, so other clients can fold them.

## Decision

- Compose always kept plain text. The editor's HTML goes alongside it. `rich-text.ts` is pure, so the text part is tested without an editor.
- Plain text becomes one paragraph per line, so the editor's text reads back exactly as it went in. The empty paragraph the editor keeps after a list or quote isn't part of the message.
- **The quote stays apart until send.** The draft keeps the original being replied to or forwarded out of `text`. `draftBody` builds what leaves: what you wrote, then the quote (`> ` lines for replies, a header block for forwards).
- **Signature:** it starts with the `-- ` line (RFC 3676 §4.3). It goes at the end of the starting text, so it sits above the quoted original, and it is never added twice.
- **Reopening a draft:** saving fills an empty subject with a placeholder, which is not handed back as typed text. The saved HTML is parsed through the editor's own schema (inert, no scripts), so the formatting stays.

## Consequences

Anything that changes the editor's paragraph model must keep the round trip in `rich-text.ts` exact.
