import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KageEvalBoard } from "@/components/dev-kage/board";
import { readKageEval } from "@/lib/dev/kage-eval";

export const metadata: Metadata = { title: "Kage eval" };

/** Dev-only Kage scorecard; reads `.test-results/kage-eval.json` written by `bun run eval:kage` or the Run button. */
export default async function KageEvalPage() {
	if (process.env.NODE_ENV === "production") notFound();
	return <KageEvalBoard report={await readKageEval()} />;
}
