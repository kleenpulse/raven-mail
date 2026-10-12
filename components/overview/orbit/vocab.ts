import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { SenderStat } from "@/lib/insights/types";
import type { TriageCategory } from "@/lib/mail/types";
import { describeSender, MAIL_FOCUS } from "./drilldown";
import { formatAgo, formatAgoLong } from "./format";
import { CATEGORY_LABEL, type FocusCardId } from "./layout";

export type FocusCardSpec = { id: FocusCardId; icon: LucideIcon; value: string; label: string; spoken: string };

/**
 * What the drilldown shows for one node. Card ids are layout slots; the first
 * card owns the row list (mail: latest threads), the others open a panel.
 */
export type OrbitFocus = {
	/** 1–5 cards. */
	cards: (s: SenderStat, now: number | null) => FocusCardSpec[];
	/** Up to 5 fixed-height rows. */
	rows: (s: SenderStat, now: number | null) => { key: string; node: React.ReactNode }[];
	rowsTitle: (s: SenderStat) => string;
	rowsNote: (s: SenderStat) => string | null;
	emptyRows: string;
	panel: (s: SenderStat, id: FocusCardId, now: number | null) => React.ReactNode;
	/** Generous panel heights, for keeping a panel inside the stage. */
	panelHeight: Partial<Record<FocusCardId, number>>;
	/** Pill under the orb. */
	chip: (s: SenderStat) => string;
	ringCaption: string;
};

/**
 * Every word Orbit says. Mail is the default; other domains (the dev test
 * board) reuse the constellation by swapping the vocabulary — the geometry
 * never changes. Complete, not Partial, so a new string can't silently mix
 * two domains.
 */
export type OrbitVocab = {
	/** Label on the sun. */
	sun: string;
	/** What a node's value counts: "email" / "emails". */
	unit: readonly [one: string, many: string];
	/** What a ring-2 node is: "sender" / "senders". */
	node: readonly [one: string, many: string];
	/** What a ring-1 node is: "category" / "categories". */
	group: readonly [one: string, many: string];
	/** Uncountable total, as in "12% of mail". */
	mass: string;
	categoryLabel: Readonly<Record<TriageCategory, string>>;
	/** The attention flag carried in `SenderStat.unread`. */
	flag: { label: string; chip: string; clear: string };
	/** Time-range toggle over `SenderStat.weekly`; null hides it. */
	period: {
		all: { label: string; spoken: string };
		weeks: readonly (readonly [label: string, spoken: string])[];
	} | null;
	/** Window phrases: "30 days", "week 2". */
	window: { all: string; week: (index: number) => string };
	legend: { person: string; machine: string; ring: string; hint: string };
	srHint: string;
	sceneLabel: string;
	empty: { title: string; body: string };
	/** Tooltip line, e.g. "Last contact 3h ago". */
	recency: (s: SenderStat, now: number) => string;
	/** Spoken, e.g. "last contact 3 hours ago". */
	recencyLong: (s: SenderStat, now: number) => string;
	/** Compact list cell. */
	ago: (s: SenderStat, now: number) => string;
	/** Announcement when a node opens. */
	describe: (s: SenderStat, now: number | null) => string;
	focus: OrbitFocus;
	/** A full view behind a "View all" button under the drilldown's rows. */
	expand?: { label: (s: SenderStat) => string; render: (s: SenderStat) => React.ReactNode };
};

export const MAIL_VOCAB: OrbitVocab = {
	sun: "You",
	unit: ["email", "emails"],
	node: ["sender", "senders"],
	group: ["category", "categories"],
	mass: "mail",
	categoryLabel: CATEGORY_LABEL,
	flag: { label: "unread", chip: "new", clear: "All read" },
	period: {
		all: { label: "All", spoken: "All 30 days" },
		weeks: [
			["W1", "Week 1, the oldest"],
			["W2", "Week 2"],
			["W3", "Week 3"],
			["W4", "Week 4, the most recent"],
		],
	},
	window: { all: "30 days", week: (i) => `week ${i + 1}` },
	legend: { person: "People", machine: "Services", ring: "Ring around you: mail per day, 30 days", hint: "Select a sender to focus" },
	srHint: "Arrow keys move between senders. Enter opens a sender. Escape returns.",
	sceneLabel: "Senders in your orbit",
	empty: {
		title: "Nothing in orbit yet",
		body: "When mail arrives, the people and services who write to you most will circle here, grouped by category.",
	},
	recency: (s, now) => `Last contact ${formatAgo(s.lastAt, now)}`,
	recencyLong: (s, now) => `last contact ${formatAgoLong(s.lastAt, now)}`,
	ago: (s, now) => formatAgo(s.lastAt, now),
	describe: describeSender,
	focus: MAIL_FOCUS,
};

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
