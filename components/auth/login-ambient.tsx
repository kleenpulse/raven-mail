"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const AMBIENT_CSS = `
.rv-ripple{opacity:0;transform-box:fill-box;transform-origin:center;animation:rv-ripple 7.2s cubic-bezier(.23,1,.32,1) infinite;animation-play-state:var(--rv-play,running)}
.rv-orbit{transform-origin:200px 200px;animation:rv-spin 96s linear infinite;animation-play-state:var(--rv-play,running)}
.rv-orbit-2{animation-duration:150s;animation-direction:reverse}
.rv-glow{opacity:.6;transform-box:fill-box;transform-origin:center;animation:rv-breathe 6.4s ease-in-out infinite;animation-play-state:var(--rv-play,running)}
.rv-twinkle{opacity:.7;animation:rv-twinkle 5.2s ease-in-out infinite;animation-play-state:var(--rv-play,running)}
@keyframes rv-ripple{from{opacity:.55;transform:scale(.18)}to{opacity:0;transform:scale(1)}}
@keyframes rv-spin{to{transform:rotate(360deg)}}
@keyframes rv-breathe{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:.95;transform:scale(1.15)}}
@keyframes rv-twinkle{0%,100%{opacity:.3}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.rv-ripple,.rv-orbit,.rv-glow,.rv-twinkle{animation:none}}
`;

const RINGS = [
  { r: 40, o: 0.5 },
  { r: 72, o: 0.36 },
  { r: 104, o: 0.26 },
  { r: 136, o: 0.18 },
  { r: 168, o: 0.12 },
  { r: 196, o: 0.08 },
] as const;

// [x, y, radius, kind] — kind 1/2 are the lit stars (gold / cyan) that breathe. The page
// shows roughly x 110–250 of the viewBox (left fades under a mask, right sits under the sheet).
const STARS: [number, number, number, 0 | 1 | 2][] = [
  [128, 70, 1.6, 0],
  [176, 118, 2.8, 1],
  [216, 62, 1.8, 0],
  [244, 150, 1.6, 0],
  [228, 236, 2.6, 2],
  [192, 192, 1.5, 0],
  [150, 300, 2.8, 1],
  [206, 336, 1.8, 0],
  [112, 236, 2, 0],
  [88, 156, 1.4, 0],
  [258, 302, 1.6, 0],
];

const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 5],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 8],
  [8, 6],
  [6, 7],
  [7, 10],
  [4, 10],
  [9, 0],
  [9, 8],
];

/**
 * The login's quiet ambient mark. Ember: coral rings rippling out from the
 * raven's eye. Nebula: a small constellation whose lit stars breathe.
 * Animation pauses offscreen, in hidden tabs, and under reduced motion.
 */
export function LoginAmbient({ className }: { className?: string }) {
  const ref = React.useRef<SVGSVGElement>(null);

  React.useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    let onScreen = true;
    const sync = () =>
      svg.style.setProperty("--rv-play", onScreen && !document.hidden ? "running" : "paused");
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      sync();
    });
    observer.observe(svg);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <svg ref={ref} viewBox="0 0 400 400" fill="none" aria-hidden className={className}>
      <style>{AMBIENT_CSS}</style>

      <g className="dark:hidden">
        <circle cx="200" cy="200" r="30" className="fill-signal-soft" />
        {RINGS.map(({ r, o }) => (
          <circle key={r} cx="200" cy="200" r={r} className="stroke-signal" strokeOpacity={o} />
        ))}
        {[0, -2.4, -4.8].map((delay) => (
          <circle
            key={delay}
            cx="200"
            cy="200"
            r="196"
            strokeWidth="1.25"
            className="rv-ripple stroke-signal"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
        <g className="rv-orbit">
          <circle cx="200" cy="96" r="3.5" className="fill-foreground" />
          <circle cx="336" cy="200" r="2.5" className="fill-signal" />
        </g>
        <g className="rv-orbit rv-orbit-2">
          <circle cx="104" cy="104" r="2.5" className="fill-foreground" fillOpacity={0.55} />
          <circle cx="200" cy="396" r="3" className="fill-signal" fillOpacity={0.7} />
        </g>
        <circle cx="200" cy="200" r="7" className="fill-signal" />
      </g>

      <g className="hidden dark:inline">
        <circle cx="210" cy="210" r="170" className="fill-signal-2" fillOpacity={0.035} />
        {LINKS.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={STARS[a]![0]}
            y1={STARS[a]![1]}
            x2={STARS[b]![0]}
            y2={STARS[b]![1]}
            className="stroke-beam-3"
            strokeWidth="1"
          />
        ))}
        {STARS.map(([x, y, r, kind], i) =>
          kind === 0 ? (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={r}
              className={cn("fill-foreground", i % 3 === 0 && "rv-twinkle")}
              style={i % 3 === 0 ? { animationDelay: `${-i * 0.7}s` } : undefined}
            />
          ) : (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={r * 7}
                className={cn("rv-glow", kind === 1 ? "fill-signal" : "fill-signal-2")}
                fillOpacity={0.16}
                style={{ animationDelay: `${-i * 0.9}s` }}
              />
              <circle
                cx={x}
                cy={y}
                r={r}
                className={kind === 1 ? "fill-signal" : "fill-signal-2"}
              />
            </g>
          ),
        )}
      </g>
    </svg>
  );
}
