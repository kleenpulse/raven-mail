"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, FolderInput, LoaderCircle, MailOpen, Play, Star, Trash2, Undo2 } from "lucide-react";
import { DbCallout } from "@/components/integrations/db-callout";
import { SettingRow } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { useFolders } from "@/hooks/use-mail";
import { useRuleActions, useRuleEvents, useRules } from "@/hooks/use-rules";
import { toApiError } from "@/lib/api-error";
import { formatRelative } from "@/lib/format";
import { RULE_ACTIONS, RULE_CRITERIA_MAX, RUN_RECENT, type PreviewItem, type RuleAction, type RuleDTO } from "@/lib/rules/types";
import { cn } from "@/lib/utils";

const ACTION_LABEL: Record<RuleAction, string> = {
	move: "Move to a folder",
	archive: "Archive",
	star: "Star",
	read: "Mark read",
	trash: "Move to Trash",
};
const ACTION_ICON: Record<RuleAction, React.ComponentType<{ className?: string }>> = {
	move: FolderInput,
	archive: Archive,
	star: Star,
	read: MailOpen,
	trash: Trash2,
};

function actionText(rule: Pick<RuleDTO, "action" | "folder">): string {
	return rule.action === "move" ? `Move to ${rule.folder ?? "a folder"}` : ACTION_LABEL[rule.action];
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** The no-database (or not migrated) problem, if that's why rules can't load. */
function useRulesProblem() {
	const { isError, error, refetch } = useRules();
	const problem = isError ? toApiError(error) : null;
	return { problem: problem ? { code: problem.code ?? "", message: problem.message, hint: problem.hint ?? "" } : null, refetch };
}

function IconButton({ label, className, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
	return (
		<Tip label={label} render={<Button variant="ghost" size="circle-sm" aria-label={label} className={cn("size-8 text-ink-2 hover:text-foreground", className)} {...props} />}>
			{children}
		</Tip>
	);
}

/** Settings → Rules: the list in run order, on/off, reorder, delete, and Run rules now. */
export function RulesListRow() {
	const { data, isPending } = useRules();
	const { problem, refetch } = useRulesProblem();
	const { update, move, remove, runNow } = useRuleActions();
	const [running, setRunning] = React.useState(false);
	const rules = data?.rules ?? [];
	const canRun = Boolean(data?.engine) && rules.some((r) => r.enabled);

	return (
		<SettingRow id="rules-list" layout="stack">
			{(labelId) =>
				problem ? (
					<DbCallout compact problem={problem} onRetry={() => void refetch()} />
				) : isPending || !data ? (
					<p className="flex items-center gap-2 text-[13px] text-ink-2">
						<LoaderCircle className="size-3.5 animate-spin" />
						Loading…
					</p>
				) : (
					<div className="space-y-3">
						{rules.length === 0 ? (
							<p className="text-[13px] text-ink-2">No rules yet. Add one below.</p>
						) : (
							<ol
								aria-labelledby={labelId}
								className="divide-y divide-border rounded-[18px] bg-card-nested ring-1 ring-border dark:divide-glass-border dark:ring-glass-border"
							>
								{rules.map((rule, i) => {
									const Icon = ACTION_ICON[rule.action];
									return (
										<li key={rule.id} className="flex items-center gap-2 py-2 pr-1.5 pl-3">
											<Switch
												checked={rule.enabled}
												onCheckedChange={(enabled) => void update(rule, { enabled })}
												aria-label={`${rule.enabled ? "Turn off" : "Turn on"}: ${rule.criteria}`}
											/>
											<div className={cn("min-w-0 flex-1 leading-snug", !rule.enabled && "opacity-60")}>
												<p className="line-clamp-2 text-[13px] break-words">{rule.criteria}</p>
												<p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-2">
													<Icon className="size-3.5" />
													{actionText(rule)}
												</p>
											</div>
											<IconButton label="Run earlier" disabled={i === 0} onClick={() => void move(rule, "up")}>
												<ArrowUp />
											</IconButton>
											<IconButton label="Run later" disabled={i === rules.length - 1} onClick={() => void move(rule, "down")}>
												<ArrowDown />
											</IconButton>
											<IconButton label="Delete rule" className="hover:text-destructive" onClick={() => void remove(rule)}>
												<Trash2 />
											</IconButton>
										</li>
									);
								})}
							</ol>
						)}
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<Button
								variant="surface"
								size="pill-sm"
								disabled={!canRun || running}
								onClick={async () => {
									setRunning(true);
									await runNow();
									setRunning(false);
								}}
							>
								{running ? <LoaderCircle className="animate-spin" /> : <Play />}
								Run rules now
							</Button>
							<p className="text-[12px] text-ink-2">
								{data.engine === null
									? "Rules can't run here: Kage is off and there's no Jev key."
									: `Rules run while Raven is open, on new mail and when you click Run. ${data.engine === "jev" ? "Jev" : "Kage, Raven's built-in engine,"} decides.`}
							</p>
						</div>
					</div>
				)
			}
		</SettingRow>
	);
}

function PreviewList({ items }: { items: PreviewItem[] }) {
	const matches = items.filter((i) => i.wouldApply);
	const held = items.filter((i) => !i.wouldApply && i.why.includes("you write to"));
	return (
		<div role="status" className="space-y-2 rounded-[18px] bg-card-nested p-3 ring-1 ring-border dark:ring-glass-border">
			<p className="text-[13px] font-medium">
				{matches.length
					? `Would match ${matches.length} of the last ${items.length}`
					: `Would match none of the last ${items.length}. Try other words.`}
			</p>
			{matches.length > 0 && (
				<ul className="space-y-1">
					{matches.slice(0, 8).map((m) => (
						<li key={m.uid} className="flex items-baseline gap-2 text-[12px]">
							<span className="min-w-0 flex-1 truncate">
								<span className="font-medium">{m.from}</span> <span className="text-ink-2">{m.subject}</span>
							</span>
							<span className="shrink-0 font-mono text-[11px] text-ink-2 tabular">{pct(m.probability)}</span>
						</li>
					))}
					{matches.length > 8 && <li className="text-[12px] text-ink-2">and {matches.length - 8} more</li>}
				</ul>
			)}
			{held.length > 0 && (
				<p className="text-[12px] text-ink-2">
					{held.length} more {held.length === 1 ? "matches" : "match"}, but {held.length === 1 ? "it's" : "they're"} from people you write to, so{" "}
					{held.length === 1 ? "it stays" : "they stay"}.
				</p>
			)}
		</div>
	);
}

/** Settings → Rules → New rule: words, an action, a preview on the last 50, then save. */
export function NewRuleRow() {
	const params = useSearchParams();
	const { problem } = useRulesProblem();
	const { data: folders } = useFolders();
	const { create, preview } = useRuleActions();
	const id = React.useId();
	const [criteria, setCriteria] = React.useState(() => params.get("rule")?.slice(0, RULE_CRITERIA_MAX) ?? "");
	const [action, setAction] = React.useState<RuleAction>("archive");
	const [folder, setFolder] = React.useState("");
	const [busy, setBusy] = React.useState<"preview" | "save" | null>(null);
	const [result, setResult] = React.useState<{ key: string; items: PreviewItem[] } | null>(null);

	const input = { criteria: criteria.trim(), action, ...(action === "move" ? { folder } : {}) };
	const key = JSON.stringify(input);
	const ready = Boolean(input.criteria) && (action !== "move" || Boolean(folder));
	const previewed = result?.key === key;
	const folderItems = (folders ?? [])
		.filter((f) => f.specialUse !== "\\Inbox" && f.specialUse !== "\\Drafts")
		.map((f) => ({ value: f.path, label: f.name }));
	const actionItems = RULE_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] }));

	if (problem) return null;

	return (
		<SettingRow id="rules-new" layout="stack">
			{() => (
				<div className="space-y-3">
					<label htmlFor={`${id}-criteria`} className="block text-[12px] text-ink-2">
						When an email is…
					</label>
					<Textarea
						id={`${id}-criteria`}
						value={criteria}
						onChange={(e) => setCriteria(e.target.value.slice(0, RULE_CRITERIA_MAX))}
						maxLength={RULE_CRITERIA_MAX}
						rows={2}
						placeholder="receipts and invoices from shops"
						className="min-h-16 resize-y text-[13px]"
					/>
					<div className="grid gap-2 sm:grid-cols-2">
						<Select items={actionItems} value={action} onValueChange={(v) => v && setAction(v as RuleAction)}>
							<SelectTrigger aria-label="Then" className="w-full rounded-xl bg-sheet px-3.5 data-[size=default]:h-10 dark:bg-card-nested">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{actionItems.map((a) => (
									<SelectItem key={a.value} value={a.value}>
										{a.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{action === "move" && (
							<Select items={folderItems} value={folder || null} onValueChange={(v) => setFolder((v as string) ?? "")}>
								<SelectTrigger aria-label="Folder" className="w-full rounded-xl bg-sheet px-3.5 data-[size=default]:h-10 dark:bg-card-nested">
									<SelectValue placeholder="Pick a folder" />
								</SelectTrigger>
								<SelectContent>
									{folderItems.map((f) => (
										<SelectItem key={f.value} value={f.value}>
											{f.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
					{action === "trash" && (
						<p className="text-[12px] text-ink-2">Trash only happens when Raven is very sure, and never to people you write to.</p>
					)}
					{previewed && <PreviewList items={result.items} />}
					<div className="flex flex-wrap gap-2">
						<Button
							variant="surface"
							size="pill-sm"
							disabled={!ready || busy !== null}
							onClick={async () => {
								setBusy("preview");
								const items = await preview(input);
								setBusy(null);
								if (items) setResult({ key, items });
							}}
						>
							{busy === "preview" && <LoaderCircle className="animate-spin" />}
							Preview on the last {RUN_RECENT}
						</Button>
						<Tip
							label={previewed ? "Save this rule" : "Preview it first"}
							render={
								<Button
									size="pill-sm"
									disabled={!ready || !previewed || busy !== null}
									onClick={async () => {
										setBusy("save");
										const saved = await create(input);
										setBusy(null);
										if (saved) {
											setCriteria("");
											setResult(null);
										}
									}}
								/>
							}
						>
							{busy === "save" && <LoaderCircle className="animate-spin" />}
							Save rule
						</Tip>
					</div>
				</div>
			)}
		</SettingRow>
	);
}

/** Settings → Rules → Recent activity: what rules did, how sure, and Undo for moves. */
export function RuleActivityRow() {
	const { problem } = useRulesProblem();
	const { data, isPending, isError, error, refetch } = useRuleEvents({ enabled: !problem });
	const { undo } = useRuleActions();
	const [undoing, setUndoing] = React.useState<string | null>(null);

	if (problem) return null;
	const failed = isError ? toApiError(error) : null;

	return (
		<SettingRow id="rules-activity" layout="stack">
			{(labelId) =>
				failed ? (
					<DbCallout compact problem={{ code: failed.code ?? "", message: failed.message, hint: failed.hint ?? "" }} onRetry={() => void refetch()} />
				) : isPending || !data ? (
					<p className="flex items-center gap-2 text-[13px] text-ink-2">
						<LoaderCircle className="size-3.5 animate-spin" />
						Loading…
					</p>
				) : data.length === 0 ? (
					<p className="text-[13px] text-ink-2">Nothing yet. What your rules do shows up here.</p>
				) : (
					<ul
						aria-labelledby={labelId}
						className="max-h-96 divide-y divide-border overflow-y-auto rounded-[18px] bg-card-nested ring-1 ring-border dark:divide-glass-border dark:ring-glass-border"
					>
						{data.map((e) => {
							const Icon = ACTION_ICON[e.action];
							const stuck = e.applied && !e.undone && !e.undoable && (e.action === "move" || e.action === "archive" || e.action === "trash");
							return (
								<li key={e.id} className="flex items-center gap-3 py-2 pr-2 pl-3">
									<Icon className={cn("size-4 shrink-0", e.applied && !e.undone ? "text-signal-ink dark:text-signal" : "text-ink-3")} />
									<div className="min-w-0 flex-1 leading-snug">
										<p className="truncate text-[13px]">{e.subject || "(no subject)"}</p>
										<p className="truncate text-[12px] text-ink-2">
											{e.undone ? "Undone. " : ""}
											{e.why}
										</p>
										<p className="truncate font-mono text-[11px] text-ink-3">
											{e.from} · {formatRelative(e.createdAt)}
										</p>
									</div>
									{e.undoable ? (
										<Button
											variant="surface"
											size="pill-sm"
											disabled={undoing === e.id}
											onClick={async () => {
												setUndoing(e.id);
												await undo(e);
												setUndoing(null);
											}}
										>
											{undoing === e.id ? <LoaderCircle className="animate-spin" /> : <Undo2 />}
											Undo
										</Button>
									) : stuck ? (
										<Tip
											label="Your mail server didn't say where it went, so Raven can't undo this one. Find it in the folder."
											render={<span tabIndex={0} className="shrink-0 rounded-pill px-2 py-1 text-[12px] text-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />}
										>
											No undo
										</Tip>
									) : null}
								</li>
							);
						})}
					</ul>
				)
			}
		</SettingRow>
	);
}
