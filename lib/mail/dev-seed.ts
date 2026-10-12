import type { AttachmentMeta, MailAddress, MailMessage } from "@/lib/mail/types";

/**
 * Deterministic 45-day synthetic mailbox for the dev login. Pure (no server-only imports) so
 * tests and the dev store share it. Same (now, seed) ⇒ deep-equal output on a given machine;
 * hours are laid out in the machine's local time zone so heatmaps look right in dev.
 */

export const DEV_SELF: MailAddress = { address: "dev@localhost", name: "You" };

const DEFAULT_SEED = 20_260_924;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WINDOW_DAYS = 45;
/** My unanswered Sent mail younger than this never reads as "waiting on" (the rule's floor is 48h). */
const YOUNG_MS = 40 * HOUR;
/** Needs-reply window is 14 days; keep a margin so the boundary never flips a count. */
const NEEDS_REPLY_EDGE_MS = 14 * DAY;
const EDGE_MARGIN_MS = 6 * HOUR;

type Rand = () => number;

function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const intIn = (rand: Rand, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

function pickWeighted<T>(rand: Rand, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [item, w] of items) {
    roll -= w;
    if (roll < 0) return item;
  }
  return items[items.length - 1]![0];
}

/** Lognormal around `medianHours`, so per-contact reply medians land near the roster values. */
function latency(rand: Rand, medianHours: number): number {
  const gauss = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const hours = medianHours * Math.exp(0.5 * gauss);
  return Math.min(4 * medianHours, Math.max(0.25, hours)) * HOUR;
}

const sec = (t: number) => Math.floor(t / 1000) * 1000;

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function atLocal(day: number, hour: number, minute: number, second = 0): number {
  const d = new Date(day);
  d.setHours(hour, minute, second, 0);
  return d.getTime();
}

const isWeekend = (t: number) => {
  const dow = new Date(t).getDay();
  return dow === 0 || dow === 6;
};

const localHour = (t: number) => {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
};

type Hours = readonly (readonly [number, number])[];

// Inbound human mail clusters 8–11 and 14–16 with a thin evening tail.
const HUMAN_HOURS: Hours = [
  [8, 3], [9, 5], [10, 5], [11, 4], [12, 1], [13, 1], [14, 4], [15, 4], [16, 3],
  [17, 1], [18, 0.6], [19, 0.5], [20, 0.4], [21, 0.3],
];
const MY_HOURS: Hours = [
  [9, 4], [10, 5], [11, 4], [12, 1], [13, 2], [14, 4], [15, 4], [16, 4], [17, 3], [18, 1],
];
const WEEKEND_HOURS: Hours = [[10, 2], [11, 2], [12, 1], [14, 1], [15, 1], [16, 1], [17, 1], [18, 1], [20, 1]];
const MORNING: Hours = [[8, 3], [9, 4], [10, 3]];
const NOTIFY_HOURS: Hours = [
  [7, 1], [8, 2], [9, 3], [10, 4], [11, 4], [12, 2], [13, 2], [14, 4], [15, 4], [16, 4],
  [17, 3], [18, 2], [19, 1], [20, 1], [21, 1], [22, 0.5], [23, 0.3],
];

function slotOn(day: number, hours: Hours, rand: Rand): number {
  return atLocal(day, pickWeighted(rand, hours), Math.floor(rand() * 60), Math.floor(rand() * 60));
}

/** Push a reply into the sender's working day: evenings sometimes, weekends rarely, else next morning. */
function snapWork(t: number, rand: Rand, evening: number): number {
  const h = localHour(t);
  if (!isWeekend(t)) {
    if (h >= 8 && h < 18.5) return t;
    if (h >= 18.5 && h < 22 && rand() < evening) return t;
  } else if (h >= 10 && h < 20 && rand() < 0.05) {
    return t;
  }
  let day = startOfLocalDay(t);
  if (h >= 8 || isWeekend(day)) day = addDays(day, 1);
  while (isWeekend(day)) day = addDays(day, 1);
  return Math.max(t, slotOn(day, MORNING, rand));
}

/** Move `t` back (never forward) onto a weekday afternoon. */
function snapBackWork(t: number, rand: Rand): number {
  const h = localHour(t);
  if (!isWeekend(t) && h >= 8 && h < 18) return t;
  let day = startOfLocalDay(t);
  if (h < 8 || isWeekend(day)) day = addDays(day, -1);
  while (isWeekend(day)) day = addDays(day, -1);
  return atLocal(day, intIn(rand, 15, 17), Math.floor(rand() * 60), Math.floor(rand() * 60));
}

/* ─── Roster ─── */

type Topic = { subject: string; body: string; attach?: AttachmentMeta };

type Contact = {
  key: string;
  name: string;
  address: string;
  /** Fixed Date: header offset in minutes east of UTC; otherwise the machine's local offset. */
  offset?: number;
  /** Median hours before I reply to them / they reply to me. */
  mine: number;
  theirs: number;
  /** Chance a late reply of theirs goes out that evening instead of next morning. */
  evening: number;
  weight: number;
  colleague: string;
  topics: Topic[];
  outreach: Topic[];
};

const pdf = (filename: string, size: number): AttachmentMeta => ({ filename, contentType: "application/pdf", size });

const CONTACTS: Contact[] = [
  {
    key: "maya", name: "Maya Chen", address: "maya.chen@northwind.example", mine: 2, theirs: 2, evening: 0.3,
    weight: 5, colleague: "sam",
    topics: [
      { subject: "Q4 planning — draft priorities", body: "Hi! I pulled together a first pass at Q4 priorities. Could you sanity-check the sequencing before Thursday's sync? Mostly worried about the offline mode estimate." },
      { subject: "Board deck — final draft", body: "Attached is the final draft of the board deck. Slides 6–9 cover the roadmap — can you double-check the numbers on the retention chart before I send it Friday?", attach: pdf("deck.pdf", 4_194_304) },
      { subject: "Pricing page copy", body: "Marketing sent over new copy for the pricing page. I think the Team tier undersells sync. Thoughts before I push back?" },
      { subject: "Beta feedback summary", body: "Summarized last week's beta feedback — 42 responses. Search speed is the top complaint again, followed by attachment previews. Want to go through it together?" },
      { subject: "Launch date check-in", body: "Are we still on track for the 14th? Marketing needs a yes or no by end of week so they can book the newsletter slot." },
      { subject: "Interview panel for the senior role", body: "Could you take the system design slot for Tuesday's candidate? I'll send the packet once you confirm." },
    ],
    outreach: [
      { subject: "Summary view — Q4 or Q1?", body: "Quick roadmap question: do we still want the summary view in Q4, or should it slip to Q1 so we can finish search?" },
      { subject: "Notes from the Harbor call", body: "Sharing notes from today's call with Harbor. They want webhooks before SSO. Worth a slot at the next sync?" },
    ],
  },
  {
    key: "sam", name: "Sam Okafor", address: "sam.okafor@northwind.example", mine: 4, theirs: 4, evening: 0.2,
    weight: 3, colleague: "jordan",
    topics: [
      { subject: "Reader pane spacing", body: "Tried capping the reader pane at 68ch — reads much better on wide screens. Mind if I ship it behind the density flag?" },
      { subject: "Sidebar icon options", body: "Uploaded three options for the sidebar icons. I lean toward the outlined set, but the duotone one has more personality. Which do you prefer?" },
      { subject: "Empty state copy", body: "Drafted copy for the empty inbox, empty search, and offline states. Could you give it a quick read? Tone is meant to be calm, not cute." },
      { subject: "Dark mode contrast fixes", body: "A few tokens fail AA in dark mode — mostly muted text on cards. I have fixes ready; want to review before I merge?" },
    ],
    outreach: [
      { subject: "Shortcut cheat sheet", body: "Could you mock up a shortcut cheat sheet for the command palette? Nothing fancy — one screen, grouped by action." },
      { subject: "Avatar fallback colors", body: "The avatar fallbacks look muddy in dark mode. Could you pick a set of six that pass contrast on both themes?" },
    ],
  },
  {
    key: "jordan", name: "Jordan Lee", address: "jordan.lee@northwind.example", mine: 5, theirs: 5, evening: 0.2,
    weight: 2, colleague: "alex",
    topics: [
      { subject: "On-call handoff", body: "I'm on call from Monday. Anything I should know about the IMAP reconnect alerts from last week?" },
      { subject: "Offsite logistics", body: "Booking the offsite venue today. Any dietary restrictions I should pass on? Also: train or car?" },
      { subject: "Conference tickets", body: "Early-bird tickets for LocalFirst Conf close Friday. Should I grab two, or are you skipping this year?" },
      { subject: "Ramen Thursday?", body: "The ramen place by the office finally reopened. Thursday around noon?" },
    ],
    outreach: [
      { subject: "Staging credentials rotation", body: "Heads up: I'm rotating the staging credentials tomorrow. Can you update the dev vault entry once it's done?" },
      { subject: "Offsite agenda", body: "Drafting the offsite agenda — can you own the 30-minute slot on the sync engine roadmap?" },
    ],
  },
  {
    key: "priya", name: "Priya Raman", address: "priya@fieldwork.example", mine: 4, theirs: 3, evening: 0.85,
    weight: 2, colleague: "maya",
    topics: [
      { subject: "Round 2 interview schedule", body: "Here's the proposed schedule for round 2 — eight sessions over two weeks. Does the Wednesday block work for you to observe?" },
      { subject: "Research synthesis — first cut", body: "First cut of the synthesis is in the shared folder. Big theme so far: people triage on mobile and reply on desktop. Curious what surprises you." },
      { subject: "Recruiting screener", body: "Could you review the screener questions? I want to be sure we catch people who juggle more than one inbox." },
    ],
    outreach: [
      { subject: "Round 3 scope", body: "Thinking about round 3: could we focus on shared inboxes? Happy to adjust the budget if needed." },
    ],
  },
  {
    key: "lina", name: "Lina Duarte", address: "lina@kaizen-studio.example", offset: 540, mine: 1.5, theirs: 8, evening: 0.3,
    weight: 3, colleague: "maya",
    topics: [
      { subject: "Phase 2 contract", body: "Please find the phase 2 contract attached. Our legal team made two small edits in section 4. Could you confirm so we can countersign this week?", attach: pdf("contract.pdf", 327_680) },
      { subject: "Feedback on the staging build", body: "The team tested the staging build today — sync feels much faster! Two issues: attachments over 10MB fail, and the unread count lags behind." },
      { subject: "Tokyo rollout timeline", body: "Could we align on the Tokyo rollout timeline? Our internal launch is planned for early next month." },
      { subject: "Question about the support retainer", body: "Our finance team asked about line 3 on the last statement — is the support retainer billed monthly or quarterly?" },
    ],
    outreach: [
      { subject: "Staging access for your team", body: "I've set up staging access for your team. Could you send me the list of people who need accounts?" },
      { subject: "Phase 3 proposal", body: "Sharing a first outline for phase 3 — mostly shared inboxes and audit logs. Would you like to review it before our call?" },
    ],
  },
  {
    key: "omar", name: "Omar Haddad", address: "omar@harbor.example", offset: -300, mine: 5, theirs: 6, evening: 0.3,
    weight: 2, colleague: "alex",
    topics: [
      { subject: "Statement of work draft", body: "Attached is the SOW draft for the integration work. Let me know if the milestones look right on your side.", attach: { filename: "harbor-sow.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 183_296 } },
      { subject: "API rate limits", body: "We're hitting the rate limit on the messages endpoint during our nightly sync. Any chance we can raise it for our account?" },
      { subject: "Quick call this week?", body: "Do you have 30 minutes this week to walk through the webhook design? Thursday afternoon your time works best for us." },
    ],
    outreach: [
      { subject: "Webhook retry policy", body: "Following up on webhooks: would exponential backoff with a 24-hour cap work for your team? I'd like to lock it before we build." },
    ],
  },
  {
    key: "chloe", name: "Chloé Martin", address: "chloe@atelier.example", offset: 120, mine: 4, theirs: 4, evening: 0.3,
    weight: 2, colleague: "sam",
    topics: [
      { subject: "Moodboard for the landing page", body: "Voilà — the moodboard for the new landing page. Warm neutrals, lots of paper texture. What do you think?", attach: { filename: "moodboard.png", contentType: "image/png", size: 2_516_582 } },
      { subject: "Onboarding illustrations — final files", body: "Final files for the onboarding illustrations are in the shared drive, and the billing summary is attached. Anything you would like tweaked before we close this out?", attach: pdf("atelier-statement-0932.pdf", 96_256) },
      { subject: "Type pairing options", body: "I narrowed the type pairing to two options. The serif headline feels more editorial — which direction do you prefer?" },
    ],
    outreach: [
      { subject: "Hero illustration revisions", body: "Could we try the hero illustration with a lighter background? Happy to jump on a call if that's easier." },
    ],
  },
  {
    key: "alex", name: "Alex Kim", address: "alex.kim@northwind.example", mine: 3, theirs: 2, evening: 0.3,
    weight: 3, colleague: "maya",
    topics: [
      { subject: "Deploy freeze Friday", body: "Heads up: we're freezing deploys Friday for the infra migration. Anything that must go out should merge by Thursday noon — does that work for your PRs?" },
      { subject: "Review: sync engine refactor", body: "Opened the PR for the sync engine refactor. It's big, sorry — happy to walk you through it. Can you take a first pass?" },
      { subject: "Incident follow-up", body: "The postmortem doc for Tuesday's IMAP timeout incident is up. Can you add the timeline from your side?" },
      { subject: "Staging DB migration", body: "Running the staging migration tomorrow morning. Can you hold off on seeding test data until I ping you?" },
    ],
    outreach: [
      { subject: "Alerting thresholds", body: "The reconnect alert fires too often at night. Could we raise the threshold to five failures in ten minutes?" },
      { subject: "Pairing on the MIME parser", body: "Want to pair on the MIME parser edge cases this week? I have a list of nine weird messages from the beta." },
    ],
  },
];

const CONTACT = new Map(CONTACTS.map((c) => [c.key, c]));
const contact = (key: string) => CONTACT.get(key)!;
const CONTACT_WEIGHTS = CONTACTS.map((c) => [c, c.weight] as const);

const THEIR_REPLIES = [
  "Thanks! That makes sense — I'll update the doc and circle back tomorrow.",
  "Perfect, that works for me. Could we move the review to Thursday, though?",
  "Got it. I'll take a look this afternoon and send notes.",
  "Great, thanks for the quick turnaround. Let's go with option B then.",
  "Makes sense. I pushed a revision — mind taking another look?",
  "Sounds good. I'll check with the team and get back to you.",
  "Thanks, that answers it. Do you have the latest numbers handy?",
  "Appreciate it! I'll confirm the details by end of day.",
];
const MY_REPLIES = [
  "Thanks — looks good to me. One small note: let's keep the scope tight for v1.",
  "Good call. I'll take a proper look this afternoon.",
  "Yes, that works. Go ahead and ship it.",
  "Makes sense. Can you share the doc so I can comment inline?",
  "Thanks for flagging. I'd go with the second option — simpler to maintain.",
  "On it — I'll have an answer for you by tomorrow morning.",
  "Looks great. Two small nits, I left them in the doc.",
  "Agreed. Let's cover the open questions at the next sync.",
];
const CLOSINGS = [
  "Perfect — thanks, that's everything I needed.",
  "Great, consider it done. Thanks!",
  "Thanks! Closing the loop on this one.",
  "All sorted on our side. Thanks for the help!",
];
const FOLLOW_UPS = [
  "Thanks! One more question before I send this out — are you OK with the revised timeline?",
  "Following up on this — could you confirm by Friday so we can lock it in?",
  "Quick nudge: any thoughts on the open question above? I'd like to wrap this up this week.",
];
const HANDOFFS = [
  "Thanks! Looping in {col} to take it from here — {col}, can you pick this up?",
  "Great — {col}, over to you for next steps. Keeping everyone cc'd.",
  "Perfect. Adding {col}, who owns this now. {col}, context is below.",
];

/** Sent mail to people 2–10 days old that never got an answer ("waiting on"). */
const GHOSTS: { key: string; minAgeH: number; topic: Topic }[] = [
  { key: "priya", minAgeH: 54, topic: { subject: "Fieldwork notes from last week", body: "Could you share the raw notes from last week's sessions? I'd like to pull a few quotes for Thursday's roadmap review." } },
  { key: "alex", minAgeH: 86, topic: { subject: "On-call runbook review", body: "Could you review the on-call runbook changes before next week's rotation? Mostly the IMAP reconnect section." } },
  { key: "chloe", minAgeH: 124, topic: { subject: "Docs site color palette", body: "Could you send over the palette for the docs site when you have a moment? We'd like to start the build next week." } },
  { key: "sam", minAgeH: 166, topic: { subject: "Settings page audit", body: "Could you do a quick audit of the settings page for spacing and contrast? A list of issues is plenty." } },
];
const NEEDS_REPLY_TOTAL = 7;
const NEEDS_REPLY_AGES_DAYS = [2.5, 4.5, 7.5, 10.5];
const STANDALONE_ASKERS = ["jordan", "alex", "sam", "lina", "maya", "priya", "omar"];
const SUBJECT_SUFFIX = ["", " (follow-up)", " — round 2", " — take 3"];

type Turn = { out: boolean; at: number; handoff?: boolean; nr?: boolean };
type Thread = {
  c: Contact;
  topic: Topic;
  subject: string;
  turns: Turn[];
  planned: number;
  ghost: boolean;
  /** Scheduled arrival of their next reply. */
  next?: number;
  done: boolean;
};
type Ctx = {
  now: number;
  floor: number;
  rand: Rand;
  cursor: Map<string, number>;
  /** Sent count per local day (keyed by local midnight), so every pass respects the daily range. */
  sentPerDay: Map<number, number>;
  /** Inbound count per local day, so human arrivals never push a day past its range. */
  inPerDay: Map<number, number>;
};

const inboundCap = (day: number) => (isWeekend(day) ? 6 : 16);
const hasRoom = (ctx: Ctx, t: number) => (ctx.inPerDay.get(startOfLocalDay(t)) ?? 0) < inboundCap(startOfLocalDay(t));

function countInbound(ctx: Ctx, t: number): void {
  const day = startOfLocalDay(t);
  ctx.inPerDay.set(day, (ctx.inPerDay.get(day) ?? 0) + 1);
}

/** Slide an arrival to the next weekday morning while its day is already full. */
function withRoom(ctx: Ctx, t: number): number {
  let at = t;
  for (let i = 0; i < 5 && !hasRoom(ctx, at); i++) at = snapWork(addDays(startOfLocalDay(at), 1), ctx.rand, 0);
  return at;
}

const last = (th: Thread) => th.turns[th.turns.length - 1]!;
const priority = (th: Thread) => (th.c.key === "lina" ? 0 : th.c.key === "maya" ? 1 : 2);

function openThread(ctx: Ctx, c: Contact, outreach: boolean, at: number): Thread {
  const pool = outreach ? c.outreach : c.topics;
  const key = `${c.key}:${outreach ? "out" : "in"}`;
  const n = ctx.cursor.get(key) ?? 0;
  ctx.cursor.set(key, n + 1);
  const base = pool[n % pool.length]!;
  const cycle = Math.floor(n / pool.length);
  return {
    c,
    // Attachments ride only on a topic's first appearance.
    topic: cycle === 0 ? base : { subject: base.subject, body: base.body },
    subject: base.subject + SUBJECT_SUFFIX[Math.min(cycle, SUBJECT_SUFFIX.length - 1)],
    turns: [{ out: outreach, at: sec(at) }],
    planned: pickWeighted(ctx.rand, [[2, 3], [3, 3], [4, 2], [5, 1.2], [6, 0.8]]),
    ghost: false,
    done: false,
  };
}

function myReplyTime(ctx: Ctx, th: Thread, day: number, weekend: boolean): number | null {
  const { rand } = ctx;
  const prev = last(th).at;
  let at = prev + latency(rand, th.c.mine);
  if (at < day) at = slotOn(day, weekend ? WEEKEND_HOURS : MY_HOURS, rand);
  if (at <= prev) at = prev + (10 + rand() * 50) * MIN;
  const h = localHour(at);
  if (h < 8) at = atLocal(startOfLocalDay(at), weekend ? 10 : 8, Math.floor(rand() * 60));
  else if (h >= 19 && rand() > 0.3) return null;
  return sec(at);
}

/** After I send: schedule their answer, or let the thread rest on my message only while it's young. */
function afterMine(ctx: Ctx, th: Thread): void {
  const { now, rand } = ctx;
  const at = last(th).at;
  const young = now - at < YOUNG_MS;
  if (th.turns.length >= th.planned) {
    if (young) {
      th.done = true;
      return;
    }
    th.planned = th.turns.length + 1;
  }
  let reply = withRoom(ctx, snapWork(at + latency(rand, th.c.theirs), rand, th.c.evening));
  if (reply > now) {
    if (young) {
      th.done = true;
      return;
    }
    // Keeps "waiting on" limited to GHOSTS: an old message of mine gets a late (evening/weekend) answer.
    reply = Math.max(at + 20 * MIN, Math.min(at + latency(rand, th.c.theirs), now - (20 + rand() * 100) * MIN));
  }
  countInbound(ctx, reply);
  th.next = sec(reply);
}

function eveningShift(t: number, rand: Rand): number {
  const h = localHour(t);
  if (h >= 9 && h < 20) return t;
  const day = h < 9 ? addDays(startOfLocalDay(t), -1) : startOfLocalDay(t);
  return atLocal(day, intIn(rand, 17, 18), Math.floor(rand() * 60), Math.floor(rand() * 60));
}

function simulate(ctx: Ctx): Thread[] {
  const { now, rand } = ctx;
  const ghosts: Thread[] = GHOSTS.map(({ key, minAgeH, topic }) => ({
    c: contact(key),
    topic,
    subject: topic.subject,
    turns: [{ out: true, at: sec(eveningShift(now - (minAgeH + rand() * 6) * HOUR, rand)) }],
    planned: 1,
    ghost: true,
    done: true,
  }));
  const threads: Thread[] = [...ghosts];

  for (let d = WINDOW_DAYS - 1; d >= 0; d--) {
    const day = addDays(startOfLocalDay(now), -d);
    const next = addDays(day, 1);
    const weekend = isWeekend(day);
    const inDay = (t: number) => t >= day && t < next && t >= ctx.floor && t <= now;

    // Fewer, longer conversations inside the needs-reply window: a thread that ends there on their
    // word needs a late reply from me or a cc-only hand-off (see settle), so keep those rare.
    const recent = now - day < NEEDS_REPLY_EDGE_MS;
    const fresh = weekend ? (rand() < 0.12 ? 1 : 0) : recent ? pickWeighted(rand, [[0, 1], [1, 2], [2, 1]]) : intIn(rand, 1, 3);
    for (let n = fresh; n > 0; n--) {
      const at = slotOn(day, HUMAN_HOURS, rand);
      if (!inDay(at) || !hasRoom(ctx, at)) continue;
      countInbound(ctx, at);
      threads.push(openThread(ctx, pickWeighted(rand, CONTACT_WEIGHTS), false, at));
    }

    let sent = (ctx.sentPerDay.get(day) ?? 0) + ghosts.filter((g) => inDay(g.turns[0]!.at)).length;
    const quota = Math.max(sent, weekend ? (rand() < 0.35 ? 1 : 0) : intIn(rand, 3, recent ? 4 : 5));
    const cap = weekend ? quota : 6;
    for (let pass = 0; pass < 4; pass++) {
      for (const th of threads) {
        if (th.next === undefined || th.next >= next || th.next > now) continue;
        th.turns.push({ out: false, at: th.next });
        const inWindow = th.next >= now - NEEDS_REPLY_EDGE_MS - EDGE_MARGIN_MS;
        th.next = undefined;
        if (th.turns.length < th.planned) continue;
        if (inWindow && th.turns.length < 8 && rand() < 0.7) th.planned += 2;
        else th.done = true;
      }
      const waiting = threads
        .filter((th) => !th.done && th.next === undefined && !last(th).out)
        .sort((a, b) => priority(a) - priority(b) || last(a).at - last(b).at);
      for (const th of waiting) {
        if (sent >= (pass === 0 ? quota : cap)) break;
        const at = myReplyTime(ctx, th, day, weekend);
        if (at === null || !inDay(at)) continue;
        th.turns.push({ out: true, at });
        sent++;
        afterMine(ctx, th);
      }
      while (pass === 0 && !weekend && sent < quota) {
        const at = slotOn(day, MY_HOURS, rand);
        if (!inDay(at)) break;
        const th = openThread(ctx, pickWeighted(rand, CONTACT_WEIGHTS), true, at);
        threads.push(th);
        sent++;
        afterMine(ctx, th);
      }
    }
    ctx.sentPerDay.set(day, sent);
  }
  return threads;
}

/**
 * Pin the obligations: exactly NEEDS_REPLY_TOTAL unanswered asks addressed to me in the last 14 days
 * (the newest few plus a spread of older ones). Any other thread that ends with them inside the
 * window gets a recent reply from me if that day's Sent range allows, else becomes a cc-only hand-off.
 */
function settle(ctx: Ctx, threads: Thread[]): void {
  const { now, rand } = ctx;
  const edge = now - NEEDS_REPLY_EDGE_MS;
  const open: Thread[] = [];
  for (const th of threads) {
    const end = last(th);
    if (end.out) continue;
    if (end.at < edge - EDGE_MARGIN_MS) {
      if (th.turns.length > 2 && rand() < 0.1) end.handoff = true;
    } else if (end.at < edge + EDGE_MARGIN_MS) {
      end.handoff = true;
    } else {
      open.push(th);
    }
  }
  open.sort((a, b) => last(b).at - last(a).at);
  const keep = new Set(open.slice(0, 3));
  let asker = 0;
  const standalone = (target: number) => {
    let at = snapBackWork(target, rand);
    for (let i = 0; i < 5 && !hasRoom(ctx, at); i++) at = snapBackWork(startOfLocalDay(at) - MIN, rand);
    countInbound(ctx, at);
    const th = openThread(ctx, contact(STANDALONE_ASKERS[asker++ % STANDALONE_ASKERS.length]!), false, at);
    th.planned = 1;
    th.done = true;
    threads.push(th);
    keep.add(th);
  };
  for (const days of NEEDS_REPLY_AGES_DAYS) {
    const target = now - days * DAY;
    let best: Thread | undefined;
    for (const th of open) {
      if (keep.has(th) || now - last(th).at <= 36 * HOUR) continue;
      if (!best || Math.abs(last(th).at - target) < Math.abs(last(best).at - target)) best = th;
    }
    if (best && Math.abs(last(best).at - target) < 1.5 * DAY) keep.add(best);
    else standalone(target);
  }
  for (const th of open) if (keep.size < NEEDS_REPLY_TOTAL) keep.add(th);
  while (keep.size < NEEDS_REPLY_TOTAL) standalone(now - (3 + rand() * 20) * HOUR);

  for (const th of open) {
    const end = last(th);
    if (keep.has(th)) {
      end.nr = true;
      continue;
    }
    // Answer it late but recently (young, so not "waiting on") when the day still has Sent room.
    const earliest = Math.max(end.at + latency(rand, th.c.mine), now - YOUNG_MS + HOUR);
    let placed = false;
    for (let step = 0; step < 4 && !placed; step++) {
      let at = earliest + step * 9 * HOUR;
      const h = localHour(at);
      if (h < 8 || h >= 21) at = atLocal(h < 8 ? startOfLocalDay(at) : addDays(startOfLocalDay(at), 1), 9, Math.floor(rand() * 60));
      at = sec(at);
      const day = startOfLocalDay(at);
      const sentThatDay = ctx.sentPerDay.get(day) ?? 0;
      if (at > now - 5 * MIN || sentThatDay >= (isWeekend(day) ? 1 : 6)) continue;
      th.turns.push({ out: true, at });
      ctx.sentPerDay.set(day, sentThatDay + 1);
      placed = true;
    }
    if (!placed) end.handoff = true;
  }
  for (const th of threads) if (keep.has(th)) last(th).nr = true;
}

/* ─── Drafts: everything becomes one of these before uids and ids are assigned in date order ─── */

type Kind = "person" | "sent" | "auto" | "transactional" | "newsletter";
type Draft = {
  at: number;
  folder: "INBOX" | "Sent";
  kind: Kind;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  text: string;
  /** Date: header offset (minutes east); undefined = machine local. */
  offset?: number;
  attachments: AttachmentMeta[];
  extra: Record<string, string>;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  prev?: Draft;
  nr?: boolean;
};

const addrOf = (c: { name: string; address: string }): MailAddress => ({ address: c.address, name: c.name });
const firstName = (c: Contact) => c.name.split(" ")[0]!;
const self = (): MailAddress => ({ ...DEV_SELF });
const pickFrom = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const SIGNOFFS = ["Thanks,\n{n}", "— {n}", "Best,\n{n}", "{n}"];

function inbound(at: number, kind: Kind, from: { name: string; address: string }, subject: string, text: string): Draft {
  return {
    at: sec(at), folder: "INBOX", kind, from: addrOf(from), to: [self()], cc: [], subject, text,
    attachments: [], extra: {}, seen: true, flagged: false, answered: false,
  };
}

function humanDrafts(ctx: Ctx, threads: Thread[]): Draft[] {
  const { rand } = ctx;
  const out: Draft[] = [];
  for (const th of threads) {
    const first = firstName(th.c);
    const sign = pickFrom(rand, SIGNOFFS).replace("{n}", first);
    const col = contact(th.c.colleague);
    let prev: Draft | undefined;
    th.turns.forEach((turn, i) => {
      const subject = i === 0 ? th.subject : `Re: ${th.subject}`;
      let draft: Draft;
      if (turn.out) {
        const body = i === 0 ? th.topic.body : pickFrom(rand, MY_REPLIES);
        draft = {
          ...inbound(turn.at, "sent", th.c, subject, `Hi ${first},\n\n${body}`),
          folder: "Sent",
          from: self(),
          to: [addrOf(th.c)],
        };
        if (prev) prev.answered = true;
      } else {
        const body =
          turn.handoff && i > 0
            ? pickFrom(rand, HANDOFFS).replaceAll("{col}", firstName(col))
            : i === 0
              ? th.topic.body
              : turn.nr
                ? pickFrom(rand, FOLLOW_UPS)
                : i === th.turns.length - 1
                  ? pickFrom(rand, CLOSINGS)
                  : pickFrom(rand, THEIR_REPLIES);
        draft = inbound(turn.at, "person", th.c, subject, `${body}\n\n${sign}`);
        draft.offset = th.c.offset;
        draft.nr = turn.nr;
        if (turn.handoff) {
          draft.to = [addrOf(col)];
          draft.cc = [self()];
        }
        if (i === 0 && th.topic.attach) draft.attachments = [{ ...th.topic.attach }];
      }
      draft.prev = prev;
      out.push(draft);
      prev = draft;
    });
  }
  return out;
}

/* ─── Newsletters ─── */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PEOPLE = CONTACTS.filter((c) => c.address.endsWith("northwind.example")).map((c) => c.name);

type Newsletter = {
  slug: string;
  name: string;
  address: string;
  /** Share of issues opened (\Seen). */
  rate: number;
  hour: number;
  on: (dow: number, week: number) => boolean;
  issue: (rand: Rand, n: number, day: Date) => [subject: string, body: string];
};

const NEWSLETTERS: Newsletter[] = [
  {
    slug: "reads-digest", name: "Reads Digest", address: "digest@reads.example", rate: 0.8, hour: 9,
    on: (dow, week) => (week % 3 === 2 ? dow === 1 : dow === 0),
    issue: (rand) => [
      `Weekly roundup: ${intIn(rand, 8, 14)} links worth your time`,
      `This week: ${pickFrom(rand, ["local-first sync patterns", "CRDTs in production", "the case for boring tech"])}, ${pickFrom(rand, ["Postgres query plans", "SQLite on the server", "edge caching myths"])}, and a deep dive on ${pickFrom(rand, ["IMAP IDLE", "JMAP push", "MIME parsing"])}.\n\nRead more →`,
    ],
  },
  {
    slug: "frontend-weekly", name: "Frontend Weekly", address: "hello@frontendweekly.example", rate: 0.1, hour: 15,
    on: (dow) => dow === 2,
    issue: (rand, n) => [
      `Frontend Weekly #${412 + n}: ${pickFrom(rand, ["View transitions in practice", "The state of CSS anchor positioning", "React Compiler, six months in", "Container queries everywhere", "Shipping less JavaScript"])}`,
      "Plus: a new bundler benchmark, accessible comboboxes, and why your LCP image is late.\n\nView this issue in your browser.",
    ],
  },
  {
    slug: "producthunt-daily", name: "Product Hunt Daily", address: "hello@producthunt.example", rate: 0, hour: 7,
    on: () => true,
    issue: (rand) => [
      `Today's top launches: ${pickFrom(rand, ["Inkwell", "Tidy Tabs", "Ferry", "Loom Lens", "Parcel Path", "Quiet Hours", "Stackmap"])} and ${intIn(rand, 4, 9)} more`,
      `The community's favorite launches today, plus ${intIn(rand, 2, 5)} upcoming products worth a follow.\n\nSee all launches →`,
    ],
  },
  {
    slug: "morning-brief", name: "Morning Brief", address: "brief@morningbrief.example", rate: 0.4, hour: 6,
    on: (dow) => dow >= 1 && dow <= 5,
    issue: (rand, _n, day) => [
      `Morning Brief — ${DOW_LONG[day.getDay()]}, ${MON[day.getMonth()]} ${day.getDate()}`,
      `${pickFrom(rand, ["Markets steady ahead of the rate decision", "Chipmakers rally on strong guidance", "Oil slips as supply worries ease"])}. ${pickFrom(rand, ["A new EU privacy ruling for email trackers", "Remote work, four years on", "What the jobs report actually says"])}.\n\n5-minute read.`,
    ],
  },
  {
    slug: "shop-deals", name: "Shop Deals", address: "deals@shop.example", rate: 0, hour: 12,
    on: (dow, week) => dow === 1 || dow === 3 || dow === 5 || dow === 6 || (dow === 2 && week % 2 === 0),
    issue: (rand) => [
      `${pickFrom(rand, [20, 30, 40, 50])}% off ${pickFrom(rand, ["desk lamps", "headphones", "backpacks", "coffee gear", "outerwear"])} — ${pickFrom(rand, ["today only", "ends Sunday", "48 hours left", "members first"])}`,
      "Our biggest markdowns of the season are live. Free shipping over $50.\n\nShop now · Unsubscribe",
    ],
  },
  {
    slug: "design-notes", name: "Design Notes", address: "notes@designnotes.example", rate: 0.6, hour: 11,
    on: (dow) => dow === 4,
    issue: (rand, n) => [
      `Design Notes #${87 + n}: ${pickFrom(rand, ["Density without clutter", "Designing calm notifications", "Type scales that survive dark mode", "The empty state is the product", "Motion that explains"])}`,
      "A short essay, three links, and one thing to try this week.\n\nRead online →",
    ],
  },
];

function hexToken(rand: Rand, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += "0123456789abcdef"[Math.floor(rand() * 16)];
  return out;
}

/* ─── Notifications and transactional mail ─── */

const AUTO = { "auto-submitted": "auto-generated" } as const;

const NOTIFIERS = {
  ci: { name: "CI Bot", address: "ci@github.example" },
  linear: { name: "Linear", address: "notifications@linear.example" },
  slack: { name: "Slack", address: "feedback@slack.example" },
  security: { name: "Accounts Security", address: "security@accounts.example" },
  calendar: { name: "Calendar", address: "calendar-notification@calendar.example" },
} as const;

const SHOPS = {
  stripe: { name: "Stripe", address: "receipts@stripe.example" },
  shipping: { name: "Shop Shipping", address: "shipping@shop.example" },
  fastmail: { name: "Fastmail Billing", address: "billing@fastmail.example" },
  airline: { name: "Skyline Air", address: "tickets@skyline-air.example" },
} as const;

const COMMITS = ["fix: reconnect IMAP after idle timeout", "feat: keyboard triage shortcuts", "chore: bump mailparser", "perf: cache folder counts", "fix: sanitize nested blockquotes", "feat(overview): reply-time chart"];
const BRANCHES = ["feat/raven-overview", "fix/idle-reconnect", "feat/command-palette", "chore/deps"];
const SPECS = ["mail-list.spec.ts", "compose.spec.ts", "reader.spec.ts", "login.spec.ts"];
const ISSUES = ["Unread count lags after bulk archive", "Search ignores quoted phrases", "Attachment upload stalls over 10MB", "Command palette loses focus", "Dark mode contrast on cards", "Offline banner flickers"];
const COMMENTS = ["Repro'd on staging — happens after ~30 min idle.", "Can we ship the quick fix and follow up next cycle?", "Same root cause as the IDLE bug, I think.", "Added a screen recording to the issue."];
const CHANNELS = ["design", "eng", "launch", "support"];
const SLACK_LINES = ["Pushed the new reader spacing — thoughts?", "Standup moved to 10:15 today", "Anyone else seeing slow CI?", "Launch checklist is updated", "Can someone review my PR before lunch?"];
const TEAM = { name: "Team", address: "team@northwind.example" };
const LINEAR_REPLIES = [
  "Fixed in the latest build — please verify on staging when you get a chance.",
  "Taking this one. Should land tomorrow.",
  "Can't reproduce on main anymore; closing after one more check.",
  "Good catch. Adding a regression test with the fix.",
];
const EVENTS = ["Design review", "Q4 planning sync", "1:1 Maya / You", "Customer call: Harbor", "Sprint retro", "Kaizen Studio weekly", "Research readout", "Launch go/no-go"];

type NoteKind = "ci" | "linear" | "slack" | "security";
const NOTE_TEXT: Record<NoteKind, (rand: Rand) => [string, string]> = {
  ci: (rand) => {
    const sha = hexToken(rand, 7);
    const took = `${intIn(rand, 1, 9)}m ${intIn(rand, 10, 59)}s`;
    const roll = rand();
    if (roll < 0.55) return ["Build passing on main", `Workflow “ci” passed in ${took}.\n\nCommit: ${sha} — ${pickFrom(rand, COMMITS)}`];
    if (roll < 0.8) return [`Build failed: e2e on ${pickFrom(rand, BRANCHES)}`, `Workflow “e2e” failed after ${took}.\n\n${intIn(rand, 1, 4)} tests failed in ${pickFrom(rand, SPECS)}. Open the run for logs.`];
    const pr = intIn(rand, 180, 260);
    return [`Deploy preview ready — raven-web #${pr}`, `Preview for PR #${pr} is live at https://raven-web-${sha}.preview.example`];
  },
  linear: (rand) => {
    const id = `RAV-${intIn(rand, 120, 480)}`;
    const issue = pickFrom(rand, ISSUES);
    const who = pickFrom(rand, PEOPLE);
    const roll = rand();
    if (roll < 0.5) return [`[${id}] ${who} commented on “${issue}”`, `${who}: “${pickFrom(rand, COMMENTS)}”\n\nReply in Linear or open the issue.`];
    if (roll < 0.8) return [`[${id}] Assigned to you: ${issue}`, `${who} assigned ${id} to you. Priority: ${pickFrom(rand, ["Urgent", "High", "Medium", "Low"])}.`];
    return [`[${id}] ${issue} moved to Done`, `${who} moved ${id} to Done. The current cycle is ${intIn(rand, 55, 90)}% complete.`];
  },
  slack: (rand) => {
    const who = pickFrom(rand, PEOPLE);
    const channel = pickFrom(rand, CHANNELS);
    return rand() < 0.6
      ? [`New messages in #${channel}`, `${who}: “${pickFrom(rand, SLACK_LINES)}” and ${intIn(rand, 2, 9)} more messages.`]
      : [`${who} mentioned you in #${channel}`, `${who}: “@you ${pickFrom(rand, SLACK_LINES)}”`];
  },
  security: (rand) =>
    pickFrom(rand, [
      ["New sign-in to your account", `We noticed a new sign-in from ${pickFrom(rand, ["Chrome on Windows", "Safari on iPhone", "Firefox on macOS"])}. If this was you, no action is needed.`],
      ["Two-step verification code used", "A verification code was just used to sign in to your account. If this wasn't you, reset your password."],
      ["Your recovery email was confirmed", "Your recovery email address is confirmed. Manage recovery options in your account settings."],
    ] as [string, string][]),
};

function withAuto(draft: Draft): Draft {
  draft.extra = { ...draft.extra, ...AUTO };
  return draft;
}

/** Newsletters, receipts, shipping, billing, e-tickets and calendar invites on fixed weekly rhythms. */
function scheduledDrafts(ctx: Ctx): Draft[] {
  const { now, rand } = ctx;
  const out: Draft[] = [];
  const keep = (draft: Draft) => {
    if (draft.at >= ctx.floor && draft.at <= now) out.push(draft);
  };
  const issues = new Map<string, number>();
  const tokens = new Map(NEWSLETTERS.map((nl) => [nl.slug, hexToken(rand, 16)]));
  for (let d = WINDOW_DAYS - 1; d >= 0; d--) {
    const day = addDays(startOfLocalDay(now), -d);
    const date = new Date(day);
    const dow = date.getDay();
    const week = Math.floor(d / 7);

    for (const nl of NEWSLETTERS) {
      if (!nl.on(dow, week)) continue;
      const at = atLocal(day, nl.hour, intIn(rand, 0, 25), intIn(rand, 0, 59));
      if (at < ctx.floor || at > now) continue;
      const n = issues.get(nl.slug) ?? 0;
      issues.set(nl.slug, n + 1);
      const [subject, body] = nl.issue(rand, n, date);
      const draft = inbound(at, "newsletter", nl, subject, body);
      // Evenly spread opens so each list hits its rate exactly over its issues.
      draft.seen = Math.floor((n + 1) * nl.rate + 0.5) > Math.floor(n * nl.rate + 0.5);
      draft.extra = {
        "list-id": `<${nl.slug}.list.example>`,
        "list-unsubscribe": `<https://${nl.slug}.example/u/${tokens.get(nl.slug)}>, <mailto:unsubscribe@${nl.slug}.example?subject=unsubscribe>`,
        "list-unsubscribe-post": "List-Unsubscribe=One-Click",
        precedence: "bulk",
      };
      keep(draft);
    }

    if (dow === 3) {
      const ref = `${intIn(rand, 1000, 9999)}-${intIn(rand, 1000, 9999)}`;
      const amount = pickFrom(rand, [12, 19, 24, 48, 96]);
      const draft = inbound(slotOn(day, NOTIFY_HOURS, rand), "transactional", SHOPS.stripe, `Your receipt from Raven Cloud #${ref}`, `Amount paid: $${amount}.00\nDate paid: ${MON[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}\nPayment method: Visa ending in 4242\n\nA PDF copy of this receipt is attached.`);
      draft.attachments = [pdf(`receipt-${ref}.pdf`, intIn(rand, 40_960, 204_800))];
      keep(withAuto(draft));
    }
    if ((dow === 2 && week % 2 === 1) || (dow === 5 && week % 3 === 0)) {
      const order = intIn(rand, 40_000, 49_999);
      keep(withAuto(inbound(slotOn(day, NOTIFY_HOURS, rand), "transactional", SHOPS.shipping, `Your order #${order} has shipped`, `Good news — order #${order} is on its way.\n\nTracking: 1Z999AA1${intIn(rand, 10_000_000, 99_999_999)}\nEstimated delivery: ${DOW_LONG[(dow + 3) % 7]}.`)));
    }
    if (date.getDate() === 3) {
      const invoice = 1900 + date.getMonth();
      const draft = inbound(atLocal(day, 5, intIn(rand, 0, 59)), "transactional", SHOPS.fastmail, `Invoice #${invoice} — payment received`, `We received your payment of $48.00 for invoice #${invoice}.\n\nThe invoice PDF is attached. Thank you for your business.`);
      draft.attachments = [pdf(`invoice-${invoice}.pdf`, intIn(rand, 45_000, 52_000))];
      keep(withAuto(draft));
    }
    if (d === 26 || d === 9) {
      const pnr = hexToken(rand, 6).toUpperCase();
      const route = d === 26 ? "LOS → LIS" : "LIS → LOS";
      const draft = inbound(slotOn(day, NOTIFY_HOURS, rand), "transactional", SHOPS.airline, `Your e-ticket receipt — ${route}`, `Booking reference: ${pnr}\nFlight SK ${intIn(rand, 200, 899)}, ${route}\n\nYour e-ticket receipt is attached. Online check-in opens 24 hours before departure.`);
      draft.attachments = [pdf(`e-ticket-${pnr}.pdf`, intIn(rand, 1_480_000, 1_560_000))];
      keep(withAuto(draft));
    }

    // Non-human Sent mail (team alias, Linear reply-by-email) carries part of each day's Sent range,
    // so fewer people threads have to end inside the needs-reply window.
    if (dow === 5 || (dow === 2 && week % 2 === 0)) {
      const at = slotOn(day, dow === 5 ? [[15, 1], [16, 2], [17, 1]] : [[10, 1], [11, 1], [14, 1]], rand);
      const [subject, body] =
        dow === 5
          ? [`Weekly update — ${MON[date.getMonth()]} ${date.getDate()}`, `Hi all,\n\nShipped: ${pickFrom(rand, COMMITS)}. In progress: search ranking and the overview page. Blocked: nothing this week.\n\nHave a good weekend!`]
          : [`Release notes: ${pickFrom(rand, ["keyboard triage", "faster folder counts", "calmer notifications", "attachment previews"])}`, "Hi all,\n\nA new build is on staging. Highlights and known issues are in the changelog doc. Shout if anything looks off."];
      if (at >= ctx.floor && at <= now) {
        out.push({ ...inbound(at, "sent", TEAM, subject, body), folder: "Sent", from: self(), to: [addrOf(TEAM)] });
        ctx.sentPerDay.set(day, (ctx.sentPerDay.get(day) ?? 0) + 1);
      }
    }
    if (dow >= 1 && dow <= 5 && rand() < 0.45) {
      const [subject, body] = NOTE_TEXT.linear(rand);
      const note = withAuto(inbound(slotOn(day, NOTIFY_HOURS, rand), "auto", NOTIFIERS.linear, subject, body));
      keep(note);
      const replyAt = sec(note.at + (10 + rand() * 80) * MIN);
      if (rand() < 0.6 && out.includes(note) && replyAt <= now && localHour(replyAt) < 19 && startOfLocalDay(replyAt) === day) {
        note.answered = true;
        const text = pickFrom(rand, LINEAR_REPLIES);
        out.push({ ...inbound(replyAt, "sent", NOTIFIERS.linear, `Re: ${subject}`, text), folder: "Sent", from: self(), to: [addrOf(NOTIFIERS.linear)], prev: note });
        ctx.sentPerDay.set(day, (ctx.sentPerDay.get(day) ?? 0) + 1);
      }
    }

    if (dow === 1 || dow === 3 || dow === 4 || (dow === 2 && week % 2 === 1)) {
      const event = pickFrom(rand, EVENTS);
      const when = new Date(addDays(day, intIn(rand, 1, 6)));
      const hour = intIn(rand, 9, 16);
      const range = `${hour}:00 – ${hour + 1}:00`;
      const draft = inbound(slotOn(day, MORNING, rand), "auto", NOTIFIERS.calendar, `Invitation: ${event} @ ${DOW[when.getDay()]} ${MON[when.getMonth()]} ${when.getDate()}, ${range}`, `${pickFrom(rand, PEOPLE)} has invited you to “${event}”.\n\nWhen: ${DOW_LONG[when.getDay()]} ${MON[when.getMonth()]} ${when.getDate()}, ${range}\nWhere: Video call\n\nGoing? Yes · Maybe · No`);
      draft.attachments = [{ filename: "invite.ics", contentType: "text/calendar", size: intIn(rand, 1850, 2150) }];
      keep(withAuto(draft));
      // RSVP by email: Sent mail to a machine address, so it can never read as "waiting on".
      const rsvpAt = sec(draft.at + (5 + rand() * 115) * MIN);
      if (rand() < 0.85 && out.includes(draft) && rsvpAt <= now && localHour(rsvpAt) < 19 && startOfLocalDay(rsvpAt) === day) {
        draft.answered = true;
        const rsvp = inbound(rsvpAt, "sent", NOTIFIERS.calendar, `Accepted: ${draft.subject.replace(/^Invitation: /, "")}`, "Accepted — see you there.");
        out.push({ ...rsvp, folder: "Sent", from: self(), to: [addrOf(NOTIFIERS.calendar)], prev: draft });
        ctx.sentPerDay.set(day, (ctx.sentPerDay.get(day) ?? 0) + 1);
      }
    }
  }
  return out;
}

/** Top each day up to its inbound target (weekdays 10–16, weekends 3–6) with bot notifications. */
function notificationFill(ctx: Ctx, drafts: Draft[]): Draft[] {
  const { now, rand } = ctx;
  const perDay = new Map<number, number>();
  for (const d of drafts) {
    if (d.folder !== "INBOX") continue;
    const key = startOfLocalDay(d.at);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const out: Draft[] = [];
  for (let d = WINDOW_DAYS - 1; d >= 0; d--) {
    const day = addDays(startOfLocalDay(now), -d);
    const weekend = isWeekend(day);
    const target = weekend ? intIn(rand, 3, 6) : intIn(rand, 10, 16);
    for (let n = target - (perDay.get(day) ?? 0); n > 0; n--) {
      const kind = pickWeighted<NoteKind>(
        rand,
        weekend
          ? [["ci", 1], ["linear", 0.3], ["slack", 0.6], ["security", 0.3]]
          : [["ci", 4], ["linear", 3], ["slack", 2], ["security", 0.3]],
      );
      const at = slotOn(day, NOTIFY_HOURS, rand);
      const [subject, body] = NOTE_TEXT[kind](rand);
      if (at >= ctx.floor && at <= now) out.push(withAuto(inbound(at, "auto", NOTIFIERS[kind], subject, body)));
    }
  }
  return out;
}

/* ─── Flags, ids, headers ─── */

function applyFlags(drafts: Draft[]): void {
  const newestFirst = (kind: Kind) => drafts.filter((d) => d.kind === kind).sort((a, b) => b.at - a.at);
  for (const d of newestFirst("person").slice(0, 6)) d.seen = false;
  for (const d of newestFirst("auto").slice(0, 4)) d.seen = false;
  for (const d of newestFirst("transactional").slice(0, 1)) d.seen = false;
  for (const d of drafts) {
    if (d.kind === "person" && d.attachments.some((a) => a.filename === "contract.pdf" || a.filename === "deck.pdf")) {
      d.flagged = true;
    }
  }
  const oldestAsk = drafts.filter((d) => d.nr).sort((a, b) => a.at - b.at)[0];
  if (oldestAsk) oldestAsk.flagged = true;
  const ticket = newestFirst("transactional").find((d) => d.from.address === SHOPS.airline.address);
  if (ticket) ticket.flagged = true;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (text: string) => `<p>${escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
const formatAddress = (a: MailAddress) => (a.name ? `${a.name} <${a.address}>` : a.address);
const localOffset = (t: number) => -new Date(t).getTimezoneOffset();

/** RFC 2822 date in the writer's zone, e.g. "Thu, 24 Sep 2026 09:12:00 +0900". */
function rfc2822(t: number, offsetMin: number): string {
  const d = new Date(t + offsetMin * MIN);
  const pad = (n: number) => String(n).padStart(2, "0");
  const abs = Math.abs(offsetMin);
  const zone = `${offsetMin < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
  return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${zone}`;
}

/** RFC 2822 Date: header, in the machine's zone unless an offset is given. */
export function dateHeader(t: number, offsetMin: number = localOffset(t)): string {
  return rfc2822(t, offsetMin);
}

/** uids and Message-IDs follow arrival order across both folders, so uids are unique store-wide. */
function finalize(drafts: Draft[]): MailMessage[] {
  const ordered = [...drafts].sort((a, b) => a.at - b.at);
  const ids = new Map<Draft, string>();
  ordered.forEach((d, i) => {
    ids.set(d, `<gen-${i + 1}@${d.folder === "Sent" ? "localhost" : d.from.address.split("@")[1]}>`);
  });
  return ordered.map((d, i): MailMessage => {
    const messageId = ids.get(d)!;
    const references: string[] = [];
    for (let p = d.prev; p; p = p.prev) references.unshift(ids.get(p)!);
    const inReplyTo = d.prev ? ids.get(d.prev) : undefined;
    const headers: Record<string, string> = {
      from: formatAddress(d.from),
      to: d.to.map(formatAddress).join(", "),
      subject: d.subject,
      date: rfc2822(d.at, d.offset ?? localOffset(d.at)),
      "message-id": messageId,
      ...d.extra,
      "x-dev-mode": "true",
    };
    if (d.cc.length) headers.cc = d.cc.map(formatAddress).join(", ");
    if (inReplyTo) headers["in-reply-to"] = inReplyTo;
    if (references.length) headers.references = references.join(" ");
    return {
      uid: String(1000 + i),
      folder: d.folder,
      subject: d.subject,
      from: d.from,
      to: d.to,
      cc: d.cc,
      bcc: [],
      date: new Date(d.at).toISOString(),
      flags: { seen: d.seen, flagged: d.flagged, answered: d.answered, draft: false },
      text: d.text,
      html: toHtml(d.text),
      attachments: d.attachments,
      messageId,
      ...(inReplyTo ? { inReplyTo, references } : {}),
      headers,
    };
  });
}

export function generateSyntheticMail(opts: { now?: number; seed?: number } = {}): MailMessage[] {
  const now = opts.now ?? Date.now();
  const rand = mulberry32(opts.seed ?? DEFAULT_SEED);
  const ctx: Ctx = { now, floor: now - WINDOW_DAYS * DAY, rand, cursor: new Map(), sentPerDay: new Map(), inPerDay: new Map() };
  // Scheduled mail first: it claims each day's Inbox/Sent room before people threads fill the rest.
  const scheduled = scheduledDrafts(ctx);
  for (const d of scheduled) if (d.folder === "INBOX") countInbound(ctx, d.at);
  const threads = simulate(ctx);
  settle(ctx, threads);
  const drafts = [...humanDrafts(ctx, threads), ...scheduled];
  drafts.push(...notificationFill(ctx, drafts));
  applyFlags(drafts);
  return finalize(drafts);
}
