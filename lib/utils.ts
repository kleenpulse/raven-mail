import { createCn } from "cn/config";

// Custom theme scales from globals.css (`--radius-card`, `--shadow-glow`, `--text-kpi`…).
// Without registering them, `cn` treats e.g. `text-kpi` as a color and drops the
// wrong class when merging.
export const cn = createCn({
	extend: {
		theme: {
			radius: ["card", "frame", "pill"],
			shadow: ["card", "glow", "lift"],
			text: ["hero", "kpi", "kpi-sm", "micro"],
		},
	},
});

export function isMacOS(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac|iphone|ipad|ipod/i.test(
		navigator.platform || navigator.userAgent,
	);
}

export function modKeyLabel(): string {
	return isMacOS() ? "⌘" : "Ctrl";
}
