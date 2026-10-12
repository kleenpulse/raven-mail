import Link from "next/link";
import { RavenMark } from "@/components/shell/raven-mark";
import { SOURCE_URL } from "@/lib/site";

const LINKS = [
	{ href: "#overview", label: "Overview" },
	{ href: "#ask", label: "Ask Jev" },
	{ href: "#privacy", label: "Privacy" },
];

export function LandingFooter() {
	return (
		<footer className="border-t border-glass-border">
			<div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-5 py-8 sm:flex-row sm:gap-8 sm:py-10 sm:items-center sm:justify-between">
				<div className="flex items-center gap-3">
					<RavenMark className="size-9 [&_svg]:size-[18px]" />
					<div className="leading-tight">
						<p className="font-display text-[17px] tracking-[-0.01em]">raven</p>
						<p className="readout">mail, briefed</p>
					</div>
				</div>
				<nav aria-label="Footer">
					<ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-ink-2">
						{LINKS.map((link) => (
							<li key={link.href}>
								<a href={link.href} className="transition-colors hover:text-foreground">
									{link.label}
								</a>
							</li>
						))}
						<li>
							<a href={SOURCE_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">
								Source code
							</a>
						</li>
						<li>
							<Link href="/login" className="transition-colors hover:text-foreground">
								Sign in
							</Link>
						</li>
					</ul>
				</nav>
				<p className="readout hidden sm:block">Decisions by Jev · TypeSafe</p>
			</div>
		</footer>
	);
}
