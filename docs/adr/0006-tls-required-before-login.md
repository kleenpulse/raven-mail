# 0006. IMAP and SMTP must have TLS before the password is sent

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/imap.ts`, `lib/mail/smtp.ts`

## Context

On non-TLS ports (IMAP 143, SMTP 587) the client upgrades with STARTTLS. An attacker on the path can strip the STARTTLS offer. A client that carries on without it sends the password in clear.

## Decision

- IMAP on a non-TLS port sets `doSTARTTLS: true`, so a missing STARTTLS is a failure and not a fallback.
- SMTP on a non-TLS port (587) sets nodemailer's `requireTLS`, so a stripped STARTTLS fails the send instead of leaking the password.
- Loopback hosts are exempt (`isLoopbackHost`), so a local test server without TLS still works.

## Consequences

A remote server that offers no TLS at all can't be used. That is on purpose.
