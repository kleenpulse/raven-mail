import type { MixBucket, SenderStat, ThreadRef } from "@/lib/insights/types";
import type { TriageCategory } from "@/lib/mail/types";

/*
 * Orbit preview data. Deterministic for a given `now`: daily sums to count,
 * weekly is derived from daily, and the newest thread matches lastAt.
 * UIDs 90–101 (INBOX) and 60 (Archive) exist in the dev mailbox, so those
 * deep links open real messages.
 */

const HOUR = 3_600_000;
const DAYS = 30;

type Pattern = "people" | "daily" | "weekly" | "burst" | "sparse";

type Spec = {
	name: string;
	address: string;
	category: TriageCategory;
	bucket: MixBucket;
	count: number;
	unread: number;
	pattern: Pattern;
	sentToThem?: number;
	yourReplyMedianMin?: number | null;
	theirReplyMedianMin?: number | null;
	needsReply?: number;
	tzOffsetMin?: number;
	/** Newest first; the first entry defines lastAt. */
	threads: { subject: string; hoursAgo: number; uid: number; folder?: string; dev?: boolean }[];
};

const SPECS: Spec[] = [
	{
		name: "CI Bot",
		address: "ci@github.example",
		category: "updates",
		bucket: "notifications",
		count: 48,
		unread: 14,
		pattern: "daily",
		threads: [
			{ subject: "Deploy preview ready — raven#412", hoursAgo: 5, uid: 196 },
			{ subject: "Checks failed on feat/raven-overview", hoursAgo: 19, uid: 188 },
			{ subject: "Build passing on main", hoursAgo: 120, uid: 91, dev: true },
		],
	},
	{
		name: "Maya Chen",
		address: "maya.chen@northwind.example",
		category: "primary",
		bucket: "people",
		count: 34,
		unread: 2,
		pattern: "people",
		sentToThem: 12,
		yourReplyMedianMin: 130,
		theirReplyMedianMin: 52,
		needsReply: 2,
		tzOffsetMin: -420,
		threads: [
			{ subject: "Q3 roadmap — need your sign-off by Friday", hoursAgo: 1, uid: 101, dev: true },
			{ subject: "Pricing experiments: keep the two-week beta?", hoursAgo: 27, uid: 184 },
			{ subject: "Re: Hiring loop for the platform role", hoursAgo: 52, uid: 171 },
			{ subject: "Offsite agenda — draft 2", hoursAgo: 97, uid: 150 },
		],
	},
	{
		name: "Linear",
		address: "notifications@linear.example",
		category: "updates",
		bucket: "notifications",
		count: 29,
		unread: 6,
		pattern: "daily",
		threads: [
			{ subject: "RAV-212 moved to In Review", hoursAgo: 3, uid: 197 },
			{ subject: "RAV-208 was assigned to you", hoursAgo: 28, uid: 182 },
			{ subject: "Weekly project update: Raven", hoursAgo: 75, uid: 160 },
		],
	},
	{
		name: "Sam Okafor",
		address: "sam.okafor@northwind.example",
		category: "primary",
		bucket: "people",
		count: 26,
		unread: 1,
		pattern: "people",
		sentToThem: 9,
		yourReplyMedianMin: 45,
		theirReplyMedianMin: 180,
		needsReply: 1,
		tzOffsetMin: 60,
		threads: [
			{ subject: "Design critique notes + open questions", hoursAgo: 26, uid: 98, dev: true },
			{ subject: "Figma: nav rail v3", hoursAgo: 49, uid: 169 },
			{ subject: "Re: Motion tokens", hoursAgo: 121, uid: 140 },
		],
	},
	{
		name: "Shop Deals",
		address: "deals@shop.example",
		category: "promotions",
		bucket: "newsletters",
		count: 22,
		unread: 14,
		pattern: "burst",
		threads: [
			{ subject: "50% off Spring sale — today only", hoursAgo: 96, uid: 92, dev: true },
			{ subject: "Your cart misses you", hoursAgo: 142, uid: 132 },
			{ subject: "New arrivals picked for you", hoursAgo: 190, uid: 110 },
		],
	},
	{
		name: "Slack",
		address: "notification@slack.example",
		category: "social",
		bucket: "notifications",
		count: 19,
		unread: 4,
		pattern: "people",
		threads: [
			{ subject: "3 new messages in #design", hoursAgo: 2, uid: 199 },
			{ subject: "Omar mentioned you in #eng", hoursAgo: 29, uid: 181 },
		],
	},
	{
		name: "Lina Duarte",
		address: "lina@duarte.studio",
		category: "primary",
		bucket: "people",
		count: 17,
		unread: 1,
		pattern: "people",
		sentToThem: 6,
		yourReplyMedianMin: 380,
		theirReplyMedianMin: 95,
		needsReply: 1,
		tzOffsetMin: 60,
		threads: [
			{ subject: "Brand refresh — final logo files", hoursAgo: 9, uid: 193 },
			{ subject: "Invoice for the September sprint", hoursAgo: 60, uid: 165 },
			{ subject: "Quick call Thursday?", hoursAgo: 130, uid: 136 },
		],
	},
	{
		name: "Team Notifications",
		address: "notifications@team.example",
		category: "updates",
		bucket: "notifications",
		count: 17,
		unread: 3,
		pattern: "daily",
		threads: [
			{ subject: "Alex mentioned you in “Launch checklist”", hoursAgo: 52, uid: 95, dev: true },
			{ subject: "Weekly digest: 12 updates", hoursAgo: 140, uid: 131 },
		],
	},
	{
		name: "Jordan Lee",
		address: "jordan.lee@northwind.example",
		category: "primary",
		bucket: "people",
		count: 14,
		unread: 0,
		pattern: "people",
		sentToThem: 7,
		yourReplyMedianMin: 25,
		theirReplyMedianMin: 12,
		tzOffsetMin: -240,
		threads: [
			{ subject: "Lunch Thursday?", hoursAgo: 80, uid: 93, dev: true },
			{ subject: "Re: Standup notes", hoursAgo: 101, uid: 146 },
		],
	},
	{
		name: "Stripe",
		address: "receipts@stripe.example",
		category: "receipts",
		bucket: "transactions",
		count: 12,
		unread: 0,
		pattern: "sparse",
		threads: [
			{ subject: "Your receipt from Raven Labs #2231-9042", hoursAgo: 31, uid: 180 },
			{ subject: "A payout of $4,210.00 is on the way", hoursAgo: 80, uid: 157 },
			{ subject: "Your receipt from Vercel #1841", hoursAgo: 150, uid: 125 },
		],
	},
	{
		name: "Priya Raman",
		address: "priya@raman.dev",
		category: "primary",
		bucket: "people",
		count: 11,
		unread: 1,
		pattern: "people",
		sentToThem: 3,
		yourReplyMedianMin: null,
		theirReplyMedianMin: 240,
		tzOffsetMin: 330,
		threads: [
			{ subject: "Conference talk: slides review", hoursAgo: 34, uid: 178 },
			{ subject: "Re: Pairing next week", hoursAgo: 150, uid: 126 },
		],
	},
	{
		name: "Airline Offers",
		address: "offers@skyways.example",
		category: "promotions",
		bucket: "newsletters",
		count: 10,
		unread: 6,
		pattern: "burst",
		threads: [
			{ subject: "Fall fares from $89", hoursAgo: 99, uid: 151 },
			{ subject: "Members-only lounge pass", hoursAgo: 200, uid: 108 },
		],
	},
	{
		name: "Reads Digest",
		address: "digest@reads.example",
		category: "newsletters",
		bucket: "newsletters",
		count: 9,
		unread: 7,
		pattern: "weekly",
		threads: [
			{ subject: "Weekly roundup: 12 links worth your time", hoursAgo: 30, uid: 97, dev: true },
			{ subject: "The local-first issue", hoursAgo: 198, uid: 112 },
		],
	},
	{
		name: "Shop Shipping",
		address: "shipping@shop.example",
		category: "receipts",
		bucket: "transactions",
		count: 9,
		unread: 1,
		pattern: "sparse",
		threads: [
			{ subject: "Your order has shipped", hoursAgo: 49, uid: 96, dev: true },
			{ subject: "Out for delivery today", hoursAgo: 100, uid: 147 },
		],
	},
	{
		name: "Omar Haddad",
		address: "omar@haddad.io",
		category: "primary",
		bucket: "people",
		count: 8,
		unread: 0,
		pattern: "people",
		sentToThem: 2,
		yourReplyMedianMin: 900,
		theirReplyMedianMin: null,
		tzOffsetMin: 180,
		threads: [
			{ subject: "Re: API rate limits", hoursAgo: 110, uid: 143 },
			{ subject: "Intro: Omar ↔ Dev", hoursAgo: 300, uid: 88 },
		],
	},
	{
		name: "Community Forum",
		address: "forum@community.example",
		category: "social",
		bucket: "notifications",
		count: 7,
		unread: 3,
		pattern: "sparse",
		threads: [
			{ subject: "Your post got 14 replies", hoursAgo: 40, uid: 175 },
			{ subject: "Weekly highlights from the forum", hoursAgo: 190, uid: 111 },
		],
	},
	{
		name: "Accounts Security",
		address: "no-reply@accounts.example",
		category: "updates",
		bucket: "notifications",
		count: 6,
		unread: 1,
		pattern: "sparse",
		threads: [
			{ subject: "Security alert: new sign-in to your account", hoursAgo: 3, uid: 100, dev: true },
			{ subject: "Password reset requested", hoursAgo: 140, uid: 90, dev: true },
		],
	},
	{
		name: "Frontend Weekly",
		address: "hello@frontendweekly.example",
		category: "newsletters",
		bucket: "newsletters",
		count: 5,
		unread: 5,
		pattern: "weekly",
		threads: [
			{ subject: "Issue #412: View transitions in practice", hoursAgo: 55, uid: 166 },
			{ subject: "Issue #411: CSS anchor positioning", hoursAgo: 223, uid: 105 },
		],
	},
	{
		name: "Billing",
		address: "billing@fastmail.example",
		category: "receipts",
		bucket: "transactions",
		count: 5,
		unread: 0,
		pattern: "sparse",
		threads: [
			{ subject: "Invoice #1842 — payment received", hoursAgo: 7, uid: 99, dev: true },
			{ subject: "Invoice #1791 — payment received", hoursAgo: 390, uid: 76 },
		],
	},
	{
		name: "SaaS Renewals",
		address: "renewals@saas.example",
		category: "updates",
		bucket: "transactions",
		count: 4,
		unread: 1,
		pattern: "sparse",
		threads: [{ subject: "Renewal notice — action required", hoursAgo: 73, uid: 94, dev: true }],
	},
	{
		name: "CFP Committee",
		address: "cfp@events.example",
		category: "other",
		bucket: "people",
		count: 3,
		unread: 0,
		pattern: "sparse",
		sentToThem: 1,
		yourReplyMedianMin: 610,
		theirReplyMedianMin: 2880,
		threads: [{ subject: "Conference talk accepted 🎉", hoursAgo: 200, uid: 60, folder: "Archive", dev: true }],
	},
];

/** Mail in each category beyond the top senders (the long tail). */
const TAIL: Record<TriageCategory, number> = {
	primary: 16,
	updates: 38,
	receipts: 11,
	promotions: 27,
	newsletters: 14,
	social: 9,
	other: 6,
};

function seeded(text: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	let a = h >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function weightFor(pattern: Pattern, day: number, rand: () => number): number {
	const weekday = day % 7 < 5;
	const jitter = 0.55 + rand() * 0.9;
	switch (pattern) {
		case "people":
			return (weekday ? 1 : 0.12) * (0.6 + day / DAYS) * jitter;
		case "daily":
			return (weekday ? 1 : 0.55) * jitter;
		case "weekly":
			return day % 7 === 2 ? 1 : 0;
		case "burst":
			return day % 9 === 4 || day % 9 === 5 ? 1.6 * jitter : 0.08 * jitter;
		case "sparse":
			return rand() < 0.3 ? jitter : 0;
	}
}

function distribute(count: number, weights: number[]): number[] {
	const total = weights.reduce((a, b) => a + b, 0) || 1;
	const raw = weights.map((w) => (count * w) / total);
	const out = raw.map(Math.floor);
	let left = count - out.reduce((a, b) => a + b, 0);
	const order = raw.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem || b.i - a.i);
	for (const { i } of order) {
		if (left <= 0) break;
		out[i]! += 1;
		left -= 1;
	}
	return out;
}

function dailyFor(spec: Spec): number[] {
	const rand = seeded(spec.address);
	const lastIdx = DAYS - 1 - Math.floor(spec.threads[0]!.hoursAgo / 24);
	const weights = Array.from({ length: DAYS }, (_, day) => (day > lastIdx ? 0 : weightFor(spec.pattern, day, rand)));
	// Every thread we list happened on some day; make sure those days carry mail.
	for (const t of spec.threads) {
		const idx = DAYS - 1 - Math.floor(t.hoursAgo / 24);
		if (idx >= 0 && idx <= lastIdx) weights[idx] = Math.max(weights[idx]!, 0.9);
	}
	const daily = distribute(spec.count, weights);
	if (daily[lastIdx] === 0) {
		const donor = daily.indexOf(Math.max(...daily));
		daily[donor]! -= 1;
		daily[lastIdx]! += 1;
	}
	return daily;
}

/** Four most recent 7-day buckets, oldest → newest. */
function weeklyFrom(daily: number[]): number[] {
	return [0, 1, 2, 3].map((w) => {
		const start = DAYS - 28 + w * 7;
		return daily.slice(start, start + 7).reduce((a, b) => a + b, 0);
	});
}

export type OrbitFixtures = {
	senders: SenderStat[];
	categories: { category: TriageCategory; count: number }[];
};

export function orbitFixtures(now: number = Date.now()): OrbitFixtures {
	const anchor = Math.floor(now / HOUR) * HOUR;
	const senders: SenderStat[] = SPECS.map((spec) => {
		const from = { name: spec.name, address: spec.address };
		const recent: ThreadRef[] = spec.threads.map((t) => ({
			folder: t.folder ?? "INBOX",
			uid: String(t.uid),
			messageId: t.dev ? `<dev-${t.uid}@localhost>` : `<${t.uid}.${spec.address.split("@")[0]}@${spec.address.split("@")[1]}>`,
			subject: t.subject,
			from,
			date: new Date(anchor - t.hoursAgo * HOUR).toISOString(),
			ageHours: t.hoursAgo,
		}));
		const daily = dailyFor(spec);
		return {
			address: spec.address,
			name: spec.name,
			domain: spec.address.split("@")[1]!,
			category: spec.category,
			bucket: spec.bucket,
			count: spec.count,
			unread: spec.unread,
			sentToThem: spec.sentToThem ?? 0,
			lastAt: recent[0]!.date,
			daily,
			weekly: weeklyFrom(daily),
			yourReplyMedianMin: spec.yourReplyMedianMin ?? null,
			theirReplyMedianMin: spec.theirReplyMedianMin ?? null,
			needsReply: spec.needsReply ?? 0,
			...(spec.tzOffsetMin === undefined ? {} : { tzOffsetMin: spec.tzOffsetMin }),
			recent,
		};
	}).sort((a, b) => b.count - a.count);

	const totals = new Map<TriageCategory, number>();
	for (const s of senders) totals.set(s.category, (totals.get(s.category) ?? 0) + s.count);
	const categories = (Object.keys(TAIL) as TriageCategory[]).map((category) => ({
		category,
		count: (totals.get(category) ?? 0) + TAIL[category],
	}));

	return { senders, categories };
}

/** Edge-case sets for the lab and tests. */
export function orbitEdgeCases(now: number = Date.now()) {
	const { senders } = orbitFixtures(now);
	const primary = senders.filter((s) => s.category === "primary");
	return {
		singleCategory: {
			senders: primary,
			categories: [{ category: "primary" as const, count: primary.reduce((a, s) => a + s.count, 0) + 12 }],
		},
		oneSender: {
			senders: senders.slice(1, 2),
			categories: [{ category: senders[1]!.category, count: senders[1]!.count }],
		},
		empty: { senders: [] as SenderStat[], categories: [] as OrbitFixtures["categories"] },
	};
}
