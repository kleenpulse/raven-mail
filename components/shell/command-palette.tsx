"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
	Archive,
	Blocks,
	FilePen,
	Folder,
	Forward,
	Inbox,
	LayoutGrid,
	Mail,
	Moon,
	PenSquare,
	Reply,
	ReplyAll,
	Search,
	Send,
	Settings,
	ShieldAlert,
	Sparkles,
	Star,
	Sun,
	Trash2,
	type LucideIcon,
} from "lucide-react";
import {
	Command,
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { usePaletteStore } from "@/components/shell/palette-store";
import { revealTheme } from "@/components/shell/theme-toggle";
import { useAskStore } from "@/components/jev/ask-store";
import { useAsk } from "@/components/jev/use-ask";
import { SECTION_IDS, SECTIONS, searchSettings } from "@/components/settings";
import { useFolders } from "@/hooks/use-mail";
import { useComposeStore } from "@/lib/store/compose";
import { buildCommands, type PaletteAction, type PaletteIcon } from "@/lib/palette/commands";
import { modKeyLabel } from "@/lib/utils";

const ICONS: Record<PaletteIcon, LucideIcon> = {
	ask: Sparkles,
	search: Search,
	compose: PenSquare,
	"theme-light": Sun,
	"theme-dark": Moon,
	settings: Settings,
	"page-overview": LayoutGrid,
	"page-integrations": Blocks,
	folder: Folder,
	"\\Inbox": Inbox,
	"\\Sent": Send,
	"\\Drafts": FilePen,
	"\\Archive": Archive,
	"\\Junk": ShieldAlert,
	"\\Trash": Trash2,
	archive: Archive,
	trash: Trash2,
	star: Star,
	unread: Mail,
	reply: Reply,
	replyAll: ReplyAll,
	forward: Forward,
};

const SECTIONS_LIST = SECTION_IDS.map((id) => ({ id, label: SECTIONS[id].label, blurb: SECTIONS[id].blurb }));

/**
 * ⌘K / Ctrl+K: compose, jump, search, switch theme, act on the open message,
 * or ask Jev. A dialog, so the single-key shortcuts stand down while it's open.
 */
export function CommandPalette() {
	const open = usePaletteStore((s) => s.open);
	const setOpen = usePaletteStore((s) => s.setOpen);
	const message = usePaletteStore((s) => s.message);
	const [query, setQuery] = React.useState("");
	const { data: folders } = useFolders();
	const { resolvedTheme, setTheme } = useTheme();
	const router = useRouter();
	const pathname = usePathname();
	const ask = useAsk();
	// Runs once the dialog has closed, so the command's own focus isn't taken back.
	const pending = React.useRef<PaletteAction | null>(null);

	const groups = buildCommands({
		query,
		theme: resolvedTheme === "dark" ? "dark" : "light",
		folders: folders ?? [],
		message,
		sections: SECTIONS_LIST,
		settingsHits: query.trim() ? [...new Set(searchSettings(query).map((s) => s.section))] : [],
	});

	function perform(action: PaletteAction) {
		switch (action.kind) {
			case "askOpen":
				useAskStore.getState().requestFocus();
				return;
			case "ask":
				void ask(action.question);
				return;
			case "search": {
				// On Mail, search the folder that's open; elsewhere, the Inbox.
				const params = new URLSearchParams(pathname.startsWith("/mail") ? window.location.search : "");
				params.delete("uid");
				params.set("q", action.query);
				router.push(`/mail?${params}`);
				return;
			}
			case "compose":
				useComposeStore.getState().openCompose("new");
				return;
			case "theme":
				revealTheme(action.to, setTheme);
				return;
			case "go":
				router.push(action.href);
				return;
			case "message":
				usePaletteStore.getState().message?.run(action.action);
		}
	}

	function choose(action: PaletteAction) {
		pending.current = action;
		setOpen(false);
	}

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			onOpenChangeComplete={(isOpen) => {
				if (isOpen) return;
				// ⌘K opens through the store, so start fresh here rather than on open.
				setQuery("");
				const action = pending.current;
				pending.current = null;
				if (action) perform(action);
			}}
			title="Command palette"
			description="Search, jump to a page, or ask Jev."
			className="sm:max-w-xl"
		>
			<Command shouldFilter={false} loop>
				<CommandInput value={query} onValueChange={setQuery} placeholder="Search, jump or ask Jev…" />
				<CommandList className="max-h-[min(24rem,60svh)]">
					{groups.map((group) => (
						<CommandGroup key={group.heading} heading={group.heading}>
							{group.items.map((item) => {
								const Icon = ICONS[item.icon];
								return (
									<CommandItem key={item.id} value={item.id} onSelect={() => choose(item.action)}>
										<Icon aria-hidden />
										<span className="min-w-0 truncate">{item.label}</span>
										{item.keys && (
											<CommandShortcut className="flex gap-1 tracking-normal">
												{item.keys.map((k) => (
													<Kbd key={k}>{k === "mod" ? modKeyLabel() : k}</Kbd>
												))}
											</CommandShortcut>
										)}
									</CommandItem>
								);
							})}
						</CommandGroup>
					))}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
