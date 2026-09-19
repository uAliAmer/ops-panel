<script lang="ts">
	// Header chip: total cash our local drivers still owe us (Σ outstanding across
	// all drivers). Tapping opens the settlement sheet. Amber = money out with
	// drivers, not yet handed back.
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils';
	import { Bike } from '@lucide/svelte';
	import { api } from '$lib/api';
	import { formatPrice } from '$lib/utils/format';
	import { haptic } from '$lib/utils/haptic';
	import AnimatedNumber from '$lib/components/AnimatedNumber.svelte';
	import DriversSheet from '$lib/components/DriversSheet.svelte';

	// See WalletChip: `flat` makes this the other half of the shared money chip.
	let { flat = false }: { flat?: boolean } = $props();

	let open = $state(false);
	let total = $state(0);
	let loadedOnce = $state(false);

	async function loadTotal() {
		try {
			const res = await api.listLocalDrivers();
			if (res.success) {
				total = (res.data ?? []).reduce((a, d) => a + (d.outstanding ?? 0), 0);
				loadedOnce = true;
			}
		} catch {
			/* header chip is best-effort */
		}
	}

	onMount(loadTotal);

	// Refresh the total when the sheet closes (a settle may have changed it).
	$effect(() => {
		if (!open && loadedOnce) void loadTotal();
	});
</script>

<button
	type="button"
	class={flat
		? 'apple-press inline-flex h-[17px] w-full items-center gap-1.5 px-2.5 text-[11px] leading-none font-bold text-amber-700 transition-colors hover:bg-amber-500/15 active:bg-amber-500/25 dark:text-amber-300'
		: 'apple-press inline-flex h-9 items-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/15 px-3 text-xs font-bold text-amber-700 shadow-[0_2px_10px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/20 ring-inset backdrop-blur-2xl backdrop-saturate-200 transition-all hover:bg-amber-500/25 active:bg-amber-500/35 dark:text-amber-300 dark:border-amber-500/40 dark:bg-amber-500/20'}
	aria-label="ديون المندوبين"
	onclick={() => { haptic(10); open = true; }}
>
	<Bike class={cn('shrink-0 text-amber-600 dark:text-amber-400', flat ? 'size-3.5' : 'size-4')} />
	{#if loadedOnce}
		<span class={cn('font-black tabular-nums leading-none', flat ? 'text-[11px]' : 'text-xs')}>
			<AnimatedNumber value={total} format={formatPrice} /> د.ع
		</span>
	{:else}
		<span class={cn('font-bold', flat ? 'text-[11px]' : 'text-xs')}>المندوبين</span>
	{/if}
</button>

<DriversSheet bind:open onChanged={loadTotal} />
