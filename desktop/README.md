# Raven desktop

This folder holds the desktop app for Windows, macOS and Linux. It's built with Electron around the same Next.js server the web app runs. The desktop app uses the version and CHANGELOG from the repo root.

## Scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `bun run desktop:setup` | Installs this folder's packages (no install scripts run) and downloads Electron. |
| `bun run desktop:dev` | Opens Raven in Electron on `next dev`, with hot reload and "Continue in dev mode". Stop your own `next dev` first: Next.js allows only one per project. |
| `bun run desktop:preview` | Builds the production server, stages it, and opens it in Electron. No installer. |
| `bun run desktop:build` | Same as preview, then makes the installer for this OS. Installers for users are only built on CI (`.github/workflows/desktop.yml`). |
| `bun run desktop:typecheck` | Type-checks this folder. |

Set `RAVEN_DEBUG_PORT=9222` to open the Chrome DevTools Protocol on that port (dev and preview only).

## How it fits together

- `main.ts` is the Electron main process. It owns the window, the session and the server's lifetime.
- `server/bootstrap.ts` runs Next's standalone server in a separate Electron utility process. It is bundled into the server folder as `raven-server.js`.
- `scripts/stage.ts` builds the web app with `RAVEN_DESKTOP_BUILD=1` and copies what ships into `.stage/`. `scripts/verify.ts` checks that folder.
- With `RAVEN_DB=pglite`, the server keeps integrations, rules, blocked senders, reminders and tour progress in a local Postgres (PGlite) under the data folder. It applies new migrations when it starts.

## Why the server listens on 127.0.0.1

We first looked at serving the app with no open port, through an Electron protocol handler (the `next-electron-rsc` approach). It didn't hold up:

- Electron doesn't support cookies on custom schemes, even when they're registered as standard and secure ([electron#27981](https://github.com/electron/electron/issues/27981)). Raven's session is a cookie.
- If you intercept `http` instead, Chromium ignores `Set-Cookie` and sends no `Cookie` header, so you'd need to copy cookies by hand ([electron#39525](https://github.com/electron/electron/issues/39525)).
- next-electron-rsc 0.5.0 doesn't claim Next 16 support. It runs Next inside Electron's main process, where Next adds process-wide signal and error handlers. It buffers request bodies and sends no `Host` header, so server actions fail Next's origin check.
- Electron has an open bug that corrupts uploaded request bodies in protocol handlers ([electron#55371](https://github.com/electron/electron/issues/55371)).

A real local server keeps everything a browser expects: cookies, streamed responses, uploads, `keepalive` requests when a page closes, and server actions. To keep it private:

- It only listens on `127.0.0.1`.
- Every request must name it exactly (`Host: 127.0.0.1:<port>`). A web page using DNS rebinding can't fake that.
- Every request must carry a token that's new on each launch. The main process adds it to the app's own requests (`session.webRequest`), and only to those. Browser tabs and other programs don't have it. Page scripts never see it.

`desktop:dev` doesn't have this guard. It runs plain `next dev` on `127.0.0.1`, so other programs on your computer can reach it while it runs.

The port is picked at random on first launch and kept in `desktop.json`. It's part of the page's origin, and the origin decides what localStorage and IndexedDB the app sees (settings, drafts, undo-send recovery). If another program takes the port, Raven picks a new one, and that local data starts fresh once.

## Security model

- The window runs sandboxed and context-isolated, with no Node.js, no preload and no webviews. DevTools are off in installed builds.
- Links to other sites, `mailto:` and `tel:` open in the system's apps. Other schemes are dropped.
- Only a few permissions are granted, and only to the app's own pages: copying to the clipboard, full screen and saving files. Location is refused: Electron's location service needs a Google API key, so the local weather can't find you on desktop yet.
- Electron fuses: `runAsNode`, `NODE_OPTIONS` and `--inspect` are off, and cookie encryption and asar integrity checks are on. Installed builds refuse `--remote-debugging-port`.
- `SESSION_SECRET` and `INTEGRATIONS_SECRET` are made on first launch and kept in `secrets.json`, locked with Electron `safeStorage` (the OS keychain). If the keychain changes, or isn't available, Raven asks before it makes new ones: Quit, or Start fresh. New secrets sign you out, and saved integrations, rules, blocked senders and reminders can't be read anymore. Raven only makes new ones without asking when the keychain works but can't read the file. On Linux without a keyring, the secrets are saved unencrypted, readable only by your user.
- The server never writes into its install folder: ISR flushing and gzip are off.
- The `resources/server` folder isn't covered by asar integrity. Code signing (a later phase) is what will protect it.

## Where data lives

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installed app | `%APPDATA%\Raven` | `~/Library/Application Support/Raven` | `~/.config/Raven` |

The folder holds `db/` (the local database), `logs/` (`main.log`, `server.log`), `secrets.json`, `desktop.json` and Chromium's own profile files. When Raven puts a broken database or secrets file aside, the copy stays next to it as `db.broken-<time>` or `secrets.json.broken-<time>`. Dev and preview runs use `Raven Dev` and `Raven Preview` instead.
