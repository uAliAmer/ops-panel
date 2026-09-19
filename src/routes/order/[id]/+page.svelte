<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import OrderDetail from '$lib/components/OrderDetail.svelte';

	const orderId = $derived(page.params.id ?? '');
	let redirecting = $state(false);

	onMount(() => {
		// On desktop, a shared/deep link should open the master–detail split with
		// this order in the pane — not the bare full-screen detail. Hand off to
		// the list page, which renders the full desktop view.
		if (browser && window.matchMedia('(min-width: 1024px)').matches) {
			redirecting = true;
			void goto(`${base}/?order=${encodeURIComponent(orderId)}`, { replaceState: true });
		}
	});
</script>

{#if !redirecting}
	<OrderDetail {orderId} mode="page" />
{/if}
