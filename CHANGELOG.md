# Changelog

All notable changes to Raven are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Releases are cut with `bun run bump patch|minor|major` — it moves the
Unreleased section under a new version heading, syncs package.json,
commits, and tags. Keep user-visible changes in the Unreleased section
as you work — it ships inside the app.

## [Unreleased]

## [0.10.1] - 2026-11-01

### Fixed

- The "What's new" card no longer runs off the top and bottom of a
  small window. Its list of changes scrolls, and the title and buttons
  stay on screen.

## [0.10.0] - 2026-11-01

### Added

- Raven now has a desktop app for Windows, macOS and Linux. It's the
  same Raven, running on your own computer. Your integrations, rules,
  blocked senders and reminders are kept in a small database inside
  the app, so there's nothing to set up. These first builds aren't
  signed yet, so your computer will warn you the first time you open
  Raven. The README shows what to click. It tells you when a new
  version is out.
- On desktop, Raven now checks for new versions by itself, when it
  starts and every 6 hours. You can also pick "Check for updates…" in
  the File menu (the Raven menu on a Mac) or in the tray menu. On
  Windows and with the Linux AppImage, Raven downloads the new version
  in the background and asks you to restart. If you pick Later, it
  updates the next time you quit. On a Mac and with the Linux .deb
  package, Raven tells you a new version is out and opens its download
  page. You install it over the old one.
- A link to Raven can now start a new email for you. Put an email
  link after `?compose=`, like `/mail?compose=mailto:sam@example.com`,
  and Raven opens a new message with the address, subject and text
  filled in. If you have unsaved changes in the message you're
  writing, Raven asks first.
- On desktop, Raven can now open the email links you click in other
  apps. Turn on "Use Raven for email links" in the File menu (the
  Raven menu on a Mac) or in Settings. On Windows, this opens the
  Windows default apps page, and you pick Raven there, because
  Windows doesn't let apps make themselves the default. Raven never
  takes over email links unless you ask. `raven://` links now open a
  message or the overview in Raven, even when it's closed.
- On desktop, the links in emails and briefs you share to Slack,
  Discord or a webhook now open the message in your Raven app. They
  go through a small page on raven-mail.vercel.app that hands the
  link to Raven. If you don't have the desktop app, that page shows
  where to get it.
- On desktop, Raven now opens where you left it, at the same size,
  and maximized if it was. If that screen isn't plugged in anymore,
  it opens on your main screen.
- On desktop, Raven now tells you when you're offline. It checks if
  it can reach your mail server, so the notice shows when your
  internet is down.
- You can now type your city to get the local weather. On desktop
  this is the only way, since the desktop app can't use your
  location. On the web it shows if you said no to sharing your
  location.
- Before the desktop app updates its database, it now saves a copy.
  If the database won't open after that, Raven offers to go back to
  the copy.
- On desktop, closing the window now keeps Raven running, so it
  can still check your mail. On Windows and Linux, open it again
  from the tray icon. On a Mac, click Raven in the Dock. To quit,
  use Quit Raven. If you'd rather it closes for good, turn off
  "Keep running when the window is closed". It's in the tray menu
  and the File menu (the Raven menu on a Mac).
- On desktop, Raven now shows a notification when new mail comes
  in and you're using another window. Click it to open the message.
  You can turn this off in Settings, under Notifications.

## [0.9.0] - 2026-10-30

### Changed

- The weather under the date on the Overview is now the real weather
  where you are, with the temperature. Before, it was Raven's "inbox
  weather" score, which said "Rain" when you had mail waiting, not
  when it was raining. That score still has its own card further down.
  Where Raven can't tell where you are, you can tap "Show local
  weather" to share your location once. Raven rounds it to about 1 km,
  keeps it on your device, and only uses it to look up the weather.
  Don't want Raven to use your location at all? Turn off Local Weather
  in Settings, under Appearance. That also forgets a location you
  shared, and so does signing out.

## [0.8.0] - 2026-10-30

### Added

- Images and videos in attachments now open in a bigger viewer.
  Zoom in with the + and − buttons, a double-click, Ctrl + scroll or
  a pinch, then drag to look around. Use the arrows or the ← and →
  keys to go through every image and video in the email or draft. If
  one file won't load, you can still move on to the next.
  A file you've opened once opens right away the next time, without
  downloading it again. The viewer opens at the same size every time,
  even for a small image, and doesn't jump smaller when a file appears.
  It only gets bigger to fit a very wide or tall file.
- If you're writing a message with changes that aren't saved and you
  open another draft, start a new message or reply, Raven now asks
  first. You can save it to Drafts and go on, go on without saving,
  or keep writing. Before, your changes were lost without a warning.

### Changed

- Attachments load faster. Raven now gets a file from your mail server
  in fewer, bigger pieces, so a large photo needs far fewer trips. When
  you rest the pointer on an image or video, or press it, Raven starts
  loading it before you click, so it often opens right away.
- Files in an email you just opened now open almost at once. Opening
  the email already brings its files to Raven, so Raven keeps them for
  a few minutes instead of asking your mail server for them again.
  Signing out clears them.
- Mail fails less often on a slow connection. When your mail server
  doesn't answer, Raven stops waiting after 8 seconds and tries once
  more, instead of waiting 20 seconds and showing an error. A wrong
  password still fails at once.
- Kage is more honest about how sure it is. When nothing in an email
  fits a category, it used to say about 68% for "Other". Now it says
  under 50%, so a low number means Kage is really guessing.
- Kage now gets a second opinion from Raven's simple word rules. When
  they agree with Kage, on a question or on an email's category, Raven
  shows the higher of the two scores. The word rules never overrule Kage.
- Kage now looks at who sent an email. A person's address, a no-reply
  or marketing address, a "Re:" in the subject, and a question for you
  all count now. On our test emails, Kage put 82% in the right inbox
  category, up from 76%. And your rules stopped catching mail from
  people by mistake: 5 wrong matches on our test set went to 0.
- When you ask "unread invoices" or "how many receipts this month",
  Kage now finds your receipts. Before, it gave you a summary of unread
  mail. Words like "unread", "new", "how many" and "this week" no
  longer win over what you're looking for. Kage got 92% of our test
  questions right, up from 86%.
- Kage mixes up fewer words. "news" is not "new" anymore, "lately" is
  not "late", a signed lease is not a sign-in, and a pull request is
  not someone asking you for something.
- The % Kage shows next to your question is now closer to how often it
  is right. It got 92% of our test questions right but said about 84%.
  Now it says about 90%. The answers are the same.
- Kage now reads how urgent an email is as a scale, from "can wait" to
  "do it now". Marketing mail that shouts "URGENT" or "final notice"
  no longer shows up when you ask what's pressing. On our test emails,
  wrong "pressing" picks went from 3 to 0. Kage also puts urgent mail
  above calm mail more often than Raven's simple word rules do.
- If Jev is slow or down, Ask now waits about 3 seconds for it, then
  Kage answers. Before, you could wait up to 16 seconds. Deep triage
  runs in the background, so it still gives Jev more time.
- Settings now shows how many times Kage had to answer because Jev
  failed, and why it failed last time. For example, TypeSafe refused
  the key, or Jev took too long. So a broken key doesn't go unnoticed
  anymore.

## [0.7.0] - 2026-10-30

### Added

- When your Inbox is split into tabs, there is now an All tab before
  Important. It shows every message in one list, whatever tab it
  belongs to.
- When you lose your connection, a small banner at the top says
  you're offline. When you're back, Raven loads your mail again by
  itself.

### Fixed

- If a refresh fails, the mail you already had on screen now stays.
  Before, an error took over the whole list.
- A folder or message you open while offline now says it's waiting
  for a connection, instead of loading forever.

## [0.6.3] - 2026-10-30

### Fixed

- Clicking an email address link inside a message now opens a new
  message in Raven, with the address filled in. Before, it asked
  Windows or your browser which app to use.

## [0.6.2] - 2026-10-25

### Removed

- The Newsletters and "When people write" cards are gone from the
  bottom of the overview. The Review button on the threads card now
  asks Jev which newsletters you never open.

### Fixed

- The "Write your message" hint no longer sits on top of the "1." or
  bullet when you start an empty message with a list or a quote.

## [0.6.1] - 2026-10-25

### Added

- The file preview has an "Open in new tab" button, for when you want
  the file bigger or next to your mail.

## [0.6.0] - 2026-10-25

### Changed

- Clicking a file now opens a preview on the page, not a new tab. This
  works in mail you read and mail you write, drafts too. Pictures, PDFs,
  audio, video and text show in the preview, with a button to download
  them. Other files still download. In mail you receive, files over 25 MB
  download instead. On phones, a PDF shows an "Open in new tab" button.

### Fixed

- In Drafts, the draft you have open is now marked in the list, like an
  open message in other folders.
- Clicking the draft you already have open no longer loads it again. Your
  edits and files stay as they are, and if the window is minimized it
  opens back up.
- Clicking several drafts quickly now opens the last one you clicked.
  Before, a slow draft could open on top of the one you picked after it.

## [0.5.0] - 2026-10-25

### Added

- You can open the files attached to a message you're writing, drafts
  included. Click a file's name: pictures, PDFs, audio, video and text
  open in a new tab, and other files download. Code and web files like
  XML or HTML open as plain text, so nothing in them can run.

### Changed

- The window where you write a message is now frosted glass. You can
  see a soft blur of your mail behind it, with a light glow in the top
  corner. If you turn on Reduce Transparency, it stays solid.
- Hover hints across the app now use Raven's own tooltip instead of the
  plain browser one. They show up faster and match the rest of the app.
  In the editor toolbar, one hint slides from button to button and shows
  the shortcut key.

## [0.4.3] - 2026-10-24

### Fixed

- Ask now shows the name of the engine that really answers. Raven
  checks your Jev key with TypeSafe before the page loads. If the key
  doesn't work, the panel, the Ask buttons and the home prompt say
  Kage, and Settings tells you TypeSafe isn't accepting the key.
- Ask answers faster when your Jev key doesn't work. Raven goes straight
  to Kage instead of waiting for TypeSafe to fail first.

## [0.4.2] - 2026-10-24

### Fixed

- Force dark now works on emails that only say they support dark
  mode, like the ones from Loom and Atlassian. Before, Raven trusted
  them and showed them white. Now Raven checks if the email really
  turned dark, and makes it dark itself if it didn't.

## [0.4.1] - 2026-10-24

### Changed

- When the inbox tabs don't all fit, you can now scroll through them
  with your mouse wheel. Just point at the tabs and scroll.

## [0.4.0] - 2026-10-23

### Added

- Bright emails like newsletters no longer flash white in the dark
  theme. Raven now makes them dark too, and keeps pictures in their
  real colors. Emails that come with their own dark look use it. A
  Force dark button next to Unsubscribe turns this off or on again,
  for when a logo is hard to see. You can also change it in Settings,
  under Mail, Dark Emails.

### Changed

- The selected inbox tab (Important, Updates and the rest) no longer
  sits on a filled background. Its colored text is enough to show which
  tab you are on.

## [0.3.0] - 2026-10-23

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
  its own. Raven checks while it's open. If your mail server is slow,
  Raven stops looking for replies after 10 seconds and shows the rest
  anyway, so your reminders never get stuck. Reminders need a database
  (DATABASE_URL), since they're saved to your account.
- Rules in plain words: in Settings → Rules, say which mail a rule is
  for, like "receipts and invoices from shops", and pick one thing to
  do: move it to a folder, archive, star, mark read or move to Trash.
  Preview a rule on your last 50 messages before you save it. The
  preview weighs it against your other rules, as a real run does, and
  tells you when another rule fits a message better or comes first. Rules run
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

- The "Message sent" notice now goes away on its own after a few
  seconds. Before, it stayed on screen until you closed it.
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
  in the Export panel and on the mail folder list. It also stays put
  when something above it grows or shrinks while the page updates.
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
