# 0012. Sends and mail actions wait out an undo window

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/pending-send.ts`, `lib/mail/deferred-actions.ts`, `lib/mail/deferred-actions.test.ts`, `hooks/use-undo-send.ts`

## Context

People want to undo a send or an archive for a few seconds. IMAP and SMTP can't take an action back, so the only real undo is to wait before acting. Tabs close, and pages get hidden on mobile.

## Decision

- **Undo send** (`pending-send.ts`): the queue owns timing only. The caller saves each entry and shows the countdown.
  - Because entries are saved, a tab that closes before its send finished brings the message back unsent on the next load. A record whose lock nobody holds belongs to such a tab. The newest one comes back, and the rest stay (live tabs' records, and older orphans for the next load).
  - `pending()` counts sends that are waiting or on the wire. While it is above zero, leaving the page would lose or cut one off, so `hooks/use-undo-send.ts` guards `beforeunload`.
- **Undo for archive, trash, move to Inbox and delete forever** (`deferred-actions.ts`): rows leave every cached list of the folder at once. The server call runs when the window ends, or right away when the page is hidden. On `pagehide` everything commits at once, because the request must outlive the page. Undo puts rows back at their old index, in ascending order, so each lands where it was.
- Both modules are framework-free, so the timing and cache logic can be tested directly. Tests drain any pending batch, because a batch left pending would commit into the next test.

## Consequences

An action is not on the server until its window ends. Code that reads the server right after an action has to allow for that.
