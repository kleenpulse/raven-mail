# 0016. Who reply and reply-all go to

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/reply.ts`

## Context

A naive reply-all copies every address on the message, including no-reply senders and yourself. Some messages are really to a group, and answering the group is the point.

## Decision

- Automated senders never read replies, so reply-all leaves them out, unless one is the sender you're answering.
- Replying to your own sent message goes back to its recipients, not to you.
- Addresses that fan out to many people (group and list addresses) count as the group.
- When the message went to a group address, or you were only Cc'd, the conversation belongs to the room, so reply-all is the button that leads (`preferReplyAll`).

## Consequences

Changes to the automated-sender or group-address checks change who gets mail. Test them with real header samples.
