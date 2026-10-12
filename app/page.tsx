import type { Metadata } from "next";
import { AskShowcase } from "@/components/landing/ask-showcase";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { Manifesto } from "@/components/landing/manifesto";
import { OverviewShowcase } from "@/components/landing/overview-showcase";
import { Privacy } from "@/components/landing/privacy";
import { ProvidersMarquee } from "@/components/landing/providers-marquee";
import { SectionRail } from "@/components/landing/section-rail";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Workflow } from "@/components/landing/workflow";
import { landingDemo } from "@/lib/landing/demo";
import { OPEN_GRAPH, SITE_NAME, SITE_URL } from "@/lib/site";

// Static for everyone; hourly rebuilds keep the demo mailbox's "7h ago"s honest.
export const revalidate = 3600;

const DESCRIPTION =
	"Self-hosted email client for Gmail, Outlook, iCloud and any IMAP inbox. See who’s waiting on your reply, what can wait, and ask your inbox anything.";

export const metadata: Metadata = {
	title: {
		absolute: "raven::self-hosted email client for Gmail & any IMAP inbox",
	},
	description: DESCRIPTION,
	// Here, not in the root layout: a layout's canonical would be inherited by /login.
	alternates: { canonical: "/" },
	openGraph: {
		...OPEN_GRAPH,
		url: "/",
		title: "raven::your inbox, briefed",
		description:
			"Open your mail to a brief: who’s waiting on you, who owes you, and what can wait. Self-hosted, for Gmail and any IMAP inbox.",
	},
};

const JSON_LD = JSON.stringify({
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "WebSite",
			name: SITE_NAME,
			alternateName: "raven mail",
			url: SITE_URL.origin,
		},
		{
			"@type": "SoftwareApplication",
			name: SITE_NAME,
			applicationCategory: "CommunicationApplication",
			operatingSystem: "Web",
			url: SITE_URL.origin,
			description: DESCRIPTION,
		},
	],
}).replace(/</g, "\\u003c");

export default function LandingPage() {
	const { overview, asks } = landingDemo();

	return (
		<div className="relative flex-1">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON_LD }}
			/>
			<SmoothScroll />
			<LandingNav />
			<SectionRail />
			<main>
				<Hero senders={overview.senders} categories={overview.categories} />
				<ProvidersMarquee />
				<Manifesto />
				<OverviewShowcase overview={overview} />
				<AskShowcase asks={asks} overview={overview} />
				<Privacy />
				<Workflow />
				<FinalCta />
			</main>
			<LandingFooter />
		</div>
	);
}
