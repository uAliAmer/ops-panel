import { base } from '$app/paths';

let audio: HTMLAudioElement | null = null;

function ensureAudio(): HTMLAudioElement | null {
	if (typeof Audio === 'undefined') return null;
	if (!audio) {
		try {
			audio = new Audio(`${base}/sounds/new-order.mp3`);
			audio.volume = 0.6;
		} catch {
			audio = null;
		}
	}
	return audio;
}

export function playNewOrderSound(): void {
	const a = ensureAudio();
	if (!a) return;
	try {
		a.currentTime = 0;
		void a.play().catch(() => {
			/* autoplay blocked */
		});
	} catch {
		/* ignore */
	}
}

let reminderAudio: HTMLAudioElement | null = null;

function ensureReminderAudio(): HTMLAudioElement | null {
	if (typeof Audio === 'undefined') return null;
	if (!reminderAudio) {
		try {
			reminderAudio = new Audio(`${base}/sounds/reminder-alarm.mp3`);
			reminderAudio.volume = 0.7;
		} catch {
			reminderAudio = null;
		}
	}
	return reminderAudio;
}

export function playReminderAlarm(): void {
	const a = ensureReminderAudio();
	if (!a) return;
	try {
		a.currentTime = 0;
		void a.play().catch(() => {
			/* autoplay blocked — the modal itself is still the alert */
		});
	} catch {
		/* ignore */
	}
}

/** Cuts the alarm short the moment the operator acts on (or closes) the alert. */
export function stopReminderAlarm(): void {
	if (!reminderAudio) return;
	try {
		reminderAudio.pause();
		reminderAudio.currentTime = 0;
	} catch {
		/* ignore */
	}
}

// --- Tab title blink ---------------------------------------------------------
// Flash the browser tab between the real title and an alert until the operator
// focuses the tab. Only runs while the tab is hidden — no point blinking a tab
// you're already looking at.
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let baseTitle = '';
let blinkOn = false;
let listenerBound = false;

function clearBlink(): void {
	if (blinkTimer) {
		clearInterval(blinkTimer);
		blinkTimer = null;
	}
	if (baseTitle) document.title = baseTitle;
	blinkOn = false;
}

function bindFocusStop(): void {
	if (listenerBound || typeof document === 'undefined') return;
	listenerBound = true;
	const stop = () => {
		if (document.visibilityState === 'visible') clearBlink();
	};
	document.addEventListener('visibilitychange', stop);
	window.addEventListener('focus', clearBlink);
}

export function blinkTabTitle(count = 1, text?: string): void {
	if (typeof document === 'undefined') return;
	// Already looking at the tab — nothing to alert.
	if (document.visibilityState === 'visible') return;
	bindFocusStop();
	// Don't capture the alert text as the base title on repeat triggers.
	if (!blinkTimer) baseTitle = document.title;
	const alert = text ?? (count > 1 ? `🔔 (${count}) طلبات جديدة` : '🔔 طلب جديد!');
	clearBlink();
	baseTitle = baseTitle || document.title;
	blinkTimer = setInterval(() => {
		blinkOn = !blinkOn;
		document.title = blinkOn ? alert : baseTitle;
	}, 900);
}
