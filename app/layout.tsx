import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Sans } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { MotionProvider } from "@/components/providers/motion-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OPEN_GRAPH, SEO_INDEX, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

const instrumentSans = Instrument_Sans({
	variable: "--font-instrument-sans",
	subsets: ["latin"],
	display: "swap",
});

export const metadata: Metadata = {
	metadataBase: SITE_URL,
	title: {
		default: "raven::Mail Console",
		template: "%s::raven",
	},
	description:
		"Self-hosted email client for Gmail, Outlook, iCloud and any IMAP inbox. See who’s waiting on your reply, what can wait, and ask your inbox anything.",
	openGraph: OPEN_GRAPH,
	twitter: { card: "summary_large_image" },
	robots: SEO_INDEX ? undefined : { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
			className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} h-full antialiased`}
		>
			<body className="min-h-full flex flex-col font-sans">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<NuqsAdapter>
						<QueryProvider>
							<MotionProvider>
								<TooltipProvider delay={300}>{children}</TooltipProvider>
							</MotionProvider>
						</QueryProvider>
					</NuqsAdapter>
					<Toaster position="top-center" richColors closeButton />
				</ThemeProvider>
			</body>
		</html>
	);
}
