# Architecture decision records

Raven's code has no comments (see [0001](0001-no-code-comments.md)). When a piece of code does something for a reason you can't see from the code itself, the reason lives here.

## How to find the reason for a file

Search this folder for the file's path. Every ADR starts with an **Applies to** line:

```sh
git grep -n "lib/mail/imap.ts" -- docs/adr
```

## How to write one

1. Copy [0000-template.md](0000-template.md) to the next free number: `NNNN-kebab-slug.md`.
2. One ADR holds one decision. Name the decision in the title, not the file.
3. Keep the numbers, the provider quirks and the "what breaks if you undo this" part. Leave out anything the code already says.
4. Add a row to the index below.
5. When a decision changes, don't rewrite history. Mark the old ADR `Superseded by NNNN` and write a new one.

## Index

| ADR | Decision | Applies to |
|---|---|---|
| [0001](0001-no-code-comments.md) | No code comments: decisions go in ADRs, hacks go in issues | all linted JS/TS, `lint/no-comments.mjs`, `eslint-suppressions.json` |
| [0002](0002-mail-renders-in-sandboxed-srcdoc-frame.md) | Mail HTML renders in a sandboxed srcdoc frame | `lib/mail/sanitize.ts`, `lib/mail/headers.ts`, `components/mail/email-frame.tsx` |
| [0003](0003-attachment-safety-and-download-headers.md) | Active attachment types never render; filenames are encoded strictly | `lib/mail/attachment.ts` |
| [0004](0004-attachment-bytes-cached-in-memory.md) | Attachment bytes are cached in memory, server and browser | `lib/mail/attachment-cache.ts`, `lib/mail/preview-cache.ts`, `lib/mail/imap.ts` |
| [0005](0005-imap-connection-budget.md) | IMAP work runs inside a per-mailbox connection budget | `lib/mail/imap.ts`, IMAP tests |
| [0006](0006-tls-required-before-login.md) | IMAP and SMTP must have TLS before the password is sent | `lib/mail/imap.ts`, `lib/mail/smtp.ts` |
| [0007](0007-uids-uidvalidity-and-paging.md) | Lists page by UID; UID keys are scoped by UIDVALIDITY | `lib/mail/imap.ts`, `lib/mail/cache-pages.ts`, `lib/mail/arrivals.ts`, `lib/mail/preview.ts` |
| [0008](0008-bodies-previews-and-preload-budgets.md) | Bodies: peek, partial previews, budgeted preload | `lib/mail/preview.ts`, `lib/mail/preload.ts`, `lib/mail/mime.ts`, `lib/mail/snapshot.ts` |
| [0009](0009-mime-section-mapping.md) | Attachment sections come from BODYSTRUCTURE, not mailparser | `lib/mail/mime.ts` |
| [0010](0010-imap-search-folders-and-snapshot.md) | Search, the folder index, and the shared snapshot | `lib/mail/imap.ts`, `lib/mail/snapshot.ts` |
| [0011](0011-conversation-threading.md) | Conversation threading and whole-thread actions | `lib/mail/thread.ts`, `lib/mail/imap.ts`, `lib/mail/deferred-actions.ts` |
| [0012](0012-undo-windows-for-send-and-mail-actions.md) | Sends and mail actions wait out an undo window | `lib/mail/pending-send.ts`, `lib/mail/deferred-actions.ts`, `hooks/use-undo-send.ts` |
| [0013](0013-compose-inline-images.md) | Compose holds inline images as cid attachments | `lib/mail/inline-images.ts`, `lib/mail/smtp.ts` |
| [0014](0014-compose-text-quote-and-signature.md) | Compose text, the quote, and the signature | `lib/mail/rich-text.ts`, `lib/mail/reply.ts`, `lib/mail/signature.ts` |
| [0015](0015-smtp-sending-and-size-limits.md) | Sending: headers, the Sent copy, size limits per host | `lib/mail/smtp.ts`, `lib/mail/send-limits.ts`, `next.config.ts` |
| [0016](0016-reply-all-recipients.md) | Who reply and reply-all go to | `lib/mail/reply.ts` |
| [0017](0017-list-unsubscribe.md) | Unsubscribe: what the button may do, and how safely | `lib/mail/headers.ts`, `lib/mail/unsubscribe.ts` |
| [0018](0018-dev-mailbox-simulates-a-real-server.md) | The dev mailbox behaves like a real server, with pinned numbers | `lib/mail/dev-store.ts`, `lib/mail/dev-seed.ts`, `lib/mail/dev-fixtures.ts` |
| [0019](0019-pure-mail-modules.md) | Mail logic lives in pure modules | `lib/mail/*` pure modules |
| [0020](0020-small-mail-decisions.md) | Small mail decisions (contacts, layout cookie, offline check, not junk, split inbox) | `lib/mail/contacts.ts`, `lib/mail/reader-layout.ts`, `lib/mail/reach.ts`, `lib/mail/split-inbox.ts` |
| [0021](0021-bun-test-pending-promise-after-abort.md) | Tests don't use `.rejects` on a promise pending after an abort | `lib/mail/imap-connect.test.ts` |
