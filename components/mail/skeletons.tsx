import type * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Varied widths so the placeholder reads as text, not a grid of bars.
const ROW_WIDTHS = [
  ["w-28", "w-3/4", "w-1/2"],
  ["w-36", "w-2/3", "w-3/5"],
  ["w-24", "w-4/5", "w-2/5"],
  ["w-32", "w-3/5", "w-2/3"],
] as const;

const FOLDER_WIDTHS = ["w-14", "w-10", "w-12", "w-16", "w-10", "w-12"] as const;

const PAPER_LINES = [96, 88, 92, 64, 0, 90, 94, 72, 0, 48] as const;

/** Mirrors MailList: toolbar pills over MailRow-shaped cards. */
export function MailListSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <div role="status" className="flex h-full min-h-0 flex-col">
      <span className="sr-only">Loading messages…</span>
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-3 @md/list:px-4">
        <Skeleton className="h-10 w-36 rounded-pill" />
        <Skeleton className="h-10 w-34 rounded-pill" />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden px-3 pt-2.5 @md/list:px-4">
        {Array.from({ length: rows }).map((_, i) => {
          const [sender, subject, preview] = ROW_WIDTHS[i % ROW_WIDTHS.length]!;
          return (
            <div
              key={i}
              className="flex items-center gap-3 rounded-[20px] bg-card p-3 dark:ring-1 dark:ring-glass-border"
              style={{ opacity: Math.max(0.25, 1 - i * 0.09) }}
            >
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2 py-0.5">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className={cn("h-3.5", sender)} />
                  <Skeleton className="h-2.5 w-9" />
                </div>
                <Skeleton className={cn("h-3", subject)} />
                <Skeleton className={cn("h-2.5", preview)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mirrors MailReader: toolbar circles + pills, subject, message card, paper. */
export function ReaderSkeleton() {
  return (
    <div role="status" className="flex h-full min-h-0 flex-col">
      <span className="sr-only">Loading message…</span>
      <div className="flex h-16 shrink-0 items-center gap-1.5 px-3 @md/reader:px-5">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="size-9 rounded-full" />
        <div className="ml-auto flex items-center gap-1.5">
          <Skeleton className="h-9 w-9 rounded-pill @md/reader:w-24" />
          <Skeleton className="h-9 w-9 rounded-pill @md/reader:w-26" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 pt-3 @md/reader:px-6 @2xl/reader:px-8">
        <Skeleton className="h-6 w-4/5 @xl/reader:h-7" />
        <Skeleton className="mt-2.5 h-6 w-2/5 @xl/reader:h-7" />
        <Skeleton className="mt-4 h-7 w-36 rounded-pill" />
        <div className="bento mt-5 p-2">
          <div className="flex items-center gap-3 px-3 pt-3 pb-3.5">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="hidden space-y-2 @md/reader:block">
              <Skeleton className="ml-auto h-3 w-20" />
              <Skeleton className="h-2.5 w-32" />
            </div>
          </div>
          <div className="space-y-3 rounded-[20px] bg-card-nested px-8 py-8 dark:ring-1 dark:ring-glass-border">
            {PAPER_LINES.map((width, i) =>
              width ? (
                <Skeleton key={i} className="h-3" style={{ width: `${width}%` }} />
              ) : (
                <div key={i} className="h-2" />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mirrors the sidebar's folder pills. */
export function FolderSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" className="space-y-1">
      <span className="sr-only">Loading folders…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 rounded-pill pr-4 pl-3">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className={cn("h-3", FOLDER_WIDTHS[i % FOLDER_WIDTHS.length])} />
          <Skeleton className="ml-auto h-2.5 w-4" />
        </div>
      ))}
    </div>
  );
}

/**
 * Empty / error state for a mail pane: hairline rings around the raven's
 * eye (the same dot as the brand mark), then one line of display type.
 */
export function PaneState({
  title,
  children,
  action,
  tone = "signal",
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "signal" | "critical";
  className?: string;
}) {
  return (
    <div
      role={tone === "critical" ? "alert" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-center px-8 py-14 text-center",
        className,
      )}
    >
      <span aria-hidden className="relative grid size-24 place-items-center">
        <span className="absolute inset-0 rounded-full ring-1 ring-border dark:ring-glass-border" />
        <span className="absolute inset-4 rounded-full ring-1 ring-border dark:ring-glass-border" />
        <span className="grid size-8 place-items-center rounded-full bg-card-nested ring-1 ring-border dark:ring-glass-border">
          <span
            className={cn(
              "size-2 rounded-full",
              tone === "critical" ? "bg-critical" : "bg-signal",
            )}
          />
        </span>
      </span>
      <p className="mt-6 font-display text-xl leading-tight tracking-[-0.01em] text-foreground">
        {title}
      </p>
      {children && (
        <div className="mt-2 max-w-xs text-[13px] leading-relaxed text-ink-2">{children}</div>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
