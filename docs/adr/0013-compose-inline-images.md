# 0013. Compose holds inline images as cid attachments

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/inline-images.ts`, `lib/mail/smtp.ts`

## Context

Pasted and dropped images have to travel as real MIME parts (`multipart/related`), not as megabytes of `data:` URLs in the editor. Drafts saved by Raven or by other clients come back from the server with `data:` images. Raven also runs on plain-http self-hosted installs.

## Decision

- The editor's HTML only ever holds `<img src="cid:…">`. The bytes sit with the other attachments, marked by the same `cid`. nodemailer files each one beside the HTML as `multipart/related`.
- Only image types that mail clients show inline are inline. Anything else is a normal attachment.
- Content-IDs come from `crypto.getRandomValues`, because `randomUUID` is missing on plain-http installs (no secure context).
- **Reopening a draft:** each `data:` image becomes a `cid:` image plus its bytes. The `alt` (the filename) and `width` stay. `data:` images of other types are dropped, so none stays in the HTML. The HTML can be many megabytes, so it is walked once. Another client's draft may use an `alt` that describes the picture ("Team photo") rather than a filename, and that is handled.
- **Tags are matched with a regex,** not an HTML parser. That is safe only because the editor writes these tags itself: attributes are double-quoted, and every `alt` goes through `plainName`, so no value holds a `>` or a quote.
- **Undo:** the outgoing body drops images whose bytes are gone, and the outgoing files drop inline images deleted from the body. Compose keeps its own copies, so undo can bring a deleted image back. The size allowance counts only what would be sent now, so a pasted then deleted image doesn't use it up.
- **Clipboard quirks:** a clipboard can hand over an empty image, which is ignored. Every clipboard screenshot arrives as `image.png`, so it is renamed with the time it was pasted.

## Consequences

If anything other than the editor ever writes these `<img>` tags, the regex matching stops being safe.
