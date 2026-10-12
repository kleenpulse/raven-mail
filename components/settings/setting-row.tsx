"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tip } from "@/components/ui/tooltip";
import { highlightParts, SETTINGS_BY_ID, type SettingEntry } from "@/components/settings";
import type { Overrides, PrefKey, Prefs } from "@/lib/prefs/schema";
import { resetPrefs, setPref, usePref, usePrefsStore } from "@/lib/prefs/store";
import { cn } from "@/lib/utils";

/** The live search query, so every row can mark what matched. */
export const SettingsQuery = React.createContext("");

function Highlight({ text }: { text: string }) {
	const query = React.useContext(SettingsQuery);
	if (!query) return text;
	return highlightParts(text, query).map((part, i) =>
		part.match ? (
			<mark key={i} className="rounded-[3px] bg-signal-soft text-foreground dark:text-signal">
				{part.text}
			</mark>
		) : (
			<React.Fragment key={i}>{part.text}</React.Fragment>
		),
	);
}

/** True when any of `keys` holds a user value. */
export function useAnyModified(keys: readonly PrefKey[]): boolean {
	return usePrefsStore((s) => keys.some((k) => k in s.overrides));
}

/** Resets `keys` with an Undo toast — for resets wider than the row you're looking at. */
export function resetWithUndo(keys: readonly PrefKey[] | undefined, message: string) {
	const before = usePrefsStore.getState().overrides;
	const snapshot: Overrides = keys
		? (Object.fromEntries(keys.filter((k) => k in before).map((k) => [k, before[k]])) as Overrides)
		: before;
	resetPrefs(keys);
	toast(message, {
		action: {
			label: "Undo",
			onClick: () => usePrefsStore.setState((s) => ({ overrides: { ...s.overrides, ...snapshot } })),
		},
	});
}

export type ControlLayout = "inline" | "wide" | "stack";

/**
 * One setting: label and description on the left, control on the right.
 * `wide` controls drop under the label on phones; `stack` always does.
 */
export function SettingRow({
	id,
	layout = "inline",
	modified: modifiedOverride,
	onReset,
	children,
}: {
	id: string;
	layout?: ControlLayout;
	/** For rows not backed by a pref (Theme). */
	modified?: boolean;
	onReset?: () => void;
	children: (labelId: string) => React.ReactNode;
}) {
	const entry = SETTINGS_BY_ID.get(id) as SettingEntry;
	const labelId = React.useId();
	const prefModified = useAnyModified(entry.prefs ?? []);
	const modified = modifiedOverride ?? prefModified;
	const reset = onReset ?? (entry.prefs ? () => resetPrefs(entry.prefs) : undefined);

	return (
		<div
			id={`setting-${entry.id}`}
			className={cn(
				// Square corners: rounded ones would bend the card's hairline dividers.
				"group/setting grid scroll-mt-28 items-center gap-x-6 gap-y-3 px-5 py-4 transition-[box-shadow] duration-500",
				"data-[flash=true]:ring-2 data-[flash=true]:ring-signal/70 data-[flash=true]:ring-inset data-[flash=true]:duration-150",
				layout === "stack"
					? "grid-cols-1"
					: layout === "wide"
						? "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]"
						: "grid-cols-[minmax(0,1fr)_auto]",
			)}
		>
			<div className="min-w-0">
				<div className="flex min-h-6 items-center gap-2">
					<span id={labelId} className="text-[14px] font-medium text-foreground">
						<Highlight text={entry.label} />
					</span>
					{modified && (
						<>
							<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-signal" />
							<span className="sr-only">(changed)</span>
						</>
					)}
					{modified && reset && (
						<Tip
							label="Reset to default"
							render={
								<button
									type="button"
									onClick={reset}
									aria-label={`Reset ${entry.label} to default`}
									className="grid size-6 place-items-center rounded-full text-ink-2 opacity-0 outline-none transition-[opacity,background-color] duration-150 group-hover/setting:opacity-100 hover:bg-card-nested hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] pointer-coarse:opacity-100"
								/>
							}
						>
							<RotateCcw className="size-3.5" />
						</Tip>
					)}
				</div>
				{entry.description && (
					<p className="mt-0.5 max-w-[46ch] text-[13px] leading-snug text-pretty text-ink-2">
						<Highlight text={entry.description} />
					</p>
				)}
			</div>
			<div className={cn("min-w-0", layout === "inline" && "justify-self-end", layout === "wide" && "sm:justify-self-end")}>
				{children(labelId)}
			</div>
		</div>
	);
}

/** Cards group rows the way System Settings does: a quiet title, hairlines between rows. */
export function SettingsCard({ title, children, className }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
	return (
		<section className={cn("bento overflow-hidden", className)}>
			<h3 className="readout px-5 pt-4 pb-1">{title}</h3>
			<div className="divide-y divide-border/70 dark:divide-glass-border">{children}</div>
		</section>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	labelledBy,
}: {
	value: T;
	options: readonly { value: T; label: string }[];
	onChange: (value: T) => void;
	labelledBy: string;
}) {
	return (
		<ToggleGroup
			value={[value]}
			// Pressing the active item would empty the group; a segmented control always holds one.
			onValueChange={(next) => next[0] !== undefined && onChange(next[0] as T)}
			variant="pill"
			size="pill"
			spacing={0}
			aria-labelledby={labelledBy}
			className="w-full rounded-pill bg-sheet p-1 ring-1 ring-border sm:w-auto dark:bg-background/40 dark:ring-glass-border"
		>
			{options.map((o) => (
				<ToggleGroupItem
					key={o.value}
					value={o.value}
					className="h-10 flex-1 rounded-pill px-3.5 text-[12.5px] active:scale-[0.97] sm:h-8 sm:flex-none"
				>
					{o.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

type KeysOf<V> = { [K in PrefKey]: Prefs[K] extends V ? K : never }[PrefKey];

export function PrefSwitchRow({
	id,
	pref,
	onChange,
}: {
	id: string;
	pref: KeysOf<boolean>;
	/** Side effects beyond storing the value. */
	onChange?: (next: boolean) => void;
}) {
	const checked = usePref(pref);
	return (
		<SettingRow id={id}>
			{(labelId) => (
				<Switch
					checked={checked}
					onCheckedChange={(next) => {
						setPref(pref, next);
						onChange?.(next);
					}}
					aria-labelledby={labelId}
					className="origin-right scale-125"
				/>
			)}
		</SettingRow>
	);
}

export function PrefSegmentedRow<K extends KeysOf<string>>({
	id,
	pref,
	options,
}: {
	id: string;
	pref: K;
	options: readonly { value: Prefs[K] & string; label: string }[];
}) {
	const value = usePref(pref) as Prefs[K] & string;
	return (
		<SettingRow id={id} layout="wide">
			{(labelId) => (
				<Segmented value={value} options={options} onChange={(next) => setPref(pref, next)} labelledBy={labelId} />
			)}
		</SettingRow>
	);
}
