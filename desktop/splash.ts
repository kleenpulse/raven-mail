import type { TitleBarColors } from "./bridge";

/*
 * The start screen: what the window shows from the moment it opens until
 * the local server answers. It is one inline page (a data: URL) because
 * nothing else exists yet to load from: no server, so no fonts, images or
 * scripts of the app's. The raven mark is the app's own glyph
 * (components/shell/raven-mark.tsx).
 *
 * The three steps under the mark follow what the server really reports
 * (see ServerPhase), not a timer. The colours follow the theme the page had
 * last time, which the shell keeps in settings.json, so a light theme
 * doesn't start with a dark flash.
 */

/** The title bar's colours until a page has ever said its own: Nebula's. */
export const SPLASH_DEFAULTS: TitleBarColors = { color: "#050a0b", symbol: "#9aa3a5" };

export type SplashPalette = {
	background: string;
	ink: string;
	ink2: string;
	ink3: string;
	signal: string;
	orbit: string;
	ring: string;
	glow: string;
	floor: string;
	track: string;
};

const NEBULA: SplashPalette = {
	background: SPLASH_DEFAULTS.color,
	ink: "#eaf2f1",
	ink2: "#9fb3b1",
	ink3: "#5f7573",
	signal: "#e6c27a",
	orbit: "#5ee1d9",
	ring: "rgb(230 194 122 / 0.55)",
	glow: "rgb(94 225 217 / 0.13)",
	floor: "rgb(230 194 122 / 0.1)",
	track: "rgb(160 220 215 / 0.12)",
};

const EMBER: SplashPalette = {
	background: "#f3f3f1",
	ink: "#111111",
	ink2: "#55554f",
	ink3: "#8a8a82",
	signal: "#c84e2a",
	orbit: "#c84e2a",
	ring: "rgb(17 17 17 / 0.85)",
	glow: "rgb(200 78 42 / 0.07)",
	floor: "rgb(17 17 17 / 0.04)",
	track: "rgb(17 17 17 / 0.1)",
};

/** Whether a `#rrggbb` colour is a light one (by how bright the eye finds it). */
export function isLight(hex: string): boolean {
	const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
	return (0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)) / 255 > 0.5;
}

/** The skin that goes with the page's last background, on that exact background. */
export function splashPalette(saved: TitleBarColors | null): SplashPalette {
	if (!saved) return NEBULA;
	return { ...(isLight(saved.color) ? EMBER : NEBULA), background: saved.color };
}

/** What each step says, in order. */
export const SPLASH_STEPS = ["Waking up", "Opening your mail store", "Getting your overview ready"] as const;

export type SplashStep = 0 | 1 | 2;

/** How long before the start screen admits it's slow. */
const SLOW_AFTER_MS = 12_000;

export function splashHtml(palette: SplashPalette): string {
	const p = palette;
	return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Raven</title>
<style>
html,body{height:100%;margin:0}
body{background:${p.background};color:${p.ink};font:14px "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;display:grid;place-items:center;overflow:hidden;user-select:none}
.drag{position:fixed;inset:0 0 auto 0;height:32px;-webkit-app-region:drag}
.sky{position:fixed;inset:0;pointer-events:none;background:radial-gradient(46vmin circle at 50% 44%,${p.glow},transparent 72%),radial-gradient(80vmax circle at 50% 125%,${p.floor},transparent 62%)}
.stage{position:relative;display:grid;justify-items:center;gap:22px;animation:rise .7s cubic-bezier(.2,.8,.2,1) both}
.mark{position:relative;width:92px;height:92px}
.mark svg{width:100%;height:100%;overflow:visible}
.halo{position:absolute;inset:-18px;border-radius:50%;background:radial-gradient(closest-side,${p.floor},transparent 70%);animation:breathe 3.2s ease-in-out infinite}
.ring{fill:none;stroke:${p.ring};stroke-width:1;stroke-dasharray:289;stroke-dashoffset:289;animation:draw 1.1s .15s cubic-bezier(.6,0,.2,1) forwards}
.orbit{fill:none;stroke:${p.orbit};stroke-width:1.6;stroke-linecap:round;stroke-dasharray:34 255;transform-origin:50px 50px;opacity:0;animation:spin 1.6s 1.2s linear infinite,show .4s 1.2s forwards}
.glyph{fill:none;stroke:${p.signal};stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:60;stroke-dashoffset:60;animation:draw .9s .55s cubic-bezier(.6,0,.2,1) forwards}
.eye{fill:${p.signal};transform-origin:15.4px 9.1px;transform:scale(0);animation:pop .45s 1.35s cubic-bezier(.16,1,.3,1) forwards}
.name{font-size:22px;font-weight:600;letter-spacing:-.01em;animation:rise .6s .35s both}
.step{min-height:14px;font:500 10.5px ui-monospace,"Cascadia Mono","SF Mono",Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:${p.ink2};transition:opacity .18s ease;animation:rise .6s .5s both}
.step.out{opacity:0}
.steps{display:flex;gap:6px;animation:rise .6s .6s both}
.steps i{width:28px;height:2px;border-radius:2px;background:${p.track};overflow:hidden;position:relative}
.steps i::after{content:"";position:absolute;inset:0;background:${p.signal};transform:scaleX(0);transform-origin:left;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.steps i.done::after{transform:scaleX(1)}
.steps i.now::after{transform:scaleX(1);opacity:.45;animation:pulse 1.1s ease-in-out infinite}
.slow{position:fixed;bottom:28px;left:0;right:0;text-align:center;font-size:12px;color:${p.ink3};opacity:0;transition:opacity .6s ease}
.slow.on{opacity:1}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes show{to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pop{to{transform:scale(1)}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
@keyframes breathe{50%{transform:scale(1.12);opacity:.7}}
@keyframes pulse{50%{opacity:.9}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.ring,.glyph{stroke-dashoffset:0}.eye{transform:none}.orbit{opacity:1}}
</style>
<div class="sky"></div>
<div class="drag"></div>
<main class="stage" role="status" aria-live="polite">
<div class="mark" aria-hidden="true">
<div class="halo"></div>
<svg viewBox="0 0 100 100">
<circle class="ring" cx="50" cy="50" r="46" transform="rotate(-90 50 50)"/>
<circle class="orbit" cx="50" cy="50" r="46"/>
<g transform="translate(26 26) scale(2)">
<path class="glyph" d="M5.5 16.5c2.4-6.1 6.4-9.4 12.5-10-2.3 1.6-3.6 3.6-4 6.1 2.1-.9 3.9-.9 5.5-.1-3.4.6-6.2 2.2-8.3 4.8"/>
<circle class="eye" cx="15.4" cy="9.1" r="1.25"/>
</g>
</svg>
</div>
<div class="name">Raven</div>
<div class="step" id="step">${SPLASH_STEPS[0]}</div>
<div class="steps" aria-hidden="true"><i class="now"></i><i></i><i></i></div>
</main>
<div class="slow" id="slow">This is taking longer than usual. Your computer may be busy.</div>
<script>
var STEPS=${JSON.stringify(SPLASH_STEPS)},label=document.getElementById("step"),bars=[].slice.call(document.querySelectorAll(".steps i")),at=0;
function setStep(n){if(!(n>at)||n>=STEPS.length)return;at=n;bars.forEach(function(bar,i){bar.className=i<n?"done":i===n?"now":""});label.classList.add("out");setTimeout(function(){label.textContent=STEPS[at];label.classList.remove("out")},180)}
setTimeout(function(){document.getElementById("slow").classList.add("on")},${SLOW_AFTER_MS});
</script>
</html>`;
}

export function splashUrl(saved: TitleBarColors | null): string {
	return `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(splashPalette(saved)))}`;
}

/** Script for the start screen's page: move it on to a step. Steps only go forward. */
export function splashStepScript(step: SplashStep): string {
	return `typeof setStep==="function"&&setStep(${step})`;
}
