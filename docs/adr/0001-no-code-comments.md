# 0001. No code comments: decisions go in ADRs, hacks go in issues

- **Status:** Accepted
- **Date:** 2026-11-27
- **Applies to:** every `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` file ESLint lints, `eslint.config.mjs`, `lint/no-comments.mjs`, `eslint-suppressions.json`

## Context

In November 2026 the repo had 3,227 comments in 574 files, about 5,450 lines. We read the ones in `lib/mail` (333 of them) and sorted them into four kinds:

- **Tautology**: says what the code already says. About 45%.
- **Decision record**: the only place a non-obvious reason lived (a provider quirk, a security rule, a number picked on purpose). About 53%.
- **Excuse**: lets a hack or a known bug sit there ("close enough", a parked `BUG:` note). 5 of them.
- **Stale**: points at things that are gone or changed (a plan task that never existed, a range the test never matched). 2 of them.

Tautologies cost reading time. Excuses hide work that should be tracked. Stale comments lie. The decision records were worth keeping, but a comment is a bad home for them: nobody reviews it when the code under it changes, so it drifts, and an agent copying nearby code copies the excuse too.

## Decision

- Code has no comments. The `local/no-comments` rule (`lint/no-comments.mjs`) reports every comment in JS/TS files.
- Tool directives are not comments and stay allowed: `eslint-disable*` / `eslint-enable`, block `eslint rule: …`, block `global` / `exported`, `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `@ts-check`, `#__PURE__` / `@__PURE__`, `webpack*` / `turbopack*` magic comments, and `/// <reference …>`. Give an `eslint-disable` a `-- reason`, and if the reason is a hack, file an issue for it.
- A decision record becomes an ADR in `docs/adr/`. One ADR holds one decision, and its **Applies to** line lists the files, so you can find the reason for a file from the index in `docs/adr/README.md`.
- An excuse becomes a GitHub issue labelled `tech-debt`, and the comment goes.
- Tautologies and stale comments are deleted.
- Vendored code is exempt: `components/ui/**` (shadcn) and `components/motion-garden/**` (copied from shadow-garden). Its comments belong to upstream, and keeping them makes the copy easy to diff.

### The ratchet

We don't delete every comment in one PR. ESLint's bulk suppressions hold the rest:

- `eslint-suppressions.json` stores how many `local/no-comments` errors each file is allowed. It was seeded with `bun run lint --suppress-rule local/no-comments`.
- `bun run lint` (and CI) fails if a file has more comments than its count.
- It also fails if a file has fewer, with "There are suppressions left that do not occur anymore". Run `bun run lint:prune` and commit the smaller file. So the count can only go down.
- Each later PR clears one area with the `/delete-comment` skill and prunes the file.

## Consequences

- The reason for a piece of code is one hop away (the ADR index) and not next to it. In exchange, ADRs get reviewed as documents, and code review no longer has to check that comments still match.
- Names, types, small functions and tests have to carry the meaning that comments used to carry.
- The ratchet counts per file, so swapping one comment for another in the same file passes. Review still matters.
- New directive kinds need a change to the allowlist in `lint/no-comments.mjs` and its test.
