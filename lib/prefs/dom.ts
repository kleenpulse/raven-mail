import type { Overrides, PrefKey } from "@/lib/prefs/schema";
import { PREFS_STORAGE_KEY } from "@/lib/prefs/store";

/**
 * Visual prefs reach the page as attributes on <html>, so CSS repaints and no
 * React tree re-renders. One table feeds both the pre-paint script and the
 * client applier; an absent attribute means the default.
 */
const ATTRS: ReadonlyArray<readonly [PrefKey, string, Readonly<Record<string, string>>]> = [
	["appearance.uiSize", "data-ui-size", { large: "large", larger: "larger" }],
	["appearance.density", "data-density", { compact: "compact" }],
	["appearance.motion", "data-motion", { reduce: "reduce" }],
	["appearance.reduceTransparency", "data-transparency", { true: "reduce" }],
];

/** Every visual pref, or just `only` (pages outside the app take a subset). */
function attrsFor(only?: readonly PrefKey[]) {
	return only ? ATTRS.filter(([key]) => only.includes(key)) : ATTRS;
}

export function prefAttrNames(only?: readonly PrefKey[]): string[] {
	return attrsFor(only).map(([, attr]) => attr);
}

export function prefsToAttrs(overrides: Overrides, only?: readonly PrefKey[]): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	for (const [key, attr, values] of attrsFor(only)) {
		const raw = String(overrides[key]);
		out[attr] = Object.hasOwn(values, raw) ? values[raw]! : null;
	}
	return out;
}

export function applyPrefAttrs(root: HTMLElement, overrides: Overrides, only?: readonly PrefKey[]) {
	for (const [attr, value] of Object.entries(prefsToAttrs(overrides, only))) {
		if (value === null) root.removeAttribute(attr);
		else root.setAttribute(attr, value);
	}
}

/** Runs during HTML parsing, before first paint. Only whitelisted values ever reach the DOM. */
export function headScript(only?: readonly PrefKey[]): string {
	return `(function(){try{var o=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_STORAGE_KEY)})||"null");o=o&&o.state&&o.state.overrides||{};var r=document.documentElement;${JSON.stringify(attrsFor(only))}.forEach(function(a){var v=String(o[a[0]]);if(Object.prototype.hasOwnProperty.call(a[2],v))r.setAttribute(a[1],a[2][v])})}catch(e){}})()`;
}

/**
 * Interface Size zoom. Pointer coordinates and getBoundingClientRect() are in
 * viewport px; CSS lengths inside the zoomed app frame are not. Divide by this.
 */
export function uiZoom(): number {
	const z = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom"));
	return z > 0 ? z : 1;
}
