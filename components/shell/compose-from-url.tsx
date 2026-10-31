"use client";

import * as React from "react";
import { useQueryState } from "nuqs";
import { mailtoDraft } from "@/lib/mail/headers";
import { useComposeStore } from "@/lib/store/compose";

/**
 * `?compose=<mailto link>` on any page opens it in compose, then leaves the
 * URL so a reload or Back doesn't open it again. The desktop app sends
 * `mailto:` links here; a link someone else wrote only fills a draft.
 */
export function ComposeFromUrl() {
	const [compose, setCompose] = useQueryState("compose");
	const openCompose = useComposeStore((s) => s.openCompose);
	// Strict Mode runs the effect twice before the URL clears.
	const handled = React.useRef<string | null>(null);

	React.useEffect(() => {
		if (compose === null) {
			handled.current = null;
			return;
		}
		if (handled.current === compose) return;
		handled.current = compose;
		void setCompose(null);
		const draft = mailtoDraft(compose);
		if (draft) openCompose("new", draft);
	}, [compose, setCompose, openCompose]);

	return null;
}
