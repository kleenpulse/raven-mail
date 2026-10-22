"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { ExternalLink, KeyRound, LogOut, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useAccount } from "@/components/providers/account-provider";
import { centerOf, revealTheme, type ThemeChoice } from "@/components/shell/theme-toggle";
import { sectionEntries, type SectionId, type SettingEntry } from "@/components/settings";
import {
	PrefSegmentedRow,
	PrefSwitchRow,
	resetWithUndo,
	Segmented,
	SettingRow,
	SettingsCard,
} from "@/components/settings/setting-row";
import { stopPreloading } from "@/hooks/use-preload-in-view";
import { requestChangelogOpen } from "@/components/whats-new/store";
import { EntryList, useReleases } from "@/components/whats-new/whats-new";
import { useSignOut } from "@/hooks/use-sign-out";
import { useRefreshIntegrations } from "@/hooks/use-integrations";
import { removeJevKeyAction, saveJevKeyAction } from "@/lib/actions/jev-key";
import type { JevStatus } from "@/lib/jev/client";
import { Input } from "@/components/ui/input";
import { APP_VERSION } from "@/lib/changelog/seen";
import { initials } from "@/lib/format";
import { SOURCE_URL } from "@/lib/site";
import { SHORTCUTS } from "@/lib/keyboard";
import { DEFAULT_MAIL_LAYOUT, writeMailLayoutCookie } from "@/lib/mail/reader-layout";
import { TAB_SPRING } from "@/lib/motion";
import type { NotifyBannerPosition } from "@/lib/prefs/schema";
import { setPref, usePref, usePrefsStore } from "@/lib/prefs/store";
import { clearPersistedQueries } from "@/lib/query-persist";
import { cn, modKeyLabel } from "@/lib/utils";
import { playStepAudio } from "@/components/tour/audio";
import { requestTourResume, requestTourRestart } from "@/components/tour/store";
import { setTourVoice, useTourStateStore } from "@/lib/tour/state";
import { DEFAULT_TOUR_STATE, TOUR_VOICES, VOICE_LABELS, type TourVoice } from "@/lib/tour/types";

/* ─── Appearance ─────────────────────────────────────────────────────── */

const THEMES: { value: ThemeChoice; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Ember" },
	{ value: "dark", label: "Nebula" },
];

function ThemeRow() {
	const { theme, setTheme } = useTheme();
	// next-themes knows nothing during SSR; show the default until it does.
	const mounted = React.useSyncExternalStore(
		() => () => {},
		() => true,
		() => false,
	);
	const value = (mounted && (theme as ThemeChoice | undefined)) || "system";
	const origin = React.useRef<HTMLDivElement>(null);
	const choose = (next: ThemeChoice) => revealTheme(next, setTheme, origin.current ? centerOf(origin.current) : undefined);
	return (
		<SettingRow id="theme" layout="wide" modified={value !== "system"} onReset={() => choose("system")}>
			{(labelId) => (
				<div ref={origin}>
					<Segmented value={value} options={THEMES} onChange={choose} labelledBy={labelId} />
				</div>
			)}
		</SettingRow>
	);
}

const PREVIEW_ROWS = [
	{ from: "Mara Ellis", subject: "Launch checklist, final pass", preview: "Two items left before we flip the switch…", time: "09:41", unread: true, clip: true },
	{ from: "Linear", subject: "3 issues assigned to you", preview: "RAV-212 · Undo window ignores…", time: "08:02", unread: false, clip: false },
	{ from: "Jonah Park", subject: "Re: Friday offsite", preview: "Works for me, I'll bring the projector.", time: "Mon", unread: false, clip: false },
];

/** Three list rows on the same density variables as the real list; they react through CSS alone. */
function AppearancePreview() {
	return (
		<div aria-hidden className="bento overflow-hidden p-3">
			<p className="readout px-2 pb-2">Preview</p>
			<div className="space-y-(--row-gap)">
				{PREVIEW_ROWS.map((row, i) => (
					<div
						key={row.from}
						className={cn(
							"flex items-center gap-3 rounded-[20px] px-3 py-(--row-py) transition-[padding] duration-200",
							i === 0 ? "bg-signal-soft ring-1 ring-signal/30 dark:ring-signal/45" : "bg-sheet dark:bg-card-nested dark:ring-1 dark:ring-glass-border",
						)}
					>
						<span className="grid size-9 shrink-0 place-items-center rounded-full bg-card-nested font-display text-[12px] font-semibold ring-1 ring-border dark:bg-signal-soft dark:text-signal dark:ring-glass-border">
							{initials(row.from)}
						</span>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								{row.unread && <span className="size-2 shrink-0 rounded-full bg-signal" />}
								<span className={cn("truncate text-[14px] leading-5", row.unread ? "font-semibold" : "font-medium text-foreground/80")}>
									{row.from}
								</span>
								<span className="ml-auto flex shrink-0 items-center gap-2">
									{row.clip && <Paperclip className="size-3.5 text-ink-2" />}
									<span className="font-mono text-[11px] tracking-wide text-ink-2 tabular">{row.time}</span>
								</span>
							</div>
							<p className="mt-0.5 truncate text-[13.5px] leading-5 text-foreground/80">
								{row.subject}
								<span className="text-ink-2"> — {row.preview}</span>
							</p>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

/* ─── Mail ───────────────────────────────────────────────────────────── */

const UNDO_OPTIONS = [
	{ value: "5000", label: "5s" },
	{ value: "10000", label: "10s" },
	{ value: "20000", label: "20s" },
	{ value: "30000", label: "30s" },
] as const;

function UndoRow() {
	const value = usePref("mail.undoMs");
	return (
		<SettingRow id="undo" layout="wide">
			{(labelId) => (
				<Segmented
					value={String(value) as (typeof UNDO_OPTIONS)[number]["value"]}
					options={UNDO_OPTIONS}
					onChange={(next) => setPref("mail.undoMs", Number(next) as 5000 | 10_000 | 20_000 | 30_000)}
					labelledBy={labelId}
				/>
			)}
		</SettingRow>
	);
}

const UNDO_SEND_OPTIONS = [
	{ value: "0", label: "Off" },
	{ value: "5000", label: "5s" },
	{ value: "10000", label: "10s" },
	{ value: "20000", label: "20s" },
	{ value: "30000", label: "30s" },
] as const;

function UndoSendRow() {
	const value = usePref("mail.undoSend");
	return (
		<SettingRow id="undo-send" layout="wide">
			{(labelId) => (
				<Segmented
					value={String(value) as (typeof UNDO_SEND_OPTIONS)[number]["value"]}
					options={UNDO_SEND_OPTIONS}
					onChange={(next) => setPref("mail.undoSend", Number(next) as 0 | 5000 | 10_000 | 20_000 | 30_000)}
					labelledBy={labelId}
				/>
			)}
		</SettingRow>
	);
}

function MailLayoutRow() {
	return (
		<SettingRow id="mail-layout">
			{(labelId) => (
				<Button
					variant="surface"
					size="pill-sm"
					aria-describedby={labelId}
					onClick={() => {
						writeMailLayoutCookie(DEFAULT_MAIL_LAYOUT);
						toast.success("Mail layout reset");
					}}
				>
					Reset
				</Button>
			)}
		</SettingRow>
	);
}

/* ─── Notifications ──────────────────────────────────────────────────── */

const CORNERS: { value: NotifyBannerPosition; label: string; place: string }[] = [
	{ value: "top-left", label: "Top left", place: "items-start justify-start" },
	{ value: "top-right", label: "Top right", place: "items-start justify-end" },
	{ value: "bottom-left", label: "Bottom left", place: "items-end justify-start" },
	{ value: "bottom-right", label: "Bottom right", place: "items-end justify-end" },
];

/** A little screen: pick the corner, and the banner springs over to it. */
function BannerPositionRow() {
	const value = usePref("notify.bannerPosition");
	const layoutId = React.useId();
	return (
		<SettingRow id="banner-position" layout="wide">
			{(labelId) => (
				<RadioGroup
					value={value}
					onValueChange={(next) => setPref("notify.bannerPosition", next as NotifyBannerPosition)}
					aria-labelledby={labelId}
					className="grid h-[88px] w-[140px] grid-cols-2 grid-rows-2 gap-1 rounded-[16px] bg-sheet p-1.5 ring-1 ring-border dark:bg-background/40 dark:ring-glass-border"
				>
					{CORNERS.map((c) => (
						<Radio.Root
							key={c.value}
							value={c.value}
							aria-label={c.label}
							className={cn(
								"group/corner relative flex rounded-[11px] p-1.5 outline-none transition-colors hover:bg-card-nested focus-visible:ring-2 focus-visible:ring-ring",
								c.place,
							)}
						>
							{value === c.value ? (
								<motion.span
									layoutId={layoutId}
									transition={TAB_SPRING}
									className="h-3 w-11 rounded-full bg-signal shadow-glow"
								/>
							) : (
								<span className="h-3 w-11 rounded-full bg-foreground/[0.07] opacity-0 transition-opacity group-hover/corner:opacity-100" />
							)}
						</Radio.Root>
					))}
				</RadioGroup>
			)}
		</SettingRow>
	);
}

/* ─── Sync & Storage ─────────────────────────────────────────────────── */

function OfflineCacheRow() {
	return (
		<PrefSwitchRow
			id="offline-cache"
			pref="sync.offlineCache"
			onChange={(on) => {
				if (on) return;
				void clearPersistedQueries();
				toast("Stopped saving mail here", {
					description: "Saved mail was removed from this device.",
					action: { label: "Undo", onClick: () => setPref("sync.offlineCache", true) },
				});
			}}
		/>
	);
}

function ClearCacheRow() {
	const qc = useQueryClient();
	const [busy, setBusy] = React.useState(false);

	async function clear() {
		setBusy(true);
		try {
			// Before the reset: a preload landing after it would put the old bodies back.
			stopPreloading();
			await clearPersistedQueries();
			qc.removeQueries({ type: "inactive" });
			await qc.resetQueries();
			toast.success("Saved mail cleared", { description: "Downloading fresh copies." });
		} finally {
			setBusy(false);
		}
	}

	return (
		<SettingRow id="clear-cache">
			{(labelId) => (
				<Dialog>
					<DialogTrigger render={<Button variant="surface" size="pill-sm" aria-describedby={labelId} />}>Clear…</DialogTrigger>
					<DialogContent className="rounded-[24px] p-5">
						<DialogHeader>
							<DialogTitle>Clear saved mail?</DialogTitle>
							<DialogDescription>
								Your saved mail, folders and overview are removed from this device and downloaded again. Nothing
								changes on your mail server.
							</DialogDescription>
						</DialogHeader>
						{/* DialogFooter's bleed assumes p-4; this dialog is p-5 with 24px corners. */}
						<DialogFooter className="-mx-5 -mb-5 rounded-b-[24px] px-5">
							<DialogClose render={<Button variant="surface" size="pill-sm" />}>Cancel</DialogClose>
							<DialogClose render={<Button variant="destructive" size="pill-sm" disabled={busy} onClick={() => void clear()} />}>
								Clear
							</DialogClose>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</SettingRow>
	);
}

/* ─── Keyboard ───────────────────────────────────────────────────────── */

function ShortcutListRow() {
	const singleKey = usePref("keyboard.singleKey");
	const mod = React.useSyncExternalStore(
		() => () => {},
		() => modKeyLabel(),
		() => "Ctrl",
	);
	return (
		<SettingRow id="shortcut-list" layout="stack">
			{(labelId) => (
				<ul aria-labelledby={labelId} className="grid gap-x-8 sm:grid-cols-2">
					{SHORTCUTS.map((s) => {
						const off = s.single && !singleKey;
						return (
							<li
								key={s.label}
								className={cn("flex min-h-10 items-center justify-between gap-3 border-b border-border/60 py-1.5 dark:border-glass-border", off && "opacity-45")}
							>
								<span className="text-[13px] text-foreground">
									{s.label}
									<span className="ml-2 text-[11px] text-ink-2">{off ? "Off" : s.scope}</span>
								</span>
								<KbdGroup>
									{s.keys.map((k) => (
										<Kbd key={k} className="h-6 min-w-6 rounded-md bg-sheet px-1.5 font-mono text-[11px] ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
											{k === "mod" ? mod : k}
										</Kbd>
									))}
								</KbdGroup>
							</li>
						);
					})}
				</ul>
			)}
		</SettingRow>
	);
}

/* ─── Account & About ────────────────────────────────────────────────── */

function IdentityRow() {
	const account = useAccount();
	return (
		<SettingRow id="identity" layout="stack">
			{() => (
				<div className="flex items-center gap-3">
					<span className="grid size-11 shrink-0 place-items-center rounded-full bg-card-nested font-display text-sm font-semibold ring-1 ring-border dark:bg-signal-soft dark:text-signal dark:ring-glass-border">
						{initials(account.displayName, account.email)}
					</span>
					<div className="min-w-0">
						<p className="truncate text-[14px] font-medium">{account.displayName}</p>
						<p className="truncate text-[13px] text-ink-2">{account.email}</p>
						<p className="readout mt-1">{account.provider}</p>
					</div>
				</div>
			)}
		</SettingRow>
	);
}

function SignOutRow() {
	const signOut = useSignOut();
	return (
		<SettingRow id="sign-out">
			{(labelId) => (
				<Button variant="destructive" size="pill-sm" aria-describedby={labelId} onClick={() => void signOut()}>
					<LogOut />
					Sign out
				</Button>
			)}
		</SettingRow>
	);
}

function jevStatusLine(status: JevStatus): string {
	if (status.source === "user") return `Jev uses your key ending in ${status.hint}.`;
	if (status.source === "server") return "Jev uses this Raven's key. Add your own to use your TypeSafe account instead.";
	return "Jev is off. Ask Jev uses free local rules until you add a key.";
}

function JevKeyRow() {
	const account = useAccount();
	const router = useRouter();
	const refreshIntegrations = useRefreshIntegrations();
	const [status, setStatus] = React.useState(account.jev);
	const [key, setKey] = React.useState("");
	const [error, setError] = React.useState<string | null>(null);
	const [pending, startTransition] = React.useTransition();
	const inputId = React.useId();
	const errorId = React.useId();

	function applied(next: JevStatus, message: string) {
		setStatus(next);
		setKey("");
		setError(null);
		toast.success(message);
		void refreshIntegrations();
		// Server-rendered parts (the Overview's live dot) read the session again.
		router.refresh();
	}

	function save(event: React.FormEvent) {
		event.preventDefault();
		startTransition(async () => {
			const result = await saveJevKeyAction(key);
			if (result.ok) applied(result.data, "Key saved. Jev now uses your TypeSafe account.");
			else setError(result.error);
		});
	}

	function remove() {
		startTransition(async () => {
			const result = await removeJevKeyAction();
			if (result.ok) applied(result.data, "Key removed from this device.");
			else setError(result.error);
		});
	}

	return (
		<SettingRow id="jev-key" layout="stack">
			{(labelId) => (
				<div className="flex flex-col gap-3">
					<p className="flex items-center gap-2 text-[13px] text-ink-2">
						<KeyRound className="size-3.5 shrink-0" aria-hidden />
						<span aria-live="polite">{jevStatusLine(status)}</span>
					</p>
					<form onSubmit={save} className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<label htmlFor={inputId} className="sr-only">
							TypeSafe API key
						</label>
						<Input
							id={inputId}
							type="password"
							value={key}
							onChange={(e) => {
								setKey(e.target.value);
								setError(null);
							}}
							placeholder={status.source === "user" ? "Paste a new key to replace it" : "Paste your TypeSafe key"}
							autoComplete="off"
							spellCheck={false}
							aria-describedby={error ? `${labelId} ${errorId}` : labelId}
							aria-invalid={error ? true : undefined}
							className="h-8 rounded-pill px-3.5 font-mono sm:max-w-sm"
						/>
						<div className="flex gap-2">
							<Button type="submit" variant="surface" size="pill-sm" disabled={pending || !key.trim()}>
								{pending ? "Checking…" : "Save key"}
							</Button>
							{status.source === "user" && (
								<Button type="button" variant="destructive" size="pill-sm" disabled={pending} onClick={remove}>
									Remove
								</Button>
							)}
						</div>
					</form>
					{error && (
						<p id={errorId} role="alert" className="text-[13px] text-destructive">
							{error}
						</p>
					)}
					<p className="text-[12px] text-ink-2">
						Get a key at{" "}
						<a
							href="https://console.typesafe.ai/keys"
							target="_blank"
							rel="noreferrer"
							className="text-signal-ink underline-offset-2 hover:underline dark:text-signal"
						>
							console.typesafe.ai
						</a>
						. Raven checks it once with a free call before saving.
					</p>
				</div>
			)}
		</SettingRow>
	);
}

/** Fixed format, UTC: the same string on server and client. */
function buildLabel(): string {
	const stamp = Number(process.env.BUILD_STAMP);
	if (!Number.isFinite(stamp) || stamp <= 0) return "development";
	return `${new Date(stamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function BuildRow() {
	return (
		<SettingRow id="build">
			{(labelId) => (
				<div className="flex flex-col items-end gap-1">
					<Button variant="surface" size="pill-sm" aria-describedby={labelId} onClick={() => requestChangelogOpen()}>
						<span className="font-mono tabular">v{APP_VERSION}</span>
					</Button>
					<span className="font-mono text-[11px] text-ink-2 tabular">
						{process.env.NODE_ENV === "production" ? buildLabel() : "dev server"}
					</span>
				</div>
			)}
		</SettingRow>
	);
}

const SNIPPET_LINES = 3;

function WhatsNewRow() {
	const latest = useReleases()[0];
	return (
		<SettingRow id="whats-new" layout="stack">
			{(labelId) =>
				latest ? (
					<div aria-labelledby={labelId} role="group" className="flex flex-col gap-3">
						<p className="font-mono text-[11px] text-ink-2 tabular">
							v{latest.version}
							{latest.date && ` · ${latest.date}`}
						</p>
						<EntryList entries={latest.entries.slice(0, SNIPPET_LINES)} />
						<Button variant="surface" size="pill-sm" className="w-fit" onClick={() => requestChangelogOpen()}>
							Full changelog
							{latest.entries.length > SNIPPET_LINES && ` (+${latest.entries.length - SNIPPET_LINES} more)`}
						</Button>
					</div>
				) : (
					<p className="text-[13px] text-ink-2">No releases yet.</p>
				)
			}
		</SettingRow>
	);
}

function SourceRow() {
	return (
		<SettingRow id="source">
			{(labelId) => (
				<Button
					variant="surface"
					size="pill-sm"
					aria-describedby={labelId}
					nativeButton={false}
					render={<a href={SOURCE_URL} target="_blank" rel="noreferrer" />}
				>
					View on GitHub
					<ExternalLink />
				</Button>
			)}
		</SettingRow>
	);
}

function ResetAllRow() {
	const any = usePrefsStore((s) => Object.keys(s.overrides).length > 0);
	return (
		<SettingRow id="reset-all">
			{(labelId) => (
				<Button
					variant="surface"
					size="pill-sm"
					disabled={!any}
					aria-describedby={labelId}
					onClick={() => resetWithUndo(undefined, "All settings reset")}
				>
					Reset all
				</Button>
			)}
		</SettingRow>
	);
}

/* ─── Tour & Voice ───────────────────────────────────────────────────── */

const VOICE_OPTIONS = TOUR_VOICES.map((v) => ({ value: v, label: VOICE_LABELS[v] }));

/** Not a pref: the accent rides the synced tour record, so Reset All leaves it alone. */
function TourVoiceRow() {
	const voice = useTourStateStore((s) => s.tour.voice);
	const pick = (next: TourVoice) => {
		setTourVoice(next);
		playStepAudio(next, "welcome"); // a sample; silent when narration is off
	};
	return (
		<SettingRow
			id="tour-voice"
			layout="wide"
			modified={voice !== DEFAULT_TOUR_STATE.voice}
			onReset={() => setTourVoice(DEFAULT_TOUR_STATE.voice)}
		>
			{(labelId) => <Segmented value={voice} options={VOICE_OPTIONS} onChange={pick} labelledBy={labelId} />}
		</SettingRow>
	);
}

function TourReplayRow() {
	const skipped = useTourStateStore((s) => s.tour.skipped);
	return (
		<SettingRow id="tour-replay">
			{(labelId) => (
				<Button
					variant="surface"
					size="pill-sm"
					aria-describedby={labelId}
					onClick={() => (skipped ? requestTourResume() : requestTourRestart())}
				>
					{skipped ? "Resume" : "Start"}
				</Button>
			)}
		</SettingRow>
	);
}

/* ─── Registry ───────────────────────────────────────────────────────── */

const ROWS: Record<string, React.ComponentType> = {
	theme: ThemeRow,
	"ui-size": () => (
		<PrefSegmentedRow
			id="ui-size"
			pref="appearance.uiSize"
			options={[
				{ value: "default", label: "Default" },
				{ value: "large", label: "Large" },
				{ value: "larger", label: "Larger" },
			]}
		/>
	),
	density: () => (
		<PrefSegmentedRow
			id="density"
			pref="appearance.density"
			options={[
				{ value: "comfortable", label: "Comfortable" },
				{ value: "compact", label: "Compact" },
			]}
		/>
	),
	motion: () => (
		<PrefSegmentedRow
			id="motion"
			pref="appearance.motion"
			options={[
				{ value: "system", label: "System" },
				{ value: "reduce", label: "Reduce" },
			]}
		/>
	),
	transparency: () => <PrefSwitchRow id="transparency" pref="appearance.reduceTransparency" />,
	"remote-images": () => <PrefSwitchRow id="remote-images" pref="mail.remoteImages" />,
	preload: () => <PrefSwitchRow id="preload" pref="mail.preload" />,
	threading: () => <PrefSwitchRow id="threading" pref="mail.threading" />,
	undo: UndoRow,
	"undo-send": UndoSendRow,
	"mail-layout": MailLayoutRow,
	"banner-position": BannerPositionRow,
	"focus-refetch": () => <PrefSwitchRow id="focus-refetch" pref="sync.focusRefetch" />,
	freshness: () => (
		<PrefSegmentedRow
			id="freshness"
			pref="sync.freshness"
			options={[
				{ value: "live", label: "Live" },
				{ value: "balanced", label: "Balanced" },
				{ value: "saver", label: "Saver" },
			]}
		/>
	),
	"offline-cache": OfflineCacheRow,
	"clear-cache": ClearCacheRow,
	"single-key": () => <PrefSwitchRow id="single-key" pref="keyboard.singleKey" />,
	"shortcut-list": ShortcutListRow,
	"tour-voice": TourVoiceRow,
	"tour-narration": () => <PrefSwitchRow id="tour-narration" pref="tour.narration" />,
	"tour-replay": TourReplayRow,
	identity: IdentityRow,
	"sign-out": SignOutRow,
	"jev-key": JevKeyRow,
	build: BuildRow,
	"whats-new": WhatsNewRow,
	source: SourceRow,
	"reset-all": ResetAllRow,
};

/** Consecutive entries sharing a card title become one card. */
function byCard(entries: SettingEntry[]): { title: string; entries: SettingEntry[] }[] {
	const cards: { title: string; entries: SettingEntry[] }[] = [];
	for (const entry of entries) {
		const last = cards.at(-1);
		if (last?.title === entry.card) last.entries.push(entry);
		else cards.push({ title: entry.card, entries: [entry] });
	}
	return cards;
}

export function SettingRows({ entries }: { entries: SettingEntry[] }) {
	return entries.map((entry) => {
		const Row = ROWS[entry.id];
		return Row ? <Row key={entry.id} /> : null;
	});
}

export function SectionBody({ section }: { section: SectionId }) {
	return (
		<div className="space-y-4">
			{section === "appearance" && <AppearancePreview />}
			{byCard(sectionEntries(section)).map((card) => (
				<SettingsCard key={card.title} title={card.title}>
					<SettingRows entries={card.entries} />
				</SettingsCard>
			))}
		</div>
	);
}
