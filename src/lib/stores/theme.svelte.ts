/**
 * Theme store — dark / light / system, persisted to localStorage.
 * SSR-safe: skips DOM access when running on the server.
 *
 * The default is SYSTEM, not dark. An operator whose phone is in light mode had
 * to find the menu and say so; following the phone is what every other app on
 * it does. An explicit choice still wins, and is remembered.
 */
import { browser } from '$app/environment';

export type Theme = 'dark' | 'light' | 'system';
const KEY = 'theme';

const media = () => (browser ? window.matchMedia('(prefers-color-scheme: dark)') : null);

/**
 * Held as state rather than read on demand: the phone flips this at sunset with
 * the app open, and `effective` has to change with it.
 */
let systemDark = $state(media()?.matches ?? true);

function resolveSystem(): 'dark' | 'light' {
	return systemDark ? 'dark' : 'light';
}

function readStored(): Theme {
	if (!browser) return 'system';
	const v = localStorage.getItem(KEY);
	return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function apply(t: Theme) {
	if (!browser) return;
	const effective = t === 'system' ? resolveSystem() : t;
	document.documentElement.classList.toggle('dark', effective === 'dark');
	const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (meta) meta.content = effective === 'dark' ? '#0f172a' : '#ffffff';
}

function createTheme() {
	let value = $state<Theme>(readStored());

	if (browser) {
		apply(value);
		// The OS switching to night mode has to reach a panel that is already
		// open — an operator does not reload ops at sunset.
		media()?.addEventListener('change', (e) => {
			systemDark = e.matches;
			if (value === 'system') apply(value);
		});
	}

	return {
		get value() {
			return value;
		},
		get effective(): 'dark' | 'light' {
			return value === 'system' ? resolveSystem() : value;
		},
		set(t: Theme) {
			value = t;
			if (browser) {
				localStorage.setItem(KEY, t);
				apply(t);
			}
		},
		toggle() {
			this.set(this.effective === 'dark' ? 'light' : 'dark');
		}
	};
}

export const theme = createTheme();
