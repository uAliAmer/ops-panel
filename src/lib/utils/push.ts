/**
 * Web Push subscription, from the browser's side — docs/OPS_CHAT_PLAN.md phase 6.
 *
 * What this buys an operator: a DM or a mention reaches the phone with the
 * panel closed and the screen locked. The socket cannot do that — a
 * backgrounded mobile tab is suspended within seconds of the screen going off.
 *
 * Two things shape the code here:
 *
 * - svelte-ops is built three times under three base paths and a service
 *   worker's scope is its own path, so the same operator on
 *   ops.asaletalkawaz.iq and on /ops is genuinely two subscriptions. The
 *   backend keys on the endpoint and allows many rows per user for this reason.
 * - iOS only delivers Web Push to a page installed to the home screen. In a
 *   Safari tab the subscribe call fails with nothing useful in it, so that case
 *   is detected up front and told in Arabic what to do instead.
 */
import { api } from '$lib/api';
import { base } from '$app/paths';

export type PushState =
	/** No service worker or no Push API — an old browser, or an insecure origin. */
	| 'unsupported'
	/** iOS Safari, in a tab. Push only exists there once the app is installed. */
	| 'ios-needs-install'
	/** The operator said no. Only they can undo it, in site settings. */
	| 'denied'
	/** Supported and allowed, not subscribed yet. */
	| 'off'
	/** Subscribed — this device rings. */
	| 'on';

/**
 * The endpoint of the subscription this browser last registered.
 *
 * Cached because logout has to cut the server-side link BEFORE the token is
 * cleared, and looking the subscription up is asynchronous — by the time it
 * answered, the request would go out unauthenticated. With the endpoint already
 * in hand the DELETE is fired in the same tick as the logout.
 */
let knownEndpoint: string | null = null;

export const pushSupported = () =>
	typeof window !== 'undefined' &&
	'serviceWorker' in navigator &&
	'PushManager' in window &&
	'Notification' in window;

/** iOS, and not launched from the home screen. */
function iosInTab() {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	// iPadOS 13+ reports itself as a Mac; the touch points give it away.
	const isIOS =
		/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
	if (!isIOS) return false;
	const standalone =
		(navigator as Navigator & { standalone?: boolean }).standalone === true ||
		window.matchMedia('(display-mode: standalone)').matches;
	return !standalone;
}

/**
 * The registration this page's worker is under. SvelteKit registers it itself
 * in a production build; `ready` would hang for ever where it has not, so the
 * existing registration is looked up first and only then waited on.
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
	if (!pushSupported()) return null;
	try {
		const existing = await navigator.serviceWorker.getRegistration(`${base}/`);
		if (existing) return existing;
		return await navigator.serviceWorker.register(`${base}/service-worker.js`, {
			scope: `${base}/`
		});
	} catch {
		return null;
	}
}

/** VAPID keys travel as base64url and the API wants raw bytes. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
	const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
		.replace(/-/g, '+')
		.replace(/_/g, '/');
	const raw = atob(padded);
	// Backed by a plain ArrayBuffer on purpose: applicationServerKey will not
	// take the SharedArrayBuffer-capable type the bare constructor infers.
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
	return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
	const reg = await registration();
	if (!reg) return null;
	try {
		return await reg.pushManager.getSubscription();
	} catch {
		return null;
	}
}

export async function pushState(): Promise<PushState> {
	if (!pushSupported()) return iosInTab() ? 'ios-needs-install' : 'unsupported';
	if (Notification.permission === 'denied') return 'denied';
	return (await currentSubscription()) ? 'on' : 'off';
}

/**
 * Ask for permission, subscribe, and hand the subscription to the backend.
 * Returns the state to show; it never throws at the caller.
 */
export async function enablePush(): Promise<PushState> {
	if (!pushSupported()) return iosInTab() ? 'ios-needs-install' : 'unsupported';

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

	const reg = await registration();
	if (!reg) return 'unsupported';

	const key = await api.chatPushKey();
	if (!key.data?.enabled || !key.data.publicKey) return 'unsupported';

	try {
		// An existing subscription is reused rather than re-minted: a second
		// subscribe with a different key throws, and the endpoint we already have
		// is the one the backend knows.
		const sub =
			(await reg.pushManager.getSubscription()) ??
			(await reg.pushManager.subscribe({
				// Required by every browser that implements this: a push must show
				// something. Silent pushes are not on offer.
				userVisibleOnly: true,
				applicationServerKey: keyBytes(key.data.publicKey)
			}));
		await api.chatPushSubscribe(sub.toJSON());
		knownEndpoint = sub.endpoint;
		return 'on';
	} catch {
		return 'off';
	}
}

export async function disablePush(): Promise<PushState> {
	const sub = await currentSubscription();
	knownEndpoint = null;
	if (!sub) return 'off';
	try {
		await api.chatPushUnsubscribe(sub.endpoint);
	} catch {
		/* the row ages out as dead on the next send either way */
	}
	try {
		await sub.unsubscribe();
	} catch {
		/* already gone */
	}
	return 'off';
}

/**
 * Re-point an existing subscription at whoever is logged in now.
 *
 * These are shared phones. Without this the handset keeps delivering the
 * previous operator's DMs to the next one, because the endpoint never changed —
 * only the person holding it did.
 */
export async function syncPush(): Promise<void> {
	if (!pushSupported() || Notification.permission !== 'granted') return;
	const sub = await currentSubscription();
	if (!sub) return;
	knownEndpoint = sub.endpoint;
	try {
		await api.chatPushSubscribe(sub.toJSON());
	} catch {
		/* best effort; the toggle re-registers it the next time it is used */
	}
}

/**
 * Cut the server-side link on logout, keeping the browser's own subscription
 * and its permission. The next operator to log in on this handset re-points the
 * same endpoint at themselves through syncPush(), with no second permission
 * prompt — while in between, nothing is delivered to a phone whose owner has
 * walked away.
 *
 * Fired, not awaited: it has to leave with the token that is about to be
 * thrown away.
 */
export function detachPush(): void {
	const endpoint = knownEndpoint;
	knownEndpoint = null;
	if (endpoint) void api.chatPushUnsubscribe(endpoint).catch(() => {});
}
