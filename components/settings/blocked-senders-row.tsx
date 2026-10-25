"use client";

import { AtSign, Globe, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DbCallout } from "@/components/integrations/db-callout";
import { SettingRow } from "@/components/settings/setting-row";
import { useBlockActions, useBlocks } from "@/hooks/use-blocks";
import { toApiError } from "@/lib/api-error";

/** Settings → Mail: everyone blocked, each with Unblock. Needs the database. */
export function BlockedSendersRow() {
	const { data, isPending, isError, error, refetch } = useBlocks();
	const { unblock } = useBlockActions();
	const problem = isError ? toApiError(error) : null;

	return (
		<SettingRow id="blocked" layout="stack">
			{(labelId) =>
				problem ? (
					<DbCallout
						compact
						problem={{ code: problem.code, message: problem.message, hint: problem.hint ?? "" }}
						onRetry={() => void refetch()}
					/>
				) : isPending || !data ? (
					<p className="flex items-center gap-2 text-[13px] text-ink-2">
						<LoaderCircle className="size-3.5 animate-spin" />
						Loading…
					</p>
				) : data.length === 0 ? (
					<p className="text-[13px] text-ink-2">
						No one is blocked. To block someone, open their email and pick Block in the ⋯ menu.
					</p>
				) : (
					<ul
						aria-labelledby={labelId}
						className="max-h-80 divide-y divide-border overflow-y-auto rounded-[18px] bg-card-nested ring-1 ring-border dark:divide-glass-border dark:ring-glass-border"
					>
						{data.map((b) => {
							const Icon = b.kind === "domain" ? Globe : AtSign;
							const label = b.kind === "domain" ? `Everyone at ${b.value}` : b.value;
							return (
								<li key={b.id} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3.5">
									<Icon aria-hidden className="size-4 shrink-0 text-ink-2" />
									<Tip label={label} render={<span className="min-w-0 flex-1 truncate text-[13px]" />}>
										{label}
									</Tip>
									<Button
										variant="ghost"
										size="pill-sm"
										aria-label={`Unblock ${label}`}
										disabled={b.id.startsWith("pending:")}
										onClick={() => void unblock(b)}
										className="text-ink-2"
									>
										<X />
										Unblock
									</Button>
								</li>
							);
						})}
					</ul>
				)
			}
		</SettingRow>
	);
}
