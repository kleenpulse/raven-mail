import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TestsBoard } from "@/components/dev-tests/board";
import { readHistory, readLatest } from "@/lib/dev/test-store";

export const metadata: Metadata = { title: "Tests" };

/** Dev-only test dashboard; reads `.test-results/` written by `bun run test:report`. */
export default async function TestsPage() {
	if (process.env.NODE_ENV === "production") notFound();
	const [report, history] = await Promise.all([readLatest(), readHistory()]);
	return <TestsBoard report={report} history={history} />;
}
