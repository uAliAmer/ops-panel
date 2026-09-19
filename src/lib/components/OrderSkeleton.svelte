<script lang="ts">
	// Placeholder rows shown while an order list loads, in place of a spinner.
	// The bars pulse (transitions-dev 14 — skeleton loader and reveal, whose CSS
	// lives in app.css); the real list then mounts with `.t-skel-reveal`, which
	// plays the content half of that transition's cross-fade.
	//
	// Sized to the real OrderCard so the swap does not jump the scroll position:
	// a card is a padded rounded box with a title line, two detail lines and a
	// price row.
	import { Card } from '$lib/components/ui/card';

	type Props = { count?: number };
	let { count = 3 }: Props = $props();
</script>

<div class="t-skel-skeleton space-y-2" aria-hidden="true">
	{#each Array(count) as _, i (i)}
		<Card class="gap-0 overflow-hidden rounded-2xl p-3">
			<div class="flex items-start justify-between gap-3">
				<div class="flex-1 space-y-2">
					<div class="bg-muted h-4 w-2/5 rounded-full"></div>
					<div class="bg-muted/70 h-3 w-3/5 rounded-full"></div>
					<div class="bg-muted/70 h-3 w-1/3 rounded-full"></div>
				</div>
				<div class="bg-muted size-9 shrink-0 rounded-full"></div>
			</div>
			<div class="mt-3 flex items-center justify-between gap-2">
				<div class="bg-muted/70 h-3 w-20 rounded-full"></div>
				<div class="bg-muted h-6 w-24 rounded-full"></div>
			</div>
		</Card>
	{/each}
</div>

<span class="sr-only">جاري التحميل…</span>
