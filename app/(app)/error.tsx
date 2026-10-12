"use client";

import { RotateCw } from "lucide-react";
import { PaneState } from "@/components/mail/skeletons";
import { Button } from "@/components/ui/button";

/** Page crashes land here, inside the shell, so the nav rail stays usable. */
export default function WorkspaceError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
	return (
		<div className="grid h-full place-items-center">
			<PaneState
				title="This view couldn’t load"
				tone="critical"
				action={
					<Button variant="surface" size="pill-sm" onClick={() => retry()}>
						<RotateCw />
						Try again
					</Button>
				}
			>
				Something went wrong while drawing it. Try again, or pick another tab.
			</PaneState>
		</div>
	);
}
