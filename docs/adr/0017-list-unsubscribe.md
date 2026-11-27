# 0017. Unsubscribe: what the button may do, and how safely

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/headers.ts`, `lib/mail/unsubscribe.ts`, `lib/mail/imap.ts`

## Context

`List-Unsubscribe` can hold an https link, a `mailto:` link, or both. RFC 8058 adds a one-click POST. A POST from Raven's server to a URL a stranger picked is a request-forgery risk.

## Decision

- **What the button can do:** one-click needs an https target plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. With a link but no one-click, the button opens the page. With mailto only, it writes the email.
- **Reading the headers:** mailparser folds every `List-*` header into one `list` object, so the raw values are read back from its header lines (`{ key, line }`). The pair is always read fresh from the server, never trusted from the client.
- **`mailto:` parsing** follows RFC 6068: only `%XX` escapes are decoded, so a `+` is a literal plus and not a space as in form data.
- **The one-click POST** is a bare POST of `List-Unsubscribe=One-Click`: no cookies, no redirects followed, and private networks blocked at the socket. A 3xx counts as success, because senders often answer with a redirect to a "you're out" page.

## Consequences

The dev mailbox seeds each case (one-click, link only, mailto only). Keep them when you change this.
