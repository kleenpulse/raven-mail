import { Suspense } from "react";
import type { Metadata } from "next";
import { OpenInRaven } from "@/components/shell/open-in-raven";

export const metadata: Metadata = { title: "Open in Raven", robots: { index: false, follow: false } };

/**
 * Links in cards shared from the desktop app (Slack, Discord) land here and
 * are handed to the app as `raven://`. Static, so every deployment serves it.
 */
export default function OpenPage() {
	return (
		<main className="relative isolate flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 overflow-hidden bg-background px-6 text-center">
			<Suspense fallback={null}>
				<OpenInRaven />
			</Suspense>
		</main>
	);
}
