<script lang="ts">
	/**
	 * One-time notice that the panel moved to a new address — the one
	 * VITE_CANONICAL_HOST names. Unset, this never shows.
	 *
	 * The old host redirects, so nobody is stranded — but a redirect does not
	 * update a bookmark, and it does not move an installed PWA: a home-screen
	 * app installed against confirm.gstar1959.com keeps its own service worker
	 * and cached shell, and only re-installing from here actually moves it.
	 * That is the case this notice exists for, so it says so explicitly when it
	 * can see it is running standalone.
	 *
	 * Shown only on the new domain — on the genelog.nixflow.xyz/ops mount the
	 * address being advertised is not the one the operator should be using.
	 */
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { X, ArrowLeftRight } from '@lucide/svelte';
	import { haptic } from '$lib/utils/haptic';
	import { CANONICAL_HOST } from '$lib/config';

	// Versioned, so a future move can re-show this without colliding with a
	// dismissal of the last one.
	const DISMISS_KEY = 'domainMoveNoticeDismissed.v1';
	const NEW_HOST = CANONICAL_HOST;

	let visible = $state(false);
	let standalone = $state(false);

	onMount(() => {
		if (!browser) return;
		if (!NEW_HOST || window.location.hostname !== NEW_HOST) return;
		try {
			if (localStorage.getItem(DISMISS_KEY)) return;
		} catch {
			// Private mode or blocked storage: showing it every load is better
			// than never showing it, and it is one tap to clear.
		}
		standalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as unknown as { standalone?: boolean }).standalone === true;
		visible = true;
	});

	function dismiss() {
		haptic(12);
		visible = false;
		try {
			localStorage.setItem(DISMISS_KEY, '1');
		} catch {
			/* nothing to persist to — it will show again, which is harmless */
		}
	}
</script>

{#if visible}
	<!--
		Floats at the bottom, not the top. On mobile the panel's action row (menu,
		add, search) is a `fixed top-0` island out of normal flow, so anything in
		flow at the top of the layout lands underneath it — and those buttons are
		the ones operators reach for all day. Sitting above the bottom tab island
		keeps this clear of both.
	-->
	<div
		class="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center lg:inset-x-auto lg:bottom-4 lg:left-4 lg:justify-start"
	>
		<div
			class="border-primary/25 bg-card/95 flex w-full max-w-sm items-start gap-3 rounded-2xl border p-3 shadow-[0_12px_44px_-6px_rgba(0,0,0,0.18)] ring-1 ring-black/5 ring-inset backdrop-blur-2xl backdrop-saturate-200 dark:shadow-[0_16px_50px_-8px_rgba(0,0,0,0.6)] dark:ring-white/10"
		>
			<div
				class="bg-primary/15 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
			>
				<ArrowLeftRight class="size-4" />
			</div>
			<div class="min-w-0 flex-1 space-y-0.5">
				<p class="text-sm font-bold">انتقلنا إلى نطاق جديد</p>
				<p class="text-muted-foreground text-xs leading-relaxed">
					عنوان اللوحة الآن <span class="font-semibold" dir="ltr">{NEW_HOST}</span> — حدّث الإشارة
					المرجعية.
					{#if standalone}
						التطبيق مثبت من العنوان القديم، أعد تثبيته من هنا ليعمل بشكل صحيح.
					{/if}
				</p>
			</div>
			<button
				type="button"
				onclick={dismiss}
				aria-label="إغلاق"
				class="text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded-lg p-1.5 active:opacity-70"
			>
				<X class="size-4" />
			</button>
		</div>
	</div>
{/if}
