# 0005. IMAP work runs inside a per-mailbox connection budget

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/imap.ts`, `lib/mail/imap-connect.test.ts`, `lib/mail/imap-download.test.ts`, `lib/mail/imap-thread.test.ts`

## Context

Gmail allows about 15 concurrent IMAP connections per account. Most connects to Gmail answer in 1 to 3 s, but now and then a handshake hangs for 20 s or more. imapflow can't cancel a command that is already running, and a SEARCH on a huge unindexed folder can take a very long time.

## Decision

- **Connection cap:** each mailbox gets 4 connections (`createKeyedSemaphore(4)`), well under Gmail's limit. Downloads hold a connection for the whole stream, so at most 2 run at once, which keeps slots free for the list, poll, reader and send.
- **Slots are always released.** A client counted against the cap must call `release()`, even when a request fails. Tests send more failing requests than there are slots, because a leaked slot would hang the last ones. A test also checks that two of the four slots stay free while downloads run.
- **Connect timeout and one retry:** a connect that hangs or drops before sign-in is given up early and tried once more on a fresh socket, which usually answers. An `ImapFlow` can't connect twice, so the retry gets a new client. A rejected login never counts as a hang. Diagnostics connect by hand to time each phase and never retry, so they report the network as it is.
- **Cancel by closing the socket:** a `signal` closes the socket. The slow command rejects and the slot frees. Answers found so far come back, and the unfinished ones are just missing.
- **Bounded searches:** reply checks and thread lookups use SINCE, so a big folder isn't scanned end to end. A bulk body fetch asks for sizes first, so an oversized message is never downloaded.

## Consequences

Any new IMAP call has to take a slot through the shared helpers and honour `signal`. If you raise the caps, check them against the provider's own limit.
