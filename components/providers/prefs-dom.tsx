"use client";

import * as React from "react";
import { InlineScript } from "@/components/ui/inline-script";
import { applyPrefAttrs, headScript, PREF_ATTR_NAMES } from "@/lib/prefs/dom";
import { usePrefsStore } from "@/lib/prefs/store";

const SCRIPT = headScript();

/**
 * Puts visual prefs on <html>. The inline script covers hard loads before
 * paint; the layout effect covers client navigations, the dev Strict Mode
 * remount that strips <html> attributes, and every later change. Leaving the
 * app (landing, login) removes them, so those pages never inherit zoom.
 */
export function PrefsDom() {
	React.useLayoutEffect(() => {
		const root = document.documentElement;
		applyPrefAttrs(root, usePrefsStore.getState().overrides);
		const unsubscribe = usePrefsStore.subscribe((s) => applyPrefAttrs(root, s.overrides));
		return () => {
			unsubscribe();
			for (const attr of PREF_ATTR_NAMES) root.removeAttribute(attr);
		};
	}, []);

	return <InlineScript html={SCRIPT} />;
}
