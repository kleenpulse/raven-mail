# 0021. Tests don't use `expect(promise).rejects` on a promise still pending after an abort

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** `lib/mail/imap-connect.test.ts`, any test that aborts a request

## Context

In bun 1.4.4, `expect(pending).rejects` spins forever on a promise that is still pending after an abort. The test never ends.

## Decision

Tests that abort take the error with `await pending.catch((e) => e)` and assert on it, instead of using `.rejects`.

## Consequences

Re-check on each Bun upgrade. CI pins Bun 1.4.0 and local machines run newer versions, so test on both. If `.rejects` behaves, this ADR can be superseded.
