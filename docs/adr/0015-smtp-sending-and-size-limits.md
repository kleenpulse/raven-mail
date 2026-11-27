# 0015. Sending: headers, the Sent copy, and size limits per host

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/smtp.ts`, `lib/mail/send-limits.ts`, `next.config.ts`

## Context

Vercel rejects any function request over 4.5 MB before the Server Action runs. The usual SMTP cap is 25 MB. Gmail and Microsoft 365 file sent mail into Sent by themselves. A Bcc header must never reach recipients.

## Decision

- **Bcc:** `keepBcc` is for saved drafts only. Sent mail never carries the Bcc header.
- **Addresses** go to nodemailer as objects, not strings, so nodemailer encodes each name itself, commas and all.
- **Sent copy:** Raven skips its own APPEND to Sent for Gmail and Microsoft 365, since appending there creates duplicates.
- **Size limits** (`send-limits.ts`): one row per host. `body` is the Server Action request limit. `budget` is what compose allows for files (as base64), HTML and text together, kept a little under `body`.
  - `vercel`: body `4.5mb`, budget 4,200,000 bytes.
  - `selfHosted`: body `26mb`, budget 25,690,112 bytes. That allows 18 MiB of files, which is 24 MiB of base64 and about 24.6 MiB on the wire: under the usual 25 MB SMTP cap.
- `next.config.ts` imports `send-limits.ts`, picks a row and inlines its budget as `SEND_BUDGET_BYTES`. So `send-limits.ts` imports nothing.

## Consequences

Keep `send-limits.ts` free of imports. When a host's limit changes, change its row and nothing else.
