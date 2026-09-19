/**
 * Reactive auth store using Svelte 5 runes.
 * Persists token + user via the api module's localStorage.
 */
import { api, type User } from '$lib/api';
import { DEMO } from '$lib/config';
import { beginLogout } from '$lib/ssoRedirect';
import { socketStore } from '$lib/stores/socket.svelte';
import { detachPush } from '$lib/utils/push';

function createAuthStore() {
	let user = $state<User | null>(api.getUser());
	let token = $state<string | null>(api.getToken());

	return {
		get user() {
			return user;
		},
		get token() {
			return token;
		},
		get isAuthenticated() {
			return Boolean(token);
		},
		async login(email: string, password: string) {
			const res = await api.login(email, password);
			if (res.success && res.data) {
				user = res.data.user;
				token = res.data.token;
				// The socket's identity is fixed at handshake time, so one opened
				// on the login screen is anonymous until it handshakes again.
				socketStore.reauth();
			}
			return res;
		},
		// Demo mode: there is no portal to bounce to, so sign in against the
		// fixture backend instead. Goes through the ordinary login path — the
		// demo handler is what answers it.
		async demoLogin() {
			if (!DEMO || token) return;
			await this.login('demo@example.com', 'demo');
		},

		// Federated login via a Genelog-minted assertion (SSO portal callback).
		async ssoLogin(assertion: string) {
			const res = await api.ssoLogin(assertion);
			if (res.success && res.data) {
				user = res.data.user;
				token = res.data.token;
				socketStore.reauth();
			}
			return res;
		},
		// Re-fetch the current user (e.g. to pick up erpAccount for sessions that
		// logged in before it was returned). Best-effort; ignores failures.
		async refreshUser() {
			if (!token) return;
			try {
				const res = await api.me();
				if (res.success && res.data) user = res.data;
			} catch {
				/* keep cached user */
			}
		},
		logout() {
			// Before the token goes: this handset stops being subscribed as THIS
			// operator, so their DMs do not keep buzzing a phone they handed over.
			detachPush();
			void api.logout(); // best-effort refresh-token revocation
			user = null;
			token = null;
			// Without this the socket stays in the old user's room until the tab
			// is closed — on a shared phone, the next operator's tab would still
			// be receiving the previous one's private traffic.
			socketStore.reauth();
			// Single logout: also end the Genelog IdP session so the portal
			// doesn't silently re-authenticate us back into ops.
			beginLogout();
		}
	};
}

export const auth = createAuthStore();
