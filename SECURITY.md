# Security policy

Raven handles mail credentials, so security reports matter a lot. Thank you for taking the time.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting:

1. Go to the repo's **Security** tab.
2. Click **Report a vulnerability**.

Or use this link directly: https://github.com/kleenpulse/raven-mail/security/advisories/new

**Do not open a public issue, discussion or pull request for a security bug.**

A good report says what is affected, how to reproduce it, and what an attacker could do with it. Please don't include real passwords, app passwords or anyone's real mail.

## What to expect

Raven has one maintainer. I aim to acknowledge reports within 7 days. This is best effort, not a guarantee. Once a fix ships, I'll credit you in the advisory unless you'd rather stay anonymous.

## Supported versions

Only the latest release on `main` gets security fixes. If you self-host, please stay up to date.

## In scope

- **The session cookie.** Mail credentials live only in an AES-256-GCM encrypted, `httpOnly` cookie (`lib/session.ts`). Anything that leaks, forges or decrypts it is in scope.
- **SSRF guards.** Outbound webhooks (`lib/integrations/safe-fetch.ts`) and custom IMAP/SMTP hosts (`lib/auth/host-guard.ts`) must not reach private networks in production. Bypasses (DNS rebinding, redirects, odd IP formats) are in scope.
- **The email frame.** Email bodies render in a sandboxed iframe with no scripts and a strict CSP, and remote images stay blocked until you click (`components/mail/email-frame.tsx`). Script execution, CSP escapes or tracker loads without a click are in scope.
- **Sealed webhook secrets.** Webhook URLs and signing secrets are sealed with AES-256-GCM before they reach the database (`lib/integrations/seal.ts`).
- **Cross-origin writes.** API routes reject writes from other origins (`lib/server/guard.ts`).
- **Rate limits.** Ask Jev and Deep triage are rate-limited (`lib/server/rate-limit.ts`).
- Anything else that exposes one user's mail or credentials to someone else.

## Out of scope

- Self-hosted deployments the operator has misconfigured. For example, a missing or weak `SESSION_SECRET`, or opting into `ALLOW_PRIVATE_MAIL_HOSTS`, `ALLOW_LOOPBACK_MAIL_HOSTS` or `ALLOW_PRIVATE_WEBHOOK_HOSTS`.
- Turning off certificate checks with `IMAP_REJECT_UNAUTHORIZED=false` or `SMTP_REJECT_UNAUTHORIZED=false`.
- Bugs in third-party providers (Gmail, Outlook, Slack, Discord, Neon, TypeSafe and so on). Please report those to the provider.
- The seeded dev-mode mailbox in development builds. (A way to reach it in a production build is in scope.)
- Reports from automated scanners with no working proof of impact.
