// Pre-generates the welcome tour's narration: one mp3 per TOUR_STEPS entry
// with tts enabled, per accent. Run: `bun run tour:audio` (dev-time only —
// the app never calls a TTS API at runtime; the client resolves clips through
// the generated manifest).
//
//   us → ElevenLabs ("Sarah")          gb → Mistral Voxtral (gb_jane_neutral)
//
// No cross-provider fallback: a US clip from Mistral would be the wrong
// accent. A failed clip keeps its previous version (flagged STALE) or goes
// missing, and the client paces the text on a timer instead.
//
// Output:
//   public/tour/<voice>/<stepId>.<hash>.mp3     — the audio assets (committed)
//   components/tour/tour-audio.manifest.ts      — GENERATED manifest (committed)
//
// hash = clipHash(voice, body) (lib/tour/clip-hash.ts) — editing copy or
// bumping AUDIO_VERSION is a clean miss, so voice and text can't silently drift.
// Idempotent: a second run with unchanged copy is all cache hits.
//
// Env (dev-only; absent → that accent's clips are skipped):
//   ELEVEN_LABS      — ElevenLabs API key (note: NOT ELEVENLABS_API_KEY)
//   MISTRAL_API_KEY  — Mistral API key

import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { TOUR_STEPS } from "../components/tour/tour.config";
import { TOUR_VOICES, type TourVoice } from "../lib/tour/types";
import { clipHash } from "../lib/tour/clip-hash";

// Mirror Next's precedence: .env.local wins over .env (loadEnvFile never
// overrides an already-set var). drizzle.config.ts precedent.
for (const file of [".env.local", ".env"]) {
	try {
		process.loadEnvFile(file);
	} catch {
		// file absent — ambient env only
	}
}

// `bun run` executes from the package root.
const ROOT = process.cwd();
const OUT_ROOT = path.join(ROOT, "public", "tour");
const MANIFEST_PATH = path.join(ROOT, "components", "tour", "tour-audio.manifest.ts");

const ELEVEN_VOICE = "EXAVITQu4vr4xnSDxMaL"; // Sarah — American English
const ELEVEN_MODEL = "eleven_flash_v2_5";
const ELEVEN_FORMAT = "mp3_44100_128";

const MISTRAL_MODEL = "voxtral-mini-tts-2603";
const MISTRAL_VOICE = "gb_jane_neutral"; // British English

const TIMEOUT_MS = 20_000;

type Provider = "elevenlabs" | "mistral";
type ManifestEntry = { file: string; provider: Provider; hash: string };
type Manifest = Record<TourVoice, Record<string, ManifestEntry>>;

class AuthError extends Error {}

async function synthElevenLabs(text: string): Promise<Uint8Array> {
	const key = process.env.ELEVEN_LABS;
	if (!key) throw new AuthError("ELEVEN_LABS not set");
	const res = await fetch(
		`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=${ELEVEN_FORMAT}`,
		{
			method: "POST",
			headers: { "xi-api-key": key, "content-type": "application/json" },
			body: JSON.stringify({ text, model_id: ELEVEN_MODEL }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	);
	if (res.status === 401 || res.status === 403) throw new AuthError(`elevenlabs auth ${res.status}`);
	if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

async function synthMistral(text: string): Promise<Uint8Array> {
	const key = process.env.MISTRAL_API_KEY;
	if (!key) throw new AuthError("MISTRAL_API_KEY not set");
	const res = await fetch("https://api.mistral.ai/v1/audio/speech", {
		method: "POST",
		headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
		body: JSON.stringify({
			model: MISTRAL_MODEL,
			input: text,
			voice_id: MISTRAL_VOICE,
			response_format: "mp3",
			stream: false,
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (res.status === 401 || res.status === 403) throw new AuthError(`mistral auth ${res.status}`);
	if (!res.ok) throw new Error(`mistral ${res.status}`);
	// Response shape is ambiguous: audio/* → raw bytes; JSON → base64 in
	// audio_data / audioData.
	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.startsWith("application/json")) {
		const v = (await res.json()) as Record<string, unknown>;
		const b64 =
			(typeof v.audio_data === "string" && v.audio_data) || (typeof v.audioData === "string" && v.audioData);
		if (!b64) throw new Error("mistral json missing audio_data");
		return Uint8Array.from(Buffer.from(b64, "base64"));
	}
	return new Uint8Array(await res.arrayBuffer());
}

const PROVIDER_FOR: Record<TourVoice, { id: Provider; synth: (text: string) => Promise<Uint8Array> }> = {
	us: { id: "elevenlabs", synth: synthElevenLabs },
	gb: { id: "mistral", synth: synthMistral },
};

async function readPreviousManifest(): Promise<Partial<Manifest>> {
	try {
		const mod = (await import(MANIFEST_PATH)) as { TOUR_AUDIO?: Partial<Manifest> };
		return mod.TOUR_AUDIO ?? {};
	} catch {
		return {}; // first run — no manifest yet
	}
}

async function writeManifest(manifest: Manifest): Promise<void> {
	const block = (voice: TourVoice) => {
		const entries = manifest[voice];
		const lines = Object.keys(entries)
			.sort()
			.map((id) => {
				const e = entries[id]!;
				return `\t\t"${id}": { file: "${e.file}", provider: "${e.provider}", hash: "${e.hash}" },`;
			});
		return lines.length ? `\t${voice}: {\n${lines.join("\n")}\n\t},` : `\t${voice}: {},`;
	};
	const src =
		"// GENERATED by scripts/generate-tour-audio.ts — do not edit.\n" +
		"// Re-run `bun run tour:audio` after changing tour step copy.\n\n" +
		'import type { TourVoice } from "../../lib/tour/types"; // relative: the bun audio script imports this file\n\n' +
		"export type TourAudioEntry = {\n" +
		"\tfile: string;\n" +
		'\tprovider: "elevenlabs" | "mistral";\n' +
		"\thash: string;\n" +
		"};\n\n" +
		"export const TOUR_AUDIO: Record<TourVoice, Record<string, TourAudioEntry>> = {\n" +
		TOUR_VOICES.map(block).join("\n") +
		"\n};\n";
	await writeFile(MANIFEST_PATH, src, "utf8");
}

async function deleteStaleFiles(dir: string, stepId: string, keepHash: string): Promise<void> {
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return;
	}
	const keep = `${stepId}.${keepHash}.mp3`;
	await Promise.all(
		files
			.filter((f) => f.startsWith(`${stepId}.`) && f.endsWith(".mp3") && f !== keep)
			.map((f) => unlink(path.join(dir, f)).catch(() => {})),
	);
}

async function main(): Promise<void> {
	const previous = await readPreviousManifest();
	const next: Manifest = { us: {}, gb: {} };
	let failures = 0;

	for (const voice of TOUR_VOICES) {
		const provider = PROVIDER_FOR[voice];
		const dir = path.join(OUT_ROOT, voice);
		await mkdir(dir, { recursive: true });
		// An auth failure is global for the accent — don't hammer a dead key per step.
		let dead = false;
		console.log(`\n${voice} (${provider.id})`);

		for (const step of TOUR_STEPS) {
			if (step.tts === false) continue;
			const hash = clipHash(voice, step.body);
			const fileName = `${step.id}.${hash}.mp3`;
			const filePath = path.join(dir, fileName);

			const prev = previous[voice]?.[step.id];
			if (prev?.hash === hash && existsSync(filePath)) {
				next[voice][step.id] = prev;
				console.log(`  cached  ${step.id}`);
				continue;
			}

			let served = false;
			if (!dead) {
				try {
					const bytes = await provider.synth(step.body);
					await writeFile(filePath, bytes);
					await deleteStaleFiles(dir, step.id, hash);
					next[voice][step.id] = { file: `/tour/${voice}/${fileName}`, provider: provider.id, hash };
					served = true;
					console.log(`  synth   ${step.id}`);
				} catch (err) {
					if (err instanceof AuthError) {
						dead = true;
						console.warn(`  [${provider.id}] auth/key failure — ${voice} disabled for this run: ${err.message}`);
					} else {
						console.warn(`  [${provider.id}] ${step.id} failed: ${(err as Error).message}`);
					}
				}
			}

			if (!served) {
				failures++;
				if (prev && existsSync(path.join(ROOT, "public", prev.file.replace(/^\//, "")))) {
					// Stale narration beats none — but audio now lags the copy.
					next[voice][step.id] = prev;
					console.warn(`  STALE   ${step.id}: keeping OLD audio (copy changed, narration did not!)`);
				} else {
					console.warn(`  MISSING ${step.id}: no audio; client falls back to timer-paced typewriter`);
				}
			}
		}
	}

	await writeManifest(next);
	console.log(`\nmanifest → ${path.relative(ROOT, MANIFEST_PATH)}`);
	if (failures > 0) {
		console.error(`${failures} clip(s) failed — see warnings above`);
		process.exit(1);
	}
}

void main();
