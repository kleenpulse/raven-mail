# 0018. The dev mailbox behaves like a real IMAP server, with pinned numbers

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/dev-store.ts`, `lib/mail/dev-seed.ts`, `lib/mail/dev-seed.test.ts`, `lib/mail/dev-fixtures.ts`, `lib/mail/dev-store.test.ts`, `lib/mail/envelope-row.ts`

## Context

The dev login, the tests and the public landing demo all run on a synthetic mailbox with no mail server. If it behaves differently from IMAP, bugs hide in dev. The Overview counts ("needs reply", "waiting on") have to show stable numbers in demos and tests, whatever day or hour the server boots.

## Decision

**It acts like a server.**
- Section numbers follow a `multipart/mixed` message: the body is part 1.
- Messages carry a server thread id like Gmail's `X-GM-THRID`, so dev runs that path too.
- A move appends the new copy first, then drops the old one, as IMAP does.
- Mail to yourself lands in the Inbox too. It is the only way new mail arrives.
- Search, paging, threading and cid images follow the same rules as real mail (ADRs 0007, 0010, 0011, 0002).
- The store lives on `globalThis` across HMR. Its key is versioned, so a running dev server picks up a new seed.

**Seeds cover edge cases.** Each hand seed exists for one case: a designed newsletter with its own colours and a tracking-style remote image (the reader's paper look and the "Load images" banner), unsubscribe by one-click, by link only and by mailto only, a Gmail-style thread whose first message is past page one, a headerless phone reply, two same-subject receipts that must not join, and a thread with an archived middle message.

**Attachments open for real.** PDF, PNG, calendar and text fixtures are real files. The PDF has real xref offsets, and `startxref` points at the xref table, so viewers open it without repair. Other types (docx, zip) only get a short text body for now. That gap is tracked in [#50](https://github.com/kleenpulse/raven-mail/issues/50).

**The synthetic mailbox is deterministic.** `dev-seed.ts` builds 45 days of mail. The same `(now, seed)` gives deep-equal output on one machine. Hours follow the machine's local time zone, so heatmaps look right in dev, and the tests use local-time anchors.
- Per-contact reply times are lognormal around `medianHours`, so the medians land near the roster values. List opens are spread evenly, so each list hits its open rate exactly.
- **Obligation counts are pinned.** Exactly `NEEDS_REPLY_TOTAL` unanswered asks to me sit in the 14-day needs-reply window. A margin keeps the boundary from flipping a count. Sent mail younger than the "waiting on" rule's 48 h floor never reads as waiting, and "waiting on" is limited to the `GHOSTS`. Other threads that end inside the window get a recent reply from me if that day's Sent range allows, or become a cc-only hand-off. Scheduled mail claims each day's Inbox and Sent room first. Non-human Sent mail (a team alias, Linear reply-by-email, RSVPs to machine addresses) fills part of each day's Sent range and can never read as waiting.
- The storage ring shows a believable Gmail-sized quota.

## Consequences

When you change a triage or Overview rule, re-check the pinned counts in `dev-seed.test.ts`. The 30-day slice the dashboard reads is pinned at no more than 480 messages.
