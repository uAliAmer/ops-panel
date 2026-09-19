<script lang="ts">
	// A coach mark: a small card pinned to the thing it is talking about, with an
	// arrow pointing at it, that stays until the operator answers it.
	//
	// It replaces a toast, which was wrong twice over — it appeared in the corner,
	// nowhere near the button being described, and it left on a timer whether or
	// not anyone had read it. This one has no timer.
	import { onDestroy } from 'svelte';
	import { Lightbulb } from '@lucide/svelte';
	import { hintAvailable, consumeHint, retireHint } from '$lib/utils/hint';
	import { haptic } from '$lib/utils/haptic';

	type Props = {
		/** Stable id — counts and dismissals are stored against it. */
		key: string;
		/** What to say, in the operator's Arabic. */
		text: string;
		/** The element being pointed at. Null while it does not exist yet. */
		anchor: HTMLElement | null;
		/** Which side of the anchor to sit on. */
		place?: 'top' | 'bottom';
	};
	let { key, text, anchor, place = 'bottom' }: Props = $props();

	let shown = $state(false);
	let card = $state<HTMLElement | null>(null);
	let pos = $state({ top: 0, left: 0, arrow: 0, above: false });
	// One appearance per mount, not per re-render: the effects that drive this
	// re-run whenever their panel's data moves.
	let counted = false;

	// Same reason as the pickup preview: panels here are sticky and blurred, which
	// makes them stacking contexts. A card inside one cannot rise above the rest
	// of the page no matter its z-index, so it goes on <body>.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	const GAP = 10;
	function place_() {
		if (!anchor) return;
		const a = anchor.getBoundingClientRect();
		const w = card?.offsetWidth ?? 300;
		const h = card?.offsetHeight ?? 120;
		// Flip above the anchor when there is no room below it.
		const above = place === 'top' || a.bottom + GAP + h > window.innerHeight - 8;
		const top = above ? Math.max(8, a.top - h - GAP) : a.bottom + GAP;
		const wantLeft = a.left + a.width / 2 - w / 2;
		const left = Math.max(8, Math.min(wantLeft, window.innerWidth - w - 8));
		// The arrow keeps pointing at the anchor's middle even after clamping.
		const arrow = Math.max(14, Math.min(a.left + a.width / 2 - left, w - 14));
		pos = { top, left, arrow, above };
	}

	$effect(() => {
		if (!anchor || counted || !hintAvailable(key)) return;
		counted = true;
		consumeHint(key);
		shown = true;
	});

	$effect(() => {
		if (!shown || !anchor) return;
		place_();
		requestAnimationFrame(place_); // again once the card has measured
		const onMove = () => place_();
		window.addEventListener('scroll', onMove, true);
		window.addEventListener('resize', onMove);
		return () => {
			window.removeEventListener('scroll', onMove, true);
			window.removeEventListener('resize', onMove);
		};
	});

	// The anchor can go away under it — a panel closing, a row collapsing.
	$effect(() => {
		if (shown && !anchor) shown = false;
	});

	function gotIt() {
		haptic(8);
		shown = false;
	}
	function never() {
		haptic(12);
		retireHint(key);
		shown = false;
	}

	onDestroy(() => (shown = false));
</script>

{#if shown}
	<div
		use:portal
		bind:this={card}
		dir="rtl"
		style="position: fixed; top: {pos.top}px; left: {pos.left}px;"
		class="z-[400] w-[19rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-amber-500/40 bg-amber-50 p-3 shadow-[0_18px_50px_rgb(0_0_0/0.3)] dark:bg-amber-950/95"
		role="dialog"
		aria-live="polite"
	>
		<!-- The arrow: a rotated square straddling the card's edge. -->
		<span
			class="absolute size-3 rotate-45 border-amber-500/40 bg-amber-50 dark:bg-amber-950 {pos.above
				? 'border-r border-b'
				: 'border-t border-l'}"
			style="left: {pos.arrow - 6}px; {pos.above ? 'bottom: -6px;' : 'top: -6px;'}"
		></span>

		<div class="flex items-start gap-2">
			<Lightbulb class="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
			<p class="text-sm font-bold leading-relaxed text-amber-900 dark:text-amber-100">
				{text}
			</p>
		</div>

		<div class="mt-3 flex items-center gap-2">
			<button
				type="button"
				class="apple-press h-9 flex-1 rounded-xl bg-amber-600 text-sm font-black text-white"
				onclick={gotIt}
			>
				فهمت
			</button>
			<button
				type="button"
				class="apple-press h-9 rounded-xl px-3 text-xs font-bold text-amber-800 underline underline-offset-4 dark:text-amber-200"
				onclick={never}
			>
				لا تظهرها مجدداً
			</button>
		</div>
	</div>
{/if}
