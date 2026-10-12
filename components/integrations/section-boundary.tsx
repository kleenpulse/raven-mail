"use client";

import { catchError, type ErrorInfo } from "next/error";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function SectionFallback({ title, className }: { title: string; className?: string }, { error, retry }: ErrorInfo) {
	return (
		<div
			role="alert"
			className={cn(
				"flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card bg-card-nested px-5 py-4 ring-1 ring-critical/25",
				className,
			)}
		>
			<span aria-hidden className="size-2 rounded-full bg-critical" />
			<div className="min-w-0 flex-1">
				<p className="text-[14px] font-medium">{title} hit a snag</p>
				<p className="mt-0.5 text-[12px] text-ink-2">{error instanceof Error && error.message ? error.message : "Something broke while drawing this section."}</p>
			</div>
			<Button variant="surface" size="pill-sm" onClick={() => retry()}>
				<RotateCw />
				Try again
			</Button>
		</div>
	);
}

/** One broken card must not blank the page: each section recovers on its own. */
export const SectionBoundary = catchError(SectionFallback);
