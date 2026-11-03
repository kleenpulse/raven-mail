"use client";

import * as React from "react";
import { InlineScript } from "@/components/ui/inline-script";
import { applyPrefAttrs, headScript, prefAttrNames } from "@/lib/prefs/dom";
import type { PrefKey } from "@/lib/prefs/schema";
import { usePrefsStore } from "@/lib/prefs/store";

/**
 * Puts visual prefs on <html>. The inline script covers hard loads before
 * paint; the layout effect covers client navigations, the dev Strict Mode
 * remount that strips <html> attributes, and every later change. Leaving a
 * page removes its attributes, so the landing and login never inherit zoom;
 * the landing mounts its own copy with `only` Reduce Motion.
 *
 * `only` must be a stable (module-level) array: it is an effect dependency.
 */
export function PrefsDom({ only }: { only?: readonly PrefKey[] }) {
	const script = React.useMemo(() => headScript(only), [only]);

	React.useLayoutEffect(() => {
		const root = document.documentElement;
		applyPrefAttrs(root, usePrefsStore.getState().overrides, only);
		const unsubscribe = usePrefsStore.subscribe((s) => applyPrefAttrs(root, s.overrides, only));
		return () => {
			unsubscribe();
			for (const attr of prefAttrNames(only)) root.removeAttribute(attr);
		};
	}, [only]);

	return <InlineScript html={script} />;
}
