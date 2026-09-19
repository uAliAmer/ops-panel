/**
 * SSO portal redirect — when the ops app has no session, bounce the user to the
 * Genelog login portal with a return_to, then come back via /admin/sso-callback.
 */
import { PORTAL_URL } from './config';

/** True if a path is the SSO callback route (with or without a trailing slash). */
export function isCallbackPath(pathname: string): boolean {
	return pathname.replace(/\/+$/, '').endsWith('/sso-callback');
}

/**
 * Send the browser to the Genelog login portal, returning to the current page.
 *
 * The portal builds its `next` out of the whole return path, so the return URL
 * has to be clean: leaving `sso` and `next` on it sends a spent assertion back
 * out in a query string and nests the URL a level deeper on every retry. Going
 * back from the callback returns to the app itself, never to the callback.
 */
export function redirectToPortal() {
	if (typeof window === 'undefined') return;
	const here = new URL(window.location.href);
	here.searchParams.delete('sso');
	here.searchParams.delete('next');
	if (isCallbackPath(here.pathname)) {
		here.pathname = here.pathname.replace(/\/sso-callback\/?$/, '/');
	}
	window.location.href = `${PORTAL_URL}?return_to=${encodeURIComponent(here.href)}`;
}

/** True if the current URL opts out of SSO (break-glass local shipping login). */
export function wantsLocalLogin(): boolean {
	if (typeof window === 'undefined') return false;
	return new URLSearchParams(window.location.search).get('local') === '1';
}

// Single logout: when logging out we must also end the Genelog (IdP) session,
// otherwise the portal would silently re-mint and log us straight back in.
let loggingOut = false;
export function isLoggingOut(): boolean {
	return loggingOut;
}
export function beginLogout(): void {
	if (typeof window === 'undefined') return;
	loggingOut = true; // stop the layout guard from racing a portal redirect
	window.location.href = `${PORTAL_URL}?logout=1`;
}
