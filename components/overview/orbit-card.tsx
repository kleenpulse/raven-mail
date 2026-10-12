import { Bento, BentoTitle } from "@/components/overview/bento";
import { Orbit } from "@/components/overview/orbit";
import type { Overview } from "@/lib/insights/types";

/** The video's constellation as a relationship map: you → categories → the people and services writing in. */
export function OrbitCard({ overview, i = 0 }: { overview: Overview; i?: number }) {
	return (
		<Bento i={i}>
			<BentoTitle>Your orbit</BentoTitle>
			<p className="mt-1 text-[13px] text-ink-2">Who writes to you, and how they reach you · last 30 days</p>
			<Orbit senders={overview.senders} categories={overview.categories} className="mt-5" />
		</Bento>
	);
}
