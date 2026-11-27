# 0003. Attachments: active types never render, filenames are encoded strictly

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/attachment.ts`, `lib/mail/attachment.test.ts`

## Context

A blob URL shares the app's origin. If a browser ever ran an attached HTML, SVG or XML file as a document, it would run as Raven. Filenames come from strangers and end up in a `Content-Disposition` header and on disk.

## Decision

- **Active types** (anything a browser would run as a document if it ignored the disposition) are served as `application/octet-stream`. Passive files keep their declared type. Malformed types count as active.
- The preview picks its type from the message metadata, never from the download response, because the response serves active types as octet-stream. Active types preview as plain text: the user still sees the file, and nothing runs.
- Server files above a size limit download instead of previewing, because a preview holds the whole file in memory first.
- `Content-Disposition` follows RFC 6266: an ASCII fallback for old clients, then the exact name as RFC 5987 UTF-8. Characters that `encodeURIComponent` leaves but RFC 5987 `attr-char` forbids are escaped too. Control characters, path separators, and anything a header or shell would read are removed. The header is one quoted value then one token, so nothing escapes into a second parameter.
- Long names are cut in the stem, never the extension, so the saved file keeps its type.
- `btoa` runs over the bytes in chunks, so large files don't overflow the call stack.

## Consequences

Never trust a type from a download response for rendering. The attachment tests pin the header encoding, so a change there shows up as a failing test.
