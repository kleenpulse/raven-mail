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

- Ask Jev and Deep triage now work without a Jev key. Raven has its own
  built-in engine, Kage, that answers the same questions on your server,
  with no account and no cost. If your Jev key stops working, Kage steps
  in instead of plain keyword rules. Answers and badges say "Kage" when
  Kage answered. Without a key, the Ask button and the Ask row in the
  Ctrl+K menu say "Ask Kage", so you always know who is answering.
- The floating Ask Jev button has a new frosted glass look. It now fades
  away while you scroll down a page and comes back when you scroll up or
  reach the top. You can hide
  it for good in Settings → Appearance. The Ask button in the side bar
  still opens it.
- A "buy me a coffee" button now sits in the top-right corner of the
  Overview and Mail top bars, if you'd like to support Raven.
- You can now download attachments straight from Raven. Click a file
  under the message header to save it. Files always download and never
  open inside Raven, so a harmful file can't run in your mailbox.
- Open a message in your Drafts folder to pick up where you left off. It
  opens in the compose window with its recipients, subject, text and
  files, ready to edit and send.
- Discarding a draft now offers Undo, in case you clicked by mistake.
- Archive, Move to Trash and Move to Inbox can now be undone, for one
  message or many. The message leaves the list at once, and Undo puts
  it back in the same place, still selected. Press Ctrl+Z (⌘Z on a Mac)
  to undo the last one. You set how long you have in Settings → Mail.
  If you close the tab before the time runs out, the action still
  goes through.
- New keys for the open message: E to archive, # to move to Trash, S to
  star, Shift+U to mark unread, R to reply, A to reply all and Shift+F
  to forward. Archive and Trash can be undone. They never fire while
  you type or while a menu, panel or the compose window has focus, they
  work with Caps Lock on, and they follow the Single-Key Shortcuts
  setting. See them all in Settings → Keyboard.
- Conversations: replies now group into one row in your mail list, with
  the people in it and how many messages it has. Open it to see the
  earlier messages above the newest one, including your own replies
  from Sent. Click any of them to read it in place. Archive, Trash and
  read or unread act on the whole conversation in that folder, and J
  and K move from one conversation to the next. Search results still
  show one row per message. Turn it off in Settings → Mail →
  Conversations.
- Undo Send: after you press Send, the compose window closes and you
  get 10 seconds to take the message back. Undo opens it again with
  everything you wrote and attached. Pick 5 to 30 seconds, or Off, in
  Settings → Mail. Starting another message sends the waiting one right
  away. If you try to leave while a message is waiting, Raven
  asks first. If you close the tab anyway, the message isn't sent, and
  it opens again in compose the next time you visit.
- Signatures: write one in Settings → Mail and Raven adds it under each
  new message, and above the quoted message when you reply or forward.
  You start typing above it. A draft you open again keeps the one it
  has, so you never get two. Your signature is saved on this device
  only.
- To, Cc and Bcc now suggest people as you type, picked from who you've
  written to and heard from in the last 30 days, most recent and
  frequent first. Use the arrow keys and Enter, or click. Each address
  becomes a chip you can remove, and pasting a list adds them all.
  Backspace in an empty box takes the last one back to edit. An address
  that doesn't look right turns red, and Send tells you which one.
- Formatting in compose: bold, italic, bulleted and numbered lists,
  links, quotes and code, from the bar under the text or with the usual
  keys (Ctrl+B, Ctrl+I). Markdown works too: type **bold**, "- " for a
  list or "> " for a quote. Every message also goes out as plain text,
  with list markers and link addresses kept, for mail apps that don't
  show formatting.
- Inbox tabs: Important, Updates, Newsletters, Receipts, Promotions and
  Social, each with its unread count. Mail from people, and anything
  that doesn't fit a tab, stays in Important. A quiet tab loads more
  mail by itself until it has enough to show. J and K stay inside the
  tab you're in. Pick which tabs show, or turn them off, in Settings →
  Mail. Search and other folders aren't split.
- A command menu: press Ctrl+K (⌘K on a Mac) anywhere to compose, go to
  any folder or page, open a settings section, switch between Ember and
  Nebula, search your mail, or act on the open message. Each action
  shows its key. Type a question and the top row asks Jev.
- Unsubscribe from a mailing list right from the message. When a
  newsletter supports it, an Unsubscribe button shows under the subject.
  After you confirm, Raven asks the sender to take you off the list, with
  no page to visit. If the sender only offers a web page or an email,
  the button opens their page or writes the email for you.
- Block a sender from the ⋯ menu on any message: just that address, or
  everyone at a company's domain. Their mail leaves your Inbox at once,
  and Undo brings it back. Search still finds it. See and unblock
  everyone in Settings → Mail → Blocked senders. Blocking needs a
  database (DATABASE_URL), since your list is saved to your account.
- Follow-up reminders: ask Raven to remind you if no one replies. In
  compose, click the bell and pick 1 day, 3 days, 1 week or a time of
  your own. You can also set one from the ⋯ menu on a message in Sent,
  or from the bell next to anyone under "Gone quiet" on the Overview.
  When the time comes and no reply has reached your Inbox, a reminder
  pops up, and the Overview lists it under Follow-ups, with Done, Snooze
  1 day and Open thread. If they reply first, the reminder goes away on
  its own. Raven checks while it's open. Reminders need a database
  (DATABASE_URL), since they're saved to your account.
- Rules in plain words: in Settings → Rules, say which mail a rule is
  for, like "receipts and invoices from shops", and pick one thing to
  do: move it to a folder, archive, star, mark read or move to Trash.
  Preview a rule on your last 50 messages before you save it. Rules run
  on new mail while Raven is open, and when you click Run rules now (it's
  in the Ctrl+K menu too). Jev decides, or Kage, Raven's built-in engine,
  when there's no key. A rule only acts when it's sure, and Trash asks
  for more. Mail from people you write to is never moved, archived or
  trashed by a rule. Recent activity shows what each rule did and how
  sure it was, and moves can be undone there. Start a rule from the ⋯
  menu on any message. Rules need a database (DATABASE_URL).
- The "not found" page now glows with the same gold aurora as the
  bottom of the landing page.
- A refresh button now sits beside the folder name above your mail list.
  It checks for new mail right away, and spins while the list syncs.

### Changed

- Ctrl+K (⌘K) now opens the command menu instead of going straight to
  Ask Jev. Press Enter on the first row to ask Jev, or type your
  question first. The Ask Jev button in the side bar still opens it
  directly.

### Fixed

- A name with a comma in it, like "Chen, Maya", no longer splits into
  two recipients when you reply all, reopen a draft or send. Raven used
  to drop such names from a reopened draft; now it keeps them.
- An avatar for a name that starts with an emoji now shows the emoji
  instead of a broken character.
- A message with another email attached to it now shows the paperclip
  and counts toward attachment storage on the Overview. Before, an
  attached email that held only text was missed.
- Saving a draft more than once no longer fills your Drafts folder with
  copies. Each save replaces the last one. Sending or discarding a saved
  draft removes it from Drafts, and Bcc is kept when you save.
- The Overview no longer scrolls sideways on wide screens. The Daily
  brief's "Deep triage" button, a long subject, or a long suggestion
  typing out in the "need help?" box could push the page wider than
  the window. Long subjects now wrap and the buttons stack when the card
  is narrow.
- The highlight on the selected tab no longer jumps up or down the
  screen when the page gets shorter as you switch. It now slides
  straight to the tab you picked, on the Overview cards, in Settings,
  in the Export panel and on the mail folder list.
- Emails with images no longer open squashed into a thin strip with
  their own scrollbar. The message now opens at its full height right
  away, instead of waiting for every image to finish loading.
- The Reply and Forward buttons no longer push the close button off the
  edge when the message pane is narrow. If they don't fit beside the
  other tools, they move to their own row just below, labels and all.

### Security

- Raven now runs on Next.js 16.4.0, which fixes seven security issues in
  older versions. Two of them could let a visitor poison the cached home
  page on a self-hosted copy. If you host Raven yourself, update and
  redeploy.

## [0.2.0] - 2026-10-13

### Added

- Raven is now open source under the AGPL-3.0 license. Find the code
  from Settings → About or the link at the bottom of the home page.
- Use your own TypeSafe key for Jev. Paste it in Settings → Account and
  Ask Jev and Deep triage run on your TypeSafe account. Raven checks the
  key before saving it, keeps it encrypted with your sign-in, and forgets
  it when you sign out.
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
