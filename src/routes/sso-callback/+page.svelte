<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { redirectToPortal, isCallbackPath } from '$lib/ssoRedirect';

	let error = $state('');

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const assertion = params.get('sso');
		const next = params.get('next');

		if (!assertion) {
			error = 'رابط الدخول غير صالح';
			return;
		}

		try {
			const res = await auth.ssoLogin(assertion);
			if (!res.success) {
				error = res.error || 'تعذّر تسجيل الدخول';
				return;
			}
			// Land on the originally-requested page (default: app home).
			// Typed as string because `base` narrows to `/${string}` and the
			// value that actually ships is the one parsed out of `next`.
			let dest: string = base || '/';
			if (next) {
				try {
					// Parsed against our own origin rather than prefix-matched: with
					// an empty base (dev) a bare startsWith('/') also accepts
					// "//evil.com", which is a different host, not a local path.
					const url = new URL(decodeURIComponent(next), window.location.origin);
					const path = url.pathname.replace(/\/+$/, '');
					const sameApp = !base || path === base || path.startsWith(`${base}/`);
					// Never bounce back into this route: the portal derives `next`
					// from the whole return path, so a callback URL that reached the
					// portal comes back pointing here, and goto() on the route we are
					// already on does not re-run onMount — the page would sit on its
					// spinner forever with a perfectly good session behind it.
					if (url.origin === window.location.origin && sameApp && !isCallbackPath(path)) {
						dest = url.pathname + url.search + url.hash;
					}
				} catch {
					/* keep default */
				}
			}
			await goto(dest, { replaceState: true });
		} catch (e) {
			error = (e as Error)?.message || 'تعذّر تسجيل الدخول';
		}
	});
</script>

<div class="wrap">
	{#if error}
		<p class="err">{error}</p>
		<button class="btn" onclick={() => redirectToPortal()}>العودة لتسجيل الدخول</button>
	{:else}
		<div class="spinner"></div>
		<p>جارٍ تسجيل الدخول...</p>
	{/if}
</div>

<style>
	.wrap {
		min-height: 80vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: #475569;
	}
	.spinner {
		width: 42px;
		height: 42px;
		border: 4px solid #e2e8f0;
		border-top-color: #4f46e5;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.err {
		color: #dc2626;
		font-weight: 600;
	}
	.btn {
		background: #4f46e5;
		color: #fff;
		padding: 10px 20px;
		border-radius: 10px;
		text-decoration: none;
		font-weight: 700;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
