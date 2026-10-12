"use client";

import * as React from "react";
import { useAnimationLoop } from "@/hooks/use-animation-loop";
import { cn } from "@/lib/utils";

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// Units are section heights: y = 0 on the bottom edge, x runs 0 → aspect.
const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uPointer; // x, y, pull (0 → 1)
uniform vec3 uCore;
uniform vec3 uHaze;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return v;
}

void main() {
  vec2 p = gl_FragCoord.xy / uRes.y;
  float aspect = uRes.x / uRes.y;
  float cx = p.x - aspect * 0.5;
  float t = uTime;

  // The horizon arcs down at the edges, so the light tapers into the corners.
  float d = p.y + cx * cx * (0.3 / aspect);

  // Near the pointer the strands lean toward it and the light climbs to meet it.
  float dx = uPointer.x - p.x;
  float near = uPointer.z * exp(-dx * dx * 1.6) * exp(-max(uPointer.y - 0.3, 0.0) * 1.5);
  float lean = 0.3 * sin(t * 0.07 + cx * 1.3) + clamp(dx, -0.7, 0.7) * near * 2.4;

  // Shear the field along the lean: noise stretched that way reads as strands of smoke.
  vec2 q = vec2(cx - d * lean, d);
  vec2 warp = vec2(fbm(q * vec2(1.4, 2.2) + vec2(t * 0.04, -t * 0.07)),
                   fbm(q * vec2(1.4, 2.2) + vec2(5.2, 1.3) - t * 0.05));
  float body = fbm(vec2(q.x * 1.6 + warp.x * 1.2 + t * 0.03, q.y * 1.4 + warp.y * 0.8 - t * 0.06));
  float strands = fbm(vec2(q.x * 7.0 + warp.x * 2.5, q.y * 1.1 - t * 0.09));

  float reach = 0.06 + 0.24 * body * body + near * 0.3;
  float density = exp(-max(d, 0.0) / reach) * (0.35 + 1.3 * strands * body) * (1.0 + 0.9 * near);
  // A bright rim right on the horizon, the way light pools at the edge of a planet.
  density += exp(-max(d, 0.0) / 0.025) * 0.45;
  density *= smoothstep(-0.03, 0.0, d);
  // Gone well before the canvas's top edge, whatever the pointer pulls up.
  density *= 1.0 - smoothstep(0.45, 0.95, p.y);

  // Thin smoke falls off fast (thin gold over teal reads as olive), and it blends
  // mostly as light: alpha below coverage, so the sky behind stays lit.
  float a = pow(clamp(density, 0.0, 1.0), 1.5);
  vec3 col = mix(uHaze, uCore, smoothstep(0.35, 0.95, density));
  gl_FragColor = vec4(col * a, a * 0.7);
}
`;

/** Without WebGL: the same light, held still. */
const FALLBACK = "bg-[radial-gradient(60%_70%_at_50%_100%,rgb(230_194_122/0.4),rgb(230_194_122/0.1)_55%,transparent)]";

const CORE = [0.953, 0.851, 0.627]; // #f3d9a0
const HAZE = [0.902, 0.761, 0.478]; // #e6c27a

function compile(gl: WebGLRenderingContext, type: number, source: string) {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/**
 * Smoky first light on a curved horizon, drifting on its own and leaning toward
 * the pointer. Fills its parent; the bottom edge is the horizon. Without WebGL
 * it falls back to a still radial glow.
 */
export function HorizonAurora({
	paused = false,
	reducedMotion = false,
	className,
}: {
	paused?: boolean;
	reducedMotion?: boolean;
	className?: string;
}) {
	const ref = React.useRef<HTMLDivElement>(null);
	const draw = React.useRef<((dt: number) => void) | null>(null);
	const sized = React.useRef<((w: number, h: number) => void) | null>(null);

	const loop = useAnimationLoop({
		target: ref,
		halted: paused || reducedMotion,
		dpr: 1, // A soft field: device pixels would cost fill-rate for nothing.
		onResize: ({ bufferWidth, bufferHeight }) => sized.current?.(bufferWidth, bufferHeight),
		onFrame: ({ dt }) => (draw.current ? draw.current(reducedMotion ? 0 : dt) : false),
	});

	React.useEffect(() => {
		const host = ref.current;
		if (!host) return;
		// A fresh canvas per setup: Strict Mode's rerun must not inherit a context the cleanup lost.
		const canvas = document.createElement("canvas");
		canvas.className = "absolute inset-0 size-full";
		const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
		const vs = gl && compile(gl, gl.VERTEX_SHADER, VERTEX);
		const fs = gl && compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
		const program = gl?.createProgram();
		if (gl && vs && fs && program) {
			gl.attachShader(program, vs);
			gl.attachShader(program, fs);
			gl.linkProgram(program);
		}
		if (!gl || !program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
			host.classList.add(FALLBACK);
			return () => host.classList.remove(FALLBACK);
		}
		host.append(canvas);
		gl.useProgram(program);

		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, "position");
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		const uRes = gl.getUniformLocation(program, "uRes");
		const uTime = gl.getUniformLocation(program, "uTime");
		const uPointer = gl.getUniformLocation(program, "uPointer");
		gl.uniform3fv(gl.getUniformLocation(program, "uCore"), CORE);
		gl.uniform3fv(gl.getUniformLocation(program, "uHaze"), HAZE);

		// Pointer in section-height units, eased so the smoke drifts after it rather than snapping.
		const target = { x: 0, y: 0, pull: 0 };
		const eased = { x: 0, y: 0, pull: 0 };
		let time = 40; // Start mid-drift, not on the noise's tidy origin.

		const onMove = (e: PointerEvent) => {
			const rect = canvas.getBoundingClientRect();
			if (!rect.height) return;
			const inRange = e.clientY > rect.top - rect.height && e.pointerType !== "touch";
			target.pull = inRange ? 1 : 0;
			// Out of range, the anchor stays where the pointer left: the plume sinks
			// in place instead of chasing the pointer up and thinning out early.
			if (!inRange) return;
			target.x = (e.clientX - rect.left) / rect.height;
			target.y = (rect.bottom - e.clientY) / rect.height;
			if (eased.pull < 0.01) Object.assign(eased, { x: target.x, y: target.y });
		};
		const onLeave = () => {
			target.pull = 0;
		};
		window.addEventListener("pointermove", onMove, { passive: true });
		document.documentElement.addEventListener("pointerleave", onLeave);

		sized.current = (w, h) => {
			canvas.width = w;
			canvas.height = h;
			gl.viewport(0, 0, w, h);
			gl.uniform2f(uRes, w, h);
		};
		draw.current = (dt) => {
			time += dt;
			const k = Math.min(1, dt * 2.2);
			eased.x += (target.x - eased.x) * k;
			eased.y += (target.y - eased.y) * k;
			// Settles back slower than it gathers, so letting go reads as the smoke drifting home.
			const rate = target.pull > eased.pull ? 1.5 : 0.9;
			eased.pull += (target.pull - eased.pull) * Math.min(1, dt * rate);
			gl.uniform1f(uTime, time);
			gl.uniform3f(uPointer, eased.x, eased.y, eased.pull);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		};
		loop.resize();

		return () => {
			window.removeEventListener("pointermove", onMove);
			document.documentElement.removeEventListener("pointerleave", onLeave);
			draw.current = null;
			sized.current = null;
			canvas.remove();
			gl.getExtension("WEBGL_lose_context")?.loseContext();
		};
	}, [loop]);

	return <div ref={ref} aria-hidden className={cn("pointer-events-none", className)} />;
}
