# Changelog

All notable changes to Raven are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Releases are cut with `bun run bump patch|minor|major` — it moves the
Unreleased section under a new version heading, syncs package.json,
commits, and tags. Keep user-visible changes in the Unreleased section
as you work — it ships inside the app.

## [Unreleased]

### Added

- Raven is now open source under the AGPL-3.0 license. Find the code
  from Settings → About or the link at the bottom of the home page.
- A Settings page. Open it from the gear in the side rail, the account
  menu, or `Ctrl`/`⌘` + `,`. Every change applies right away and is
  remembered on this device. Search it with `/`, and each changed
  setting shows a dot with its own reset button.
- Appearance settings: theme, a bigger size for everything, tighter message
  spacing, less motion, and fewer see-through panels.
- Mail settings: load images automatically, load messages early, and
  choose how long you have to undo a delete (5 to 30 seconds).
- Sync settings: check for mail when you come back to the tab, choose
  how often Raven checks, and turn off saving mail on this device.
  Clear Saved Mail wipes what's stored here.
- Turn off one-key shortcuts like C, J and / if you type into the app
  by accident. The full shortcut list lives in Settings.
- A pop-up when new mail arrives, with the sender and subject. Click it
  to open the message. Pick its corner in Settings.
- A welcome tour that walks you through Raven in about a minute, read
  aloud in an American or British voice. Pick the voice on the first
  step or in Settings → Tour & Voice, where you can also turn the voice
  off or take the tour again. Your progress and voice follow your account
  to other devices.
- What's New: after an update, a card lists what changed. The full
  changelog opens from the account menu or Settings → About.

### Changed

- Settings are written in plain English.
- The home page fits phones better. The section markers no longer
  cover the cards, and the Overview demo uses the full screen width.
  The Ask Jev demo is shorter on phones: each answer shows its top two
  emails and stats with tighter spacing and smaller text, the suggested
  questions sit in two rows you can swipe, and the keyboard shortcut
  hint is hidden. The Overview demo leaves out Threads radar on phones,
  and the footer drops its tagline there.
- On phones, the Orbit sender list starts with the top 5 senders instead
  of 8. "Show all" still opens the full list.

### Fixed

- Mail mix no longer draws two numbers on top of each other when two
  kinds of mail have almost the same count.

## [0.1.0] - 2026-09-25

### Added

- Raven: sign in to any IMAP mailbox and read, search, reply, archive
  and delete. Gmail, Yahoo, iCloud and Fastmail presets ask for an app
  password and link to where you make one.
- Overview: a dashboard built from your last 30 days of mail — what
  needs a reply, what you're waiting on, reply debt, inbox weather,
  volume, the mail mix, a daily brief, arrival rhythm, and Orbit, a map
  of who writes to you most.
- Ask Jev: ask about your mail in plain words. Answers come from your
  own emails, with the evidence, how sure Jev is, and what it searched.
- Integrations: send mail to Slack, Discord or a signed webhook, and
  export a folder as an .mbox file that resumes if interrupted.
- Two looks, Ember and Nebula, with a theme toggle in the side rail.
- Drag the line between the message list and the reader to resize them.
  Double-click resets it. Wide view (F) hides the list; your layout
  stays put across reloads.
- Neighbouring messages load ahead of time, so next/previous and J/K
  open instantly without marking anything read.
- Remote images in emails are blocked until you allow them.

### Fixed

- Signing in no longer crashes on the hosted app.
- Sign-in errors say what went wrong — app password needed, wrong
  password, server unreachable, and so on — and which side (receiving
  or sending) failed. The form keeps what you typed, and the password
  field has a show/hide button.
