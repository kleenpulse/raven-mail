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
- With `RAVEN_DB=pglite`, the server keeps integrations, rules, blocked senders, reminders and tour progress in a local Postgres (PGlite) under the data folder. It applies new migrations when it starts. Before it applies one to an existing database, it saves a copy to `db.backups` (`dumpDataDir`) and keeps the last three. If the database won't open, the app offers to start from the newest copy (`RAVEN_PGLITE_RESTORE`), or to start fresh.
- Staging replaces Turbopack's PGlite alias (`.next/node_modules/@electric-sql/pglite-<hash>`) with a small package that re-exports the real one, and leaves out PGlite's extension files. Otherwise PGlite would ship twice.
- Next's offline check asks the page's own server, and on desktop that server always answers. So desktop asks `/api/mail/reach` whether your mail server can be reached instead (`lib/desktop/reach-watch.ts`).

## Tray and notifications

- Closing the window hides it, and Raven keeps running so the page can keep checking for mail. To stop that, turn off "Keep running when the window is closed". It's in the tray menu and the File menu (the Raven menu on macOS), and it's saved in `settings.json`. Quit Raven, Windows logging off and shutting down all still close the app for real.
- Windows and Linux get a tray icon (`tray.ts`). Click it to show the window. The first time the window hides, a notification says where Raven went. macOS has no tray icon. Raven stays in the Dock, and clicking it shows the window.
- Some Linux desktops (GNOME without the AppIndicator extension) show no tray icon. Opening Raven again from the app menu shows the hidden window.
- While "keep running" is on, the window isn't slowed down in the background (`backgroundThrottling` off). So a hidden window checks for mail as often as a visible one: every 20 seconds, 1 minute or 5 minutes, following the Sync setting.
- When new mail comes in and Raven isn't the focused window, the page asks main for a notification through the preload bridge. One message shows the sender and subject; several show a count. Clicking it shows the window and opens the message. Settings → Notifications has a switch for it, shown only in the desktop app.
- On Windows, notifications need the app's ID and a Start Menu shortcut. The installer makes the shortcut, so `desktop:dev` and `desktop:preview` may not show them.

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

- The window runs sandboxed and context-isolated, with no Node.js and no webviews. DevTools are off in installed builds.
- The main window has one small preload (`preload.ts`). It gives the page `window.ravenDesktop` with two calls and nothing else:
  - `notifyNewMail(items)` asks for a new-mail notification. Main takes it only from the main window's top frame on the app's origin. It takes at most 50 items, each a numeric IMAP uid with a sender and subject cut to 200 characters. Anything else is dropped (`bridge.ts`).
  - `onOpen(callback)` gets a path in the app when you click a notification. Main only sends `/overview`, or `/mail` with `folder`, `uid`, `mid` or `compose`.
  - The preload has no Node.js. Child windows and email frames don't get it.
- Links to other sites, `mailto:` and `tel:` open in the system's apps. Other schemes are dropped.
- Only a few permissions are granted, and only to the app's own pages: copying to the clipboard, full screen and saving files. Location is refused: Electron's location service needs a Google API key. So on desktop the weather asks you to type a city, and the local server looks it up with Open-Meteo.
- Every response from the local server gets a Content Security Policy (`csp.ts`), in preview and installed builds. Scripts, plugins, frames and fetches must come from the app itself, and other pages can't frame it. It can't block inline scripts yet: Next's page data and the theme script are inline, and nonces would need middleware. It also lets images load from any site, because emails show remote images once you allow them. `desktop:dev` runs without it, since `next dev` needs `eval` and a websocket.
- Electron fuses: `runAsNode`, `NODE_OPTIONS` and `--inspect` are off, and cookie encryption and asar integrity checks are on. Installed builds refuse `--remote-debugging-port`. Electron 45 also has a ninth fuse, `wasmTrapHandlers`. It stays on (the default): it makes WebAssembly fast, and the local database runs on WebAssembly. electron-builder 26 can't set it, so `scripts/build.ts` checks that it's on.
- `SESSION_SECRET` and `INTEGRATIONS_SECRET` are made on first launch and kept in `secrets.json`, locked with Electron `safeStorage` (the OS keychain). If the keychain changes, or isn't available, Raven asks before it makes new ones: Quit, or Start fresh. New secrets sign you out, and saved integrations, rules, blocked senders and reminders can't be read anymore. Raven only makes new ones without asking when the keychain works but can't read the file. On Linux without a keyring, the secrets are saved unencrypted, readable only by your user.
- The server never writes into its install folder: ISR flushing and gzip are off.
- The `resources/server` folder isn't covered by asar integrity. Code signing (a later phase) is what will protect it.

## Where data lives

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installed app | `%APPDATA%\Raven` | `~/Library/Application Support/Raven` | `~/.config/Raven` |

The folder holds `db/` (the local database), `db.backups/` (copies from before database updates), `logs/` (`main.log`, `server.log`), `secrets.json`, `desktop.json` (the port), `window-state.json` (the window's size and place), `settings.json` (the desktop app's own settings) and Chromium's own profile files. When Raven puts a broken database or secrets file aside, the copy stays next to it as `db.broken-<time>` or `secrets.json.broken-<time>`. Dev and preview runs use `Raven Dev` and `Raven Preview` instead.
