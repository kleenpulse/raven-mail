"use client";

import * as React from "react";
import { BellOff, BellRing, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { DbCallout } from "@/components/integrations/db-callout";
import { useFollowUps } from "@/hooks/use-follow-ups";
import { toApiError } from "@/lib/api-error";
import { REMIND_PRESETS, type RemindChoice } from "@/lib/follow-ups/when";
import type { DbProblem } from "@/lib/integrations/types";

const DB_CODES = new Set(["store_needs_db", "db_not_migrated", "db_unavailable"]);

/** Why reminders can't be saved here (no database), or null. */
export function useRemindProblem(): DbProblem | null {
	const { isError, error } = useFollowUps();
	if (!isError) return null;
	const e = toApiError(error);
	return DB_CODES.has(e.code ?? "") ? { code: e.code!, message: e.message, hint: e.hint ?? "" } : null;
}

type ItemsProps = {
	/** What's set now, in words ("Set for Fri 24 Oct"). */
	status?: string;
	onPick: (choice: RemindChoice) => void;
	/** Opens the time picker; the menu closes first. */
	onCustom: () => void;
	onClear?: () => void;
	clearLabel?: string;
};

/** The menu items: presets, a picked time, and clear. Goes inside any dropdown. */
export function RemindItems({ status, onPick, onCustom, onClear, clearLabel = "Cancel reminder" }: ItemsProps) {
	const problem = useRemindProblem();
	return (
		<DropdownMenuGroup>
			<DropdownMenuLabel>Remind me if no reply</DropdownMenuLabel>
			{problem ? (
				<div className="p-1">
					<DbCallout compact problem={problem} />
				</div>
			) : (
				<>
					{status && <div className="px-2 pb-1.5 text-[12px] text-ink-2">{status}</div>}
					{REMIND_PRESETS.map((p) => (
						<DropdownMenuItem key={p.days} className="gap-2.5" onClick={() => onPick({ days: p.days })}>
							<BellRing className="size-4 text-ink-2" />
							In {p.label}
						</DropdownMenuItem>
					))}
					<DropdownMenuItem className="gap-2.5" onClick={onCustom}>
						<CalendarClock className="size-4 text-ink-2" />
						Pick a time…
					</DropdownMenuItem>
					{onClear && (
						<DropdownMenuItem className="gap-2.5" onClick={onClear}>
							<BellOff className="size-4 text-ink-2" />
							{clearLabel}
						</DropdownMenuItem>
					)}
				</>
			)}
		</DropdownMenuGroup>
	);
}

/** `datetime-local` wants local time without seconds. */
function localInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Tomorrow at 9:00, the usual "check back" time. */
function tomorrowMorning(now = new Date()): Date {
	const d = new Date(now);
	d.setDate(d.getDate() + 1);
	d.setHours(9, 0, 0, 0);
	return d;
}

/** A small dialog to pick the reminder's date and time. */
export function PickTimeDialog({
	open,
	onOpenChange,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (choice: RemindChoice) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="rounded-[24px] p-5 sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Remind me if no reply</DialogTitle>
					<DialogDescription>Raven reminds you then, unless someone has replied.</DialogDescription>
				</DialogHeader>
				{/* Mounts with the dialog, so each opening starts from tomorrow morning. */}
				<PickTimeForm
					onPick={(choice) => {
						onPick(choice);
						onOpenChange(false);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

function PickTimeForm({ onPick }: { onPick: (choice: RemindChoice) => void }) {
	const id = React.useId();
	const [openedAt] = React.useState(() => new Date());
	const [value, setValue] = React.useState(() => localInput(tomorrowMorning(openedAt)));
	const picked = value ? new Date(value) : null;
	const valid = Boolean(picked && picked.getTime() > openedAt.getTime());

	return (
		<>
			<label htmlFor={id} className="sr-only">
				Date and time
			</label>
			<Input
				id={id}
				type="datetime-local"
				value={value}
				min={localInput(openedAt)}
				onChange={(e) => setValue(e.target.value)}
				className="h-11 rounded-pill px-4"
			/>
			<DialogFooter className="-mx-5 -mb-5 rounded-b-[24px] px-5">
				<DialogClose render={<Button variant="surface" size="pill-sm" />}>Cancel</DialogClose>
				<Button
					size="pill-sm"
					disabled={!valid}
					onClick={() => {
						if (picked && picked.getTime() > Date.now()) onPick({ at: picked.toISOString() });
					}}
				>
					Set reminder
				</Button>
			</DialogFooter>
		</>
	);
}

/** A bell button with the remind menu and a tooltip, for compose and the Overview. */
export function RemindMenu({
	label,
	button,
	children,
	align = "start",
	...items
}: Omit<ItemsProps, "onCustom"> & {
	label: string;
	/** The trigger's look: a Button with no children. */
	button: React.ReactElement;
	children: React.ReactNode;
	align?: "start" | "end";
}) {
	const [picking, setPicking] = React.useState(false);
	return (
		<>
			<DropdownMenu>
				<Tip label={label} render={<DropdownMenuTrigger render={button} />}>
					{children}
				</Tip>
				<DropdownMenuContent align={align} className="w-64">
					<RemindItems {...items} onCustom={() => setPicking(true)} />
				</DropdownMenuContent>
			</DropdownMenu>
			<PickTimeDialog open={picking} onOpenChange={setPicking} onPick={items.onPick} />
		</>
	);
}
