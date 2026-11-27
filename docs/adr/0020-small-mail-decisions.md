# 0020. Small mail decisions

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/contacts.ts`, `lib/mail/reader-layout.ts`, `lib/mail/reach.ts`, `lib/mail/imap.ts` (not-junk), `lib/mail/split-inbox.ts`, `lib/mail/split-inbox.test.ts`

Each of these is too small for its own ADR, but each one would get "fixed" into a bug without a note.

## Contact suggestions

Suggestions come from the snapshot window, scored by how often and how recently an address appears. Each sighting decays over about a week. People you write to are the likeliest next recipients, and people copied alongside you count for a little. Mailing lists, no-reply and role addresses, and yourself are left out.

## Mail layout in a cookie

The list's width, and whether the reader has the whole pane, are stored in a cookie, not `localStorage`. The server then renders the saved layout, and a reload never flashes the default width first.

## Desktop offline check

`reach.ts` checks whether a TCP connection to the mail server opens within `timeoutMs`. It opens and closes a socket, nothing more: no TLS, no login. The desktop app uses it to tell "offline" from "the mail server said no".

## Not junk

Moving mail out of Junk first sets the RFC 5788 keywords, so they travel with the message. This is best effort: imapflow drops keywords the mailbox doesn't accept, and a failed keyword never blocks the move. The move out of Junk is itself the signal that Gmail, Outlook and Dovecot's antispam learn from.

## Split inbox kinds

A message's kind is its own, whichever tabs are on. When the Promotions tab is off, promotions fold into Important, but they still only notify as Promotions.
