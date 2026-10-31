# Contributing to Raven

Thanks for helping. Raven is a small project with one maintainer, so clear issues and focused pull requests go a long way.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. Found a security bug? Don't open an issue. Follow [SECURITY.md](SECURITY.md) instead.

## Set up

You need [bun](https://bun.sh).

```bash
bun install
cp .env.example .env.local
# set SESSION_SECRET (openssl rand -base64 32)
bun run dev
```

Open http://localhost:3000/login and click **Continue in dev mode**. It opens a seeded mailbox with 45 days of realistic mail, so you don't need a real account to work on Raven.

### Integrations (optional)

Slack, Discord, webhooks and mailbox export store their data in Postgres. Everything else runs with no database. To work on integrations, create a [Neon](https://neon.tech) database (the free tier works), put `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `.env.local` (`neon env pull` writes both), then run:

```bash
bun run db:migrate
```

If you change `lib/db/schema.ts`, run `bun run db:generate` and commit the new migration.

### Desktop app (optional)

The desktop app lives in `desktop/` and has its own packages. Run `bun run desktop:setup` once, then `bun run desktop:dev`. Stop your own `next dev` first, because Next.js allows only one per project. The desktop app keeps its data in a database built into the app (PGlite), so it doesn't need `DATABASE_URL`, and new migrations apply there on their own. See [`desktop/README.md`](desktop/README.md).

## House rules

- **Changelog.** Every user-visible change gets a plain-English entry under `## [Unreleased]` in `CHANGELOG.md`. It ships inside the app as the What's New card, so write it for users, not for developers.
- **Releases.** Only maintainers cut releases, with `bun run bump`. Don't change the version in `package.json` yourself.
- **No `src/` directory.** `app/`, `lib/` and `components/` live at the repo root. The `@/*` import alias points to `./*`.
- **Read the Next.js docs in the repo.** Raven runs on Next.js 16, which has breaking changes from older versions. Before you use a Next API, read the matching guide in `node_modules/next/dist/docs/` (see [AGENTS.md](AGENTS.md)).
- **Keep it private.** Mail credentials must never reach a database, a log or a third party. See "Privacy & security model" in the [README](README.md).

## Before you open a pull request

Run these and make sure they all pass:

```bash
bun run lint
bun run typecheck
bun test
bun run check:payload
bun run build
```

`bun run test:unit` and `bun run test:dom` run each half of the suite on its own if you want a faster loop.

Then:

- Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages and the PR title: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:` and so on.
- Keep each PR to one change. Small PRs get reviewed faster.
- For UI changes, add screenshots in both themes: **Ember** (light) and **Nebula** (dark). The sun/moon button in the rail switches between them.
- If you add an environment variable, add it to `.env.example` with a short comment.
- Never commit secrets, real email addresses or real mail.

## License

Raven is licensed under [AGPL-3.0-or-later](LICENSE). By sending a contribution, you agree that it is licensed under the same terms. There is no CLA to sign.
