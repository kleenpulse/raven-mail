import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Kbd } from "@/components/ui/kbd";
import { RavenMark } from "@/components/shell/raven-mark";
import { LoginForm } from "@/components/auth/login-form";
import { LoginAmbient } from "@/components/auth/login-ambient";
import { DevLoginButton } from "@/components/auth/dev-login-button";
import { ForgetCachedMail } from "@/components/auth/forget-cached-mail";

export const metadata: Metadata = {
	title: "Sign in",
	description:
		"Connect Gmail, Outlook, iCloud or any IMAP mailbox to raven. Your password is sealed in an encrypted cookie on your device, never in a database.",
};

const key = "bg-sheet ring-1 ring-border dark:bg-card-nested dark:ring-glass-border";

const VALUE_PROPS = [
	{
		title: "Briefed, not buried",
		body: "Raven flags what needs your reply and what can wait, so you open what matters first.",
	},
	{
		title: "Keyboard-first",
		body: (
			<>
				<Kbd className={key}>J</Kbd> <Kbd className={key}>K</Kbd> to move,{" "}
				<Kbd className={key}>C</Kbd> to compose, <Kbd className={key}>/</Kbd> to search.
			</>
		),
	},
	{
		title: "Private by design",
		body: "Your credentials are encrypted into an http-only cookie on this device, never a database.",
	},
];

export default async function LoginPage() {
	const session = await getSession();
	if (session) redirect("/overview");

	return (
		<main className="relative flex min-h-svh flex-col lg:flex-row">
			<ForgetCachedMail />
			<section
				aria-labelledby="login-headline"
				className="relative flex shrink-0 flex-col overflow-hidden px-5 pt-6 pb-8 sm:px-10 sm:pt-8 lg:w-[46%] lg:px-14 lg:py-12 xl:w-1/2 xl:px-20"
			>
				{/* Centered on the sheet's edge so it reads as radiating from behind the form; faded toward the copy. */}
				<LoginAmbient className="pointer-events-none absolute top-1/2 -right-56 hidden size-152 -translate-y-1/2 mask-[linear-gradient(to_right,transparent_25%,black_60%)] xl:block" />

				<div className="relative flex items-center gap-3">
					<RavenMark />
					<div className="leading-tight">
						<p className="font-display text-lg tracking-[-0.01em]">raven</p>
						<p className="readout">mail console</p>
					</div>
				</div>

				<div className="relative mt-7 sm:mt-10 lg:my-auto lg:py-10">
					<h1
						id="login-headline"
						className="font-display text-[2rem] leading-[1.04] tracking-[-0.03em] sm:text-hero lg:text-[clamp(3rem,4.4vw,4.25rem)]"
					>
						Your inbox, <br className="hidden sm:block" />
						<span className="text-ink-2">briefed.</span>
					</h1>
					<p className="mt-4 hidden max-w-sm text-[15px] leading-relaxed text-ink-2 sm:block">
						A calm client for Gmail and any IMAP mailbox. Read, triage and reply without
						the refreshes.
					</p>

					<ol className="mt-10 hidden max-w-sm divide-y divide-border lg:block dark:divide-glass-border">
						{VALUE_PROPS.map((prop, i) => (
							<li key={prop.title} className="grid grid-cols-[2.25rem_1fr] py-4 first:pt-0 last:pb-0">
								<span className="pt-1 font-mono text-[11px] text-ink-2 tabular">
									0{i + 1}
								</span>
								<div>
									<p className="text-[15px] font-medium text-foreground">{prop.title}</p>
									<p className="mt-1 text-[13px] leading-relaxed text-ink-2">{prop.body}</p>
								</div>
							</li>
						))}
					</ol>
				</div>

				<p className="readout relative hidden lg:block">IMAP · SMTP · encrypted session</p>
			</section>

			<section
				aria-label="Sign in"
				className="relative flex flex-1 flex-col items-center justify-center rounded-t-frame bg-sheet px-4 pt-6 pb-10 sm:px-8 lg:m-3 lg:ml-0 lg:rounded-frame lg:py-8 dark:border dark:border-glass-border"
			>
				<div className="bento w-full max-w-108 p-6 sm:px-8 sm:py-7">
					<h2 className="font-display text-[26px] leading-tight tracking-[-0.02em]">
						Connect a mailbox
					</h2>
					<p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
						IMAP to read, SMTP to send.
					</p>
					<LoginForm />
					{process.env.NODE_ENV !== "production" && <DevLoginButton />}
				</div>
			</section>
		</main>
	);
}
