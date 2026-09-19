/**
 * Deployment-specific values.
 *
 * Everything here identifies the environment the panel is serving, not the
 * panel itself: the hosts it links out to and whether it is running against a
 * real backend. They are read from Vite env at build time (`VITE_*`, see
 * `.env.example`) so the source carries no live infrastructure, and a fork can
 * point the app at its own hosts without touching code.
 *
 * The fallbacks are deliberately placeholders. A deploy that means to link
 * somewhere real sets the variables — `frontend/Dockerfile.static` does this
 * for the three production builds.
 */

/** Where the customer-facing tracking pages live. */
export const PUBLIC_ORDER_ORIGIN =
	import.meta.env.VITE_PUBLIC_ORDER_ORIGIN || 'https://orders.example.com';

/** The ops app's own canonical origin, for order links operators share. */
export const OPS_APP_BASE = import.meta.env.VITE_OPS_APP_BASE || 'https://ops.example.com';

/** The SSO portal that owns the operator directory. */
export const PORTAL_URL = import.meta.env.VITE_PORTAL_URL || 'https://portal.example.com/login';

/** CDN serving product images by filename. */
export const IMAGE_CDN = import.meta.env.VITE_IMAGE_CDN || 'https://cdn.example.com';

/**
 * The hostname the panel considers its own. `DomainNotice` uses it to tell an
 * operator still on an old address that the app has moved — so it must be the
 * bare host, with no scheme. Empty disables that notice entirely, which is what
 * a deploy that never moved wants.
 */
export const CANONICAL_HOST = import.meta.env.VITE_CANONICAL_HOST || '';

/**
 * Demo mode: no backend. Every API call is answered from the in-memory fixture
 * set in `$lib/demo`, and the socket never dials out. Set VITE_DEMO=1 (the
 * public repo's default) or append ?demo=1 to any URL.
 */
export const DEMO = (() => {
	if (import.meta.env.VITE_DEMO === '1' || import.meta.env.VITE_DEMO === 'true') return true;
	if (typeof window === 'undefined') return false;
	try {
		if (new URLSearchParams(window.location.search).get('demo') === '1') {
			sessionStorage.setItem('demoMode', '1');
			return true;
		}
		return sessionStorage.getItem('demoMode') === '1';
	} catch {
		return false;
	}
})();
