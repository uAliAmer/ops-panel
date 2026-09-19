<script lang="ts">
	import '../app.css';
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { auth } from '$lib/stores/auth.svelte';
	import { socketStore } from '$lib/stores/socket.svelte';
	import { redirectToPortal, isLoggingOut } from '$lib/ssoRedirect';
	import { DEMO } from '$lib/config';
	import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
	import InstallPrompt from '$lib/components/InstallPrompt.svelte';
	import PushPrompt from '$lib/components/PushPrompt.svelte';
	import ChatTour from '$lib/components/ChatTour.svelte';
	import DomainNotice from '$lib/components/DomainNotice.svelte';
	import ReminderAlertHost from '$lib/components/ReminderAlertHost.svelte';

	let { children } = $props();

	// Respect the OS "reduce motion" setting — skip the slide entirely there.
	const reduceMotion =
		browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Navigation direction drives the slide: going deeper (list → detail) pushes
	// forward, going back pulls the other way. Deeper path = more segments.
	let direction = $state(1);
	onNavigate((nav) => {
		const depth = (u: URL | null | undefined) =>
			u ? u.pathname.replace(/\/+$/, '').split('/').length : 0;
		direction = depth(nav.to?.url) < depth(nav.from?.url) ? -1 : 1;
	});

	// Transform + opacity only → GPU-composited, cheap on phones. RTL: forward
	// screens enter from the leading (left) edge.
	const flyParams = $derived(
		reduceMotion ? { duration: 0 } : { x: direction * -24, duration: 200, easing: cubicOut }
	);

	// SSO portal only: an unauthenticated visitor is always sent to the Genelog
	// login portal (local login is disabled). Skip on the callback route and
	// while logging out.
	$effect(() => {
		if (!browser) return;
		// Demo mode has no IdP. Sign in against the fixtures instead of sending
		// the visitor to a portal URL that does not exist.
		if (DEMO) {
			if (!auth.isAuthenticated) void auth.demoLogin();
			return;
		}
		const onCallback = page.url.pathname.replace(/\/+$/, '').endsWith('/sso-callback');
		if (!auth.isAuthenticated && !onCallback && !isLoggingOut()) {
			redirectToPortal();
		}
	});

	// Persist the socket across route changes — listeners are added per page,
	// but the underlying connection lives at the layout level so navigating
	// list ↔ detail doesn't tear it down.
	$effect(() => {
		if (auth.isAuthenticated) socketStore.connect();
	});

	// Refresh the cached user once on load so sessions that predate erpAccount
	// (and other added fields) pick it up without re-login.
	$effect(() => {
		if (auth.isAuthenticated) void auth.refreshUser();
	});

	onDestroy(() => {
		socketStore.disconnect();
	});
</script>

<DomainNotice />
{#key page.url.pathname}
	<div in:fly={flyParams}>
		{@render children()}
	</div>
{/key}
{#if auth.isAuthenticated}
	<ReminderAlertHost />
{/if}
<UpdatePrompt />
<InstallPrompt />
<PushPrompt />
<ChatTour />
