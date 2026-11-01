# Raven desktop

This folder holds the desktop app for Windows, macOS and Linux. It's built with Electron around the same Next.js server the web app runs. The desktop app uses the version and CHANGELOG from the repo root.

## Scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `bun run desktop:setup` | Installs this folder's packages (no install scripts run) and downloads Electron. |
| `bun run desktop:dev` | Opens Raven in Electron on `next dev`, with hot reload and "Continue in dev mode". Stop your own `next dev` first: Next.js allows only one per project. |
| `bun run desktop:preview` | Builds the production server, stages it, and opens it in Electron. No installer. |
| `bun run desktop:build` | Same as preview, then makes the installer for this OS. Installers for users are only built on CI (`.github/workflows/desktop.yml`). It signs when the keys are in the environment ([RELEASING.md](RELEASING.md)). |
| `bun run desktop:forget-links` | Windows only. Removes what preview runs left behind: "Raven Preview" in the email app picker, `raven://` when preview holds it, and the Start menu shortcut Electron made for `electron.exe`. An installed Raven keeps its own. |
| `bun run desktop:typecheck` | Type-checks this folder. |

Set `RAVEN_DEBUG_PORT=9222` to open the Chrome DevTools Protocol on that port (dev and preview only).

On Windows, dev and preview use their own app ID (`io.github.kleenpulse.raven.dev`, `.preview`). Windows takes the taskbar icon from a Start menu shortcut with the window's app ID, and Electron makes one for `electron.exe` the first time it shows a notification. With one shared ID, an installed Raven showed Electron's icon.

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
- While "keep running" is on, the window isn't slowed down in the background (`backgroundThrottling` off). So a hidden window checks for mail as often as a visible one: every 20 seconds, 1 minute or 5 minutes, following the Sync setting. With it off, a minimised or covered window still checks, but Chromium can slow that down to about once a minute.
- When new mail comes in and Raven isn't the focused window, the page asks main for a notification through the preload bridge. One message shows the sender and subject; several show a count. Clicking it shows the window and opens the message. Settings → Notifications has a switch for it, shown only in the desktop app.
- On Windows, notifications need the app's ID and a Start Menu shortcut. The installer makes the shortcut, so `desktop:dev` and `desktop:preview` may not show them.

## Links

- `raven://open/mail?folder=<folder>&uid=<uid>` (or `mid=<Message-ID>`) opens a message, and `raven://open/overview` opens the overview. Raven takes nothing else. Other pages, other query keys and paths with `..` are dropped (`links.ts`), and main checks the path again before the page gets it (`bridge.ts`).
- If Raven isn't running, the link starts it and opens there. If it is, the window comes forward and goes there without reloading.
- Installed and preview builds register `raven://` each time they start. The NSIS installer doesn't register links, so this is how Windows learns about it. `desktop:dev` doesn't, because a link can't start `next dev`. Preview takes `raven://` from an installed Raven until the installed one starts again.
- Unpackaged builds register `electron <app folder> --raven-mode=<mode> "<link>"`. The mode has to come before the link: Electron refuses to start if anything follows a link on the command line (its fix for argument injection).
- Raven only takes email (`mailto:`) links when you ask, with "Use Raven for email links" (File menu, the Raven menu on macOS, or Settings → Mail). macOS and Linux make Raven the default right away. Windows doesn't let apps do that. So Raven lists itself under Default apps (`HKCU\Software\RegisteredApplications`, `Software\Raven\Capabilities` and a `Raven.mailto` ProgId) and opens that page, where you pick it. Raven reads your pick from `UserChoice`. Uninstalling removes those keys, and updating keeps them.
- A `mailto:` link opens `/mail?compose=<link>`. That works on the web too: on any page, `?compose=` opens the link in compose and then leaves the URL.
- Cards you share to Slack, Discord or a webhook can't link to the app's own server, since it's only on your computer. So on desktop their links go to `https://raven-mail.vercel.app/open?to=<raven link>` (`LINK_BASE` in `shared.ts`, passed to the server as `RAVEN_LINK_BASE`). That page tries the `raven://` link, and has buttons to open it in Raven or in the browser, and a link to install Raven. It only passes on `raven://open/mail` and `raven://open/overview` links (`lib/desktop/open-link.ts`). Any Raven deployment serves `/open`. Webhook JSON also carries the raw link as `ravenLink`. The web app's cards don't change.
- The macOS app declares both schemes (its URL types). That only says Raven can open them. The Linux `.desktop` file lists only `raven`: when you haven't picked an email app, Linux opens email links with any app that lists `mailto`, and Raven would take them without asking. On Linux, Electron finds its `.desktop` file through `desktopName` (`raven.desktop`), set when staging.

## Updates and signing

[RELEASING.md](RELEASING.md) has the whole story: cutting a release, the signing secrets and how to get them, and what updates on which system. In short:

- A `v*` tag makes CI build, sign when the keys are set, and put everything in a draft GitHub release. A person publishes it. The app only sees published releases.
- `updater.ts` uses electron-updater (bundled into `main.js`). It checks 30 seconds after start, every 6 hours, and from "Check for updates…" in the menu and the tray. `update-policy.ts` decides per build: Windows, the AppImage and signed macOS download the update and ask to restart. Unsigned macOS and the `.deb` open the release page instead. Dev and preview never check.
- The installer only starts after Raven has closed its windows and stopped its server, as the last step of quitting. The Windows installer closes every Raven process it finds, and the server could be writing the local database.
- `scripts/signing.ts` picks how to sign from the environment. With no keys, builds are unsigned (ad hoc on macOS), as before. Each build gets only its own OS's keys. `scripts/build.ts` writes `ravenBuild.signed` into the app's `package.json` for the updater, and checks the signatures it made.

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
- The main window has one small preload (`preload.ts`). It gives the page `window.ravenDesktop` with these calls and nothing else:
  - `notifyNewMail(items)` asks for a new-mail notification. Main takes it only from the main window's top frame on the app's origin. It takes at most 50 items, each a numeric IMAP uid with a sender and subject cut to 200 characters. Anything else is dropped (`bridge.ts`).
  - `onOpen(callback)` gets a path in the app when you click a notification or a link. Main only sends `/overview`, or `/mail` with `folder`, `uid`, `mid` or `compose`.
  - `mailApp.status()` and `mailApp.claim()` say whether Raven opens email links, and ask for it. Main answers only the main window's top frame on the app's origin.
  - The preload has no Node.js. Child windows and email frames don't get it.
- Links to other sites, `mailto:` and `tel:` open in the system's apps. Other schemes are dropped.
- Only a few permissions are granted, and only to the app's own pages: copying to the clipboard, full screen and saving files. Location is refused: Electron's location service needs a Google API key. So on desktop the weather asks you to type a city, and the local server looks it up with Open-Meteo.
- Every response from the local server gets a Content Security Policy (`csp.ts`), in preview and installed builds. Scripts, plugins, frames and fetches must come from the app itself, and other pages can't frame it. It can't block inline scripts yet: Next's page data and the theme script are inline, and nonces would need middleware. It also lets images load from any site, because emails show remote images once you allow them. `desktop:dev` runs without it, since `next dev` needs `eval` and a websocket.
- Electron fuses: `runAsNode`, `NODE_OPTIONS` and `--inspect` are off, and cookie encryption and asar integrity checks are on. Installed builds refuse `--remote-debugging-port`. Electron 45 also has a ninth fuse, `wasmTrapHandlers`. It stays on (the default): it makes WebAssembly fast, and the local database runs on WebAssembly. electron-builder 26 can't set it, so `scripts/build.ts` checks that it's on.
- `SESSION_SECRET` and `INTEGRATIONS_SECRET` are made on first launch and kept in `secrets.json`, locked with Electron `safeStorage` (the OS keychain). If the keychain changes, or isn't available, Raven asks before it makes new ones: Quit, or Start fresh. New secrets sign you out, and saved integrations, rules, blocked senders and reminders can't be read anymore. Raven only makes new ones without asking when the keychain works but can't read the file. On Linux without a keyring, the secrets are saved unencrypted, readable only by your user.
- The server never writes into its install folder: ISR flushing and gzip are off.
- The `resources/server` folder isn't covered by asar integrity. On a signed macOS build the code signature covers it, since it seals every file in the app bundle. On Windows, signing covers only `.exe` files, so the server folder relies on the install folder's permissions (it's in your own user's AppData). Unsigned builds have neither.
- Updates come only from published releases on kleenpulse/raven-mail, over HTTPS, and each file must match the sha512 in `latest*.yml`. Signed Windows builds also check the update's publisher name. Unsigned ones can't yet.

## Where data lives

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installed app | `%APPDATA%\Raven` | `~/Library/Application Support/Raven` | `~/.config/Raven` |

The folder holds `db/` (the local database), `db.backups/` (copies from before database updates), `logs/` (`main.log`, `server.log`), `secrets.json`, `desktop.json` (the port), `window-state.json` (the window's size and place), `settings.json` (the desktop app's own settings) and Chromium's own profile files. When Raven puts a broken database or secrets file aside, the copy stays next to it as `db.broken-<time>` or `secrets.json.broken-<time>`. Dev and preview runs use `Raven Dev` and `Raven Preview` instead.
