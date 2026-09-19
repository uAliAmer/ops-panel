/**
 * Has this operator been walked through a feature yet?
 *
 * Separate from hint.ts, which budgets a small nudge over several visits. A tour
 * is a one-off: it interrupts the screen, so it gets exactly one chance and then
 * never again. Versioned in the key, so a genuinely new feature can be taught
 * later without un-teaching this one.
 *
 * Storage failures fall back to "already seen" — the opposite of hint.ts. A
 * repeated nudge is a small annoyance; a modal walkthrough on every single load
 * because private mode blocks localStorage is a reason to stop using the app.
 */
const PREFIX = 'ops:tour:';

export const CHAT_TOUR_KEY = 'chat:v1';

export function tourSeen(key: string): boolean {
	try {
		return localStorage.getItem(PREFIX + key) === 'done';
	} catch {
		return true;
	}
}

export function markTourSeen(key: string) {
	try {
		localStorage.setItem(PREFIX + key, 'done');
	} catch {
		/* nothing to remember it with */
	}
}

/** For re-teaching, and for testing it without clearing site data by hand. */
export function resetTour(key: string) {
	try {
		localStorage.removeItem(PREFIX + key);
	} catch {
		/* nothing to reset */
	}
}
