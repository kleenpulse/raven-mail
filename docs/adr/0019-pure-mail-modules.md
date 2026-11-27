# 0019. Mail logic lives in pure modules

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/mime.ts`, `lib/mail/split-inbox.ts`, `lib/mail/attachment.ts`, `lib/mail/envelope-row.ts`, `lib/mail/thread.ts`, `lib/mail/rich-text.ts`, `lib/mail/inline-images.ts`, `lib/mail/pending-send.ts`, `lib/mail/deferred-actions.ts`, `lib/mail/dev-seed.ts`

## Context

The same mail rules run on the server, in the browser (the list, the shell's j/k), in the public landing demo, and in tests. A module that imports imapflow, Next.js or React can't run in all of those places.

## Decision

These modules import no server-only code, no framework and no imapflow types. They use structural types instead, so tests pin the rules without an editor, a browser or a mail server, and every caller splits, groups and encodes the same way.

## Consequences

Keep new rules in a pure module and call it from the server or UI code. Don't pull server imports into these files.
