/**
 * Show a teaching hint a few times, then stop.
 *
 * A new button in a panel is invisible to someone who was never told it exists —
 * and the ops app has no release notes, no onboarding, and operators who learned
 * the screen months ago and stopped reading it.
 *
 * This module only counts; HintPopover draws. A toast was the first attempt and
 * was wrong twice over: it appears in the corner, far from the button it is
 * describing, and it leaves on a timer whether or not anyone read it.
 *
 * Not once: once is missed. Ten appearances across ten different visits is
 * enough for it to land while still ending on its own — a hint that returns
 * forever stops being a hint and becomes noise. «لا تظهرها مجدداً» ends it
 * immediately for an operator who has already understood.
 *
 * Counted in localStorage. Storage failures (private mode, cleared data) fall
 * back to showing it — better a repeat than a feature nobody finds.
 */
const PREFIX = 'ops:hint:';
const DEFAULT_TIMES = 10;

function readCount(key: string): number {
	try {
		return parseInt(localStorage.getItem(PREFIX + key) || '0', 10) || 0;
	} catch {
		return 0;
	}
}

function writeCount(key: string, n: number) {
	try {
		localStorage.setItem(PREFIX + key, String(n));
	} catch {
		/* storage disabled — the hint simply shows again next time */
	}
}

/** Is this hint still allowed to appear? */
export function hintAvailable(key: string, times: number = DEFAULT_TIMES): boolean {
	return readCount(key) < times;
}

/** Count one appearance. */
export function consumeHint(key: string) {
	writeCount(key, readCount(key) + 1);
}

/** Never show it again — «لا تظهرها مجدداً». */
export function retireHint(key: string, times: number = DEFAULT_TIMES) {
	writeCount(key, times);
}

/** Escape hatch for testing / re-teaching after a change. */
export function resetHint(key: string) {
	try {
		localStorage.removeItem(PREFIX + key);
	} catch {
		/* nothing to reset */
	}
}
