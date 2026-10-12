import { CalendarDays, HardDriveDownload, ListChecks, Mail, NotebookText, Sparkles, UsersRound, Waypoints, Webhook, Workflow } from "lucide-react";
import type { CatalogId } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

/** Slack's four-colour mark (brand assets); rendered as-is on a neutral tile. */
function SlackMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden className={className}>
			<path
				fill="#E01E5A"
				d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
			/>
			<path
				fill="#36C5F0"
				d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
			/>
			<path
				fill="#2EB67D"
				d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
			/>
			<path
				fill="#ECB22E"
				d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
			/>
		</svg>
	);
}

function DiscordMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden className={cn("text-[#5865F2] dark:text-[#8b94ff]", className)}>
			<path
				fill="currentColor"
				d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
			/>
		</svg>
	);
}

const ICONS = {
	mail: Mail,
	jev: Sparkles,
	webhook: Webhook,
	export: HardDriveDownload,
} as const;

const SOON_ICONS: Record<string, typeof Mail> = {
	"Google Calendar": CalendarDays,
	Notion: NotebookText,
	Todoist: ListChecks,
	Linear: Waypoints,
	Asana: Workflow,
	"Microsoft Teams": UsersRound,
};

/** Round tile holding a service mark; hairline ring like the rest of the skin. */
export function BrandTile({ id, size = "md", className }: { id: CatalogId; size?: "sm" | "md" | "lg"; className?: string }) {
	const box = size === "sm" ? "size-8 [&_svg]:size-4" : size === "lg" ? "size-14 [&_svg]:size-7" : "size-11 [&_svg]:size-5";
	const Icon = id in ICONS ? ICONS[id as keyof typeof ICONS] : null;
	return (
		<span
			aria-hidden
			className={cn(
				"grid shrink-0 place-items-center rounded-full bg-sheet ring-1 ring-border dark:bg-card-nested dark:ring-glass-border",
				id === "jev" && "bg-signal-soft text-signal-ink dark:text-signal",
				box,
				className,
			)}
		>
			{id === "slack" ? (
				<SlackMark />
			) : id === "discord" ? (
				<DiscordMark />
			) : Icon ? (
				<Icon className={cn(id === "jev" && "[&>path:first-child]:fill-current")} />
			) : null}
		</span>
	);
}

export function SoonTile({ name }: { name: string }) {
	const Icon = SOON_ICONS[name] ?? Webhook;
	return (
		<span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-border text-ink-3 dark:ring-glass-border">
			<Icon className="size-4" />
		</span>
	);
}
