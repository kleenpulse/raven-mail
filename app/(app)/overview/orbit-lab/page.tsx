import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { Orbit } from "@/components/overview/orbit";
import { orbitEdgeCases, orbitFixtures } from "@/components/overview/orbit/fixtures";
import { LayoutScroll } from "@/components/ui/layout-scroll";

export const metadata: Metadata = { title: "Orbit lab" };

/** Dev-only preview for the Orbit widget. */
export default function OrbitLabPage() {
	if (process.env.NODE_ENV === "production") notFound();

	const { senders, categories } = orbitFixtures();
	const edge = orbitEdgeCases();

	return (
		<LayoutScroll className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-5 py-6 md:px-8 md:py-8">
				<header className="entrance flex items-end justify-between gap-4">
					<div>
						<h1 className="font-display text-[22px] leading-tight tracking-[-0.01em]">Orbit lab</h1>
						<p className="text-[13px] text-ink-2">Dev preview · fixture data</p>
					</div>
					<Link href="/dev/tests" className="text-[13px] text-ink-2 hover:text-foreground">
						Tests →
					</Link>
				</header>

				<Bento i={1}>
					<BentoTitle>Your orbit</BentoTitle>
					<p className="mt-1 text-[13px] text-ink-2">Who writes to you, and how they reach you · last 30 days</p>
					<Orbit senders={senders} categories={categories} className="mt-5" />
				</Bento>

				<Bento i={2}>
					<BentoTitle>Single category</BentoTitle>
					<Orbit senders={edge.singleCategory.senders} categories={edge.singleCategory.categories} className="mt-4" />
				</Bento>

				<div className="grid gap-4 lg:grid-cols-2">
					<Bento i={3}>
						<BentoTitle>One sender</BentoTitle>
						<Orbit senders={edge.oneSender.senders} categories={edge.oneSender.categories} className="mt-4" />
					</Bento>
					<Bento i={4}>
						<BentoTitle>Empty</BentoTitle>
						<Orbit senders={edge.empty.senders} categories={edge.empty.categories} className="mt-4" />
					</Bento>
				</div>
			</div>
		</LayoutScroll>
	);
}
