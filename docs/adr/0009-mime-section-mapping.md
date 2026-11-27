# 0009. Attachment sections come from BODYSTRUCTURE, not from mailparser

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/mime.ts`, `lib/mail/mime.test.ts`

## Context

To download one attachment, Raven needs its IMAP section number. mailparser has its own `partId`, but it miscounts sibling multiparts. mailparser also retypes `application/octet-stream` parts by file extension. imapflow nests a whole attached message under its `message/rfc822` node, and mailparser only unpacks one when it is inline.

## Decision

- `mime.ts` works on a structural type, not imapflow's own, so tests and client-safe code can import it.
- Leaves are listed in document order. An attached message counts as one leaf.
- Each parsed attachment is matched to a BODYSTRUCTURE leaf by walking both lists forward: same type and filename first, then filename alone (because of the retyping), then type alone. A part that nothing matches gets no section, rather than shifting every part after it.
- A single-part body is section `"1"` (RFC 3501). `BINARY[]` rejects `TEXT`.
- `cid:`-referenced images are part of the body, not attachments.

## Consequences

The mime tests pin the nesting and retyping cases. Run them after any imapflow or mailparser upgrade.

Known gap: `attachmentBytes` sums transfer-encoded sizes, so base64 parts count about a third too big in storage stats. Tracked in [#48](https://github.com/kleenpulse/raven-mail/issues/48).
