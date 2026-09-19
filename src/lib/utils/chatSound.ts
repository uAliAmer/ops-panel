/**
 * Chat sounds.
 *
 * An arriving message plays a real clip (static/sounds/chat-in.mp3). The two
 * quieter events — your own message leaving, and a mention — stay synthesised
 * tones: they need to be told apart from the arrival by ear, and a tone is
 * trivial to tune and costs nothing to load.
 *
 * Everything here is best-effort: browsers refuse audio until the page has been
 * interacted with, so every call is wrapped and a failure is silence, never an
 * error in an operator's face.
 */
import { base } from '$app/paths';

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	try {
		const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;
		if (!ctx) ctx = new Ctor();
		// Suspended until the first gesture; resuming is a no-op once running.
		if (ctx.state === 'suspended') void ctx.resume();
		return ctx;
	} catch {
		return null;
	}
}

/** One soft sine blip. `at` is an offset in seconds so notes can be sequenced. */
function blip(freq: number, at: number, dur: number, peak: number) {
	const c = context();
	if (!c) return;
	try {
		const osc = c.createOscillator();
		const gain = c.createGain();
		osc.type = 'sine';
		osc.frequency.value = freq;
		const t = c.currentTime + at;
		// A hard start or stop clicks; ramp both edges.
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(gain).connect(c.destination);
		osc.start(t);
		osc.stop(t + dur + 0.02);
	} catch {
		/* silence */
	}
}

// One element reused for every arrival: re-creating it per message re-fetches
// and re-decodes the clip, and two messages landing together would overlap
// into a mess rather than a single notification.
let inAudio: HTMLAudioElement | null = null;

function ensureInAudio(): HTMLAudioElement | null {
	if (typeof Audio === 'undefined') return null;
	if (!inAudio) {
		try {
			inAudio = new Audio(`${base}/sounds/chat-in.mp3`);
			inAudio.preload = 'auto';
			inAudio.volume = 0.55;
		} catch {
			inAudio = null;
		}
	}
	return inAudio;
}

/** A message arrived. The clip the operators asked for. */
export function playChatIn(): void {
	const a = ensureInAudio();
	if (!a) return;
	try {
		// Rewind rather than ignore: a second message while the first is still
		// playing should still be heard.
		a.currentTime = 0;
		void a.play().catch(() => {
			/* blocked until a gesture — silence, not an error */
		});
	} catch {
		/* silence */
	}
}

/** Your own message left: one short, quiet note — feedback, not an alert. */
export function playChatOut(): void {
	blip(520, 0, 0.07, 0.05);
}

/**
 * Someone mentioned you. Three notes, last one held: deliberately more than a
 * plain message, because a mention is addressed to one person and is the only
 * chat event worth interrupting for.
 */
export function playChatMention(): void {
	blip(660, 0, 0.09, 0.09);
	blip(880, 0.085, 0.09, 0.085);
	blip(1175, 0.17, 0.22, 0.08);
}
