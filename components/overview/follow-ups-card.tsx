"use client";

import Link from "next/link";
import { AlarmClock, ArrowUpRight, BellRing, Check, X } from "lucide-react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { RemindMenu } from "@/components/mail/remind-menu";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useFollowUpActions, useFollowUps } from "@/hooks/use-follow-ups";
import { followUpHref } from "@/lib/follow-ups/links";
import type { FollowUpView } from "@/lib/follow-ups/types";
import { dueLabel } from "@/lib/follow-ups/when";
import { formatRelative } from "@/lib/format";
import type { WaitingRef } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

function IconAction({ label, className, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
	return (
		<Tip
			label={label}
			render={
				<Button
					variant="surface"
					size="circle-sm"
					aria-label={label}
					className={cn("size-8 text-ink-2 hover:text-foreground", className)}
					{...props}
				/>
			}
		>
			{children}
		</Tip>
	);
}

function Row({ f, children }: { f: FollowUpView; children: React.ReactNode }) {
	return (
		<li className="flex items-center gap-2 rounded-[14px] px-2 py-1.5 transition-colors hover:bg-card-nested">
			<div className="min-w-0 flex-1 leading-snug">
				<p className="truncate text-[13px] font-medium">{f.to || "No reply yet"}</p>
				<p className="truncate text-[12px] text-ink-2">{f.subject || "(no subject)"}</p>
			</div>
			{children}
		</li>
	);
}

/**
 * Reminders set with "Remind me if no reply": the due ones first, with Done,
 * Snooze and Open, then what's coming up. Hidden when there are none (or no
 * database: the remind menus say so where reminders are set).
 */
export function FollowUpsCard({ className, i = 0 }: { className?: string; i?: number }) {
	const { data } = useFollowUps();
	const { done, snooze, cancel } = useFollowUpActions();
	if (!data?.length) return null;
	const due = data.filter((f) => f.due);
	const later = data.filter((f) => !f.due);

	return (
		<div className={className}>
			<Bento i={i} id="follow-ups" className="scroll-mt-24">
				<div className="flex items-baseline justify-between gap-2">
					<BentoTitle>Follow-ups</BentoTitle>
					<span className="font-mono text-[11px] text-ink-2 tabular">
						{due.length ? `${due.length} due` : "Nothing due"}
					</span>
				</div>
				<div className="mt-3 grid gap-4 md:grid-cols-2">
					<section aria-label="Due" className="min-w-0">
						<p className="px-2 text-[12px] text-ink-2">No reply yet</p>
						{due.length === 0 ? (
							<p className="mt-1 px-2 text-[13px] text-ink-2">You&apos;re all caught up.</p>
						) : (
							<ul className="mt-1 space-y-0.5">
								{due.map((f) => (
									<Row key={f.id} f={f}>
										<span className="hidden shrink-0 font-mono text-[11px] text-signal-ink tabular sm:inline dark:text-signal">
											{formatRelative(f.dueAt)}
										</span>
										<IconAction label="Done" onClick={() => void done(f)}>
											<Check />
										</IconAction>
										<IconAction label="Snooze 1 day" onClick={() => void snooze(f)}>
											<AlarmClock />
										</IconAction>
										<IconAction label="Open thread" render={<Link href={followUpHref(f)} />} nativeButton={false}>
											<ArrowUpRight />
										</IconAction>
									</Row>
								))}
							</ul>
						)}
					</section>
					{later.length > 0 && (
						<section aria-label="Coming up" className="min-w-0">
							<p className="px-2 text-[12px] text-ink-2">Coming up</p>
							<ul className="mt-1 space-y-0.5">
								{later.map((f) => (
									<Row key={f.id} f={f}>
										<span className="shrink-0 font-mono text-[11px] text-ink-2 tabular">{dueLabel(f.dueAt)}</span>
										<IconAction label="Cancel reminder" onClick={() => void cancel(f)}>
											<X />
										</IconAction>
									</Row>
								))}
							</ul>
						</section>
					)}
				</div>
			</Bento>
		</div>
	);
}

/** The bell on a "Gone quiet" row: remind me if they still haven't replied. */
export function GoneQuietRemind({ waiting }: { waiting: WaitingRef }) {
	const { data } = useFollowUps();
	const { remind, cancel } = useFollowUpActions();
	const current = waiting.messageId ? data?.find((f) => f.messageId === waiting.messageId) : undefined;
	const ref = { folder: waiting.folder, uid: waiting.uid };
	return (
		<RemindMenu
			label={current ? `Reminder set for ${dueLabel(current.dueAt)}` : `Remind me if ${waiting.to.name} doesn't reply`}
			align="end"
			button={
				<Button
					variant="ghost"
					size="circle-sm"
					aria-label={current ? `Reminder set for ${dueLabel(current.dueAt)}` : "Remind me if no reply"}
					className={cn("size-8 shrink-0 text-ink-2 hover:text-foreground", current && "text-signal-ink dark:text-signal")}
				/>
			}
			status={current ? `Set for ${dueLabel(current.dueAt)}` : undefined}
			onPick={(choice) => void remind(ref, choice)}
			onClear={current ? () => void cancel(current) : undefined}
		>
			<BellRing className={cn(current && "fill-current")} />
		</RemindMenu>
	);
}
