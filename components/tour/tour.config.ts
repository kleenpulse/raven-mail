import { TOUR_TARGET, tourSelector } from "./anchors";

// The step registry. Plain isomorphic module — imported by the client engine
// AND by scripts/generate-tour-audio.ts (bun), so no "use client" and no React
// here. `body` is both the visible copy and the narration script: the audio
// hash derives from it, so after editing copy re-run `bun run tour:audio` to
// keep voice and text in lockstep.

export type TourStepId =
	| "welcome"
	| "hero-ask"
	| "needs-reply"
	| "orbit"
	| "nav-mail"
	| "mail-list"
	| "search"
	| "compose"
	| "nav-integrations"
	| "nav-settings"
	| "finish";

export type TourSide = "top" | "bottom" | "left" | "right" | "over";

export type TourStep = {
	id: TourStepId;
	title: string;
	body: string;
	selector?: string;
	/** Placement on phones, where the rail becomes a bottom tab bar. */
	mobileSide?: TourSide;
	route?: string;
	side?: TourSide;
	/** Reveal body text in sync with narration (or timer-paced fallback). */
	typewriter?: boolean;
	/** Play the pre-generated narration clip for this step. */
	tts?: boolean;
	/** Offer the GB/US accent switch in this step's popover. */
	voicePicker?: boolean;
	/** If set, the anchor poll gives up after this many ms and the step is skipped. */
	pollTimeoutMs?: number;
};

export const TOUR_STEPS: TourStep[] = [
	{
		id: "welcome",
		title: "Welcome to Raven",
		body: "Welcome to Raven. It's your inbox, with a helper named Jev. This takes about a minute, and you can skip it anytime.",
		typewriter: true,
		tts: true,
		voicePicker: true,
		route: "/overview",
	},
	{
		id: "hero-ask",
		title: "Ask Jev",
		body: "Ask Jev about your mail in plain words, like who's waiting on you or what to answer first. Press Control K to open it from any page.",
		typewriter: true,
		tts: true,
		route: "/overview",
		selector: tourSelector(TOUR_TARGET.heroAsk),
		side: "bottom",
	},
	{
		id: "needs-reply",
		title: "Who's waiting on you",
		body: "This card shows the threads that need your reply, and the ones where you're waiting on someone else.",
		typewriter: true,
		tts: true,
		route: "/overview",
		selector: tourSelector(TOUR_TARGET.needsReply),
		side: "right",
		mobileSide: "top",
		pollTimeoutMs: 12_000,
	},
	{
		id: "orbit",
		title: "Your orbit",
		body: "Your orbit is a map of who writes to you. You're in the middle, the types of mail you get circle around you, and your top senders sit on the outer ring. Pick anyone to take a closer look. On a phone, it starts as a list.",
		typewriter: true,
		tts: true,
		route: "/overview",
		selector: tourSelector(TOUR_TARGET.orbit),
		side: "top",
		pollTimeoutMs: 12_000,
	},
	{
		id: "nav-mail",
		title: "Mail",
		body: "Mail is your full inbox. Your folders and all your messages live here.",
		typewriter: true,
		tts: true,
		selector: tourSelector(TOUR_TARGET.navMail),
		side: "right",
		mobileSide: "top",
	},
	{
		id: "mail-list",
		title: "Your messages",
		body: "Pick a message to read it. You can also archive or delete mail right from the list.",
		typewriter: true,
		tts: true,
		route: "/mail",
		selector: tourSelector(TOUR_TARGET.mailList),
		side: "right",
		mobileSide: "over",
		pollTimeoutMs: 12_000,
	},
	{
		id: "search",
		title: "Search",
		body: "Search the folder you're in. It checks the sender, the subject, and the message text.",
		typewriter: true,
		tts: true,
		route: "/mail",
		selector: tourSelector(TOUR_TARGET.search),
		side: "bottom",
	},
	{
		id: "compose",
		title: "Write",
		body: "Start a new message here. On a keyboard, you can just press C.",
		typewriter: true,
		tts: true,
		selector: tourSelector(TOUR_TARGET.compose),
		side: "right",
		mobileSide: "top",
	},
	{
		id: "nav-integrations",
		title: "Integrations",
		body: "Integrations can send mail to Slack, Discord, or your own webhooks. You can also export your whole mailbox from here.",
		typewriter: true,
		tts: true,
		selector: tourSelector(TOUR_TARGET.navIntegrations),
		side: "right",
		mobileSide: "top",
	},
	{
		id: "nav-settings",
		title: "Settings",
		body: "Settings is where you change how Raven works. You can also change this voice or take the tour again.",
		typewriter: true,
		tts: true,
		selector: tourSelector(TOUR_TARGET.navSettings),
		side: "right",
		mobileSide: "top",
	},
	{
		id: "finish",
		title: "You're all set",
		body: "That's the tour. Now go clear something off your list.",
		typewriter: true,
		tts: true,
		route: "/overview",
	},
];
