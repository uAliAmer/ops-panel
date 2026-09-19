<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Download, X, Share } from '@lucide/svelte';
	import { haptic } from '$lib/utils/haptic';

	type BIPEvent = Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	};

	const DISMISS_KEY = 'pwaInstallDismissedUntil';

	let deferred = $state<BIPEvent | null>(null);
	let showIosHint = $state(false);
	let visible = $state(false);

	function dismissedRecently() {
		if (!browser) return true;
		const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
		return Date.now() < until;
	}

	function isStandalone() {
		if (!browser) return false;
		return (
			window.matchMedia('(display-mode: standalone)').matches ||
			// iOS Safari
			(window.navigator as unknown as { standalone?: boolean }).standalone === true
		);
	}

	function isIos() {
		if (!browser) return false;
		const ua = navigator.userAgent;
		const ios = /iphone|ipad|ipod/i.test(ua);
		// exclude in-app webviews/Chrome-iOS where Add-to-Home isn't available the same way
		const safari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
		return ios && safari;
	}

	function refresh() {
		if (isStandalone() || dismissedRecently()) {
			visible = false;
			return;
		}
		if (window.__deferredInstallPrompt) {
			deferred = window.__deferredInstallPrompt as BIPEvent;
			showIosHint = false;
			visible = true;
		} else if (isIos()) {
			showIosHint = true;
			visible = true;
		}
	}

	async function install() {
		if (!deferred) return;
		haptic(15);
		await deferred.prompt();
		try {
			await deferred.userChoice;
		} catch {
			/* ignore */
		}
		deferred = null;
		window.__deferredInstallPrompt = undefined;
		visible = false;
	}

	function dismiss() {
		haptic(8);
		// snooze for 7 days
		localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
		visible = false;
	}

	onMount(() => {
		refresh();
		const onInstallable = () => refresh();
		const onInstalled = () => {
			visible = false;
			window.__deferredInstallPrompt = undefined;
		};
		window.addEventListener('pwa-installable', onInstallable);
		window.addEventListener('appinstalled', onInstalled);
		return () => {
			window.removeEventListener('pwa-installable', onInstallable);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});
</script>

{#if visible}
	<div
		class="bg-card border-border pointer-events-auto fixed inset-x-3 bottom-3 z-[200] mx-auto flex max-w-sm items-center gap-3 rounded-2xl border-2 p-3 shadow-2xl"
		style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));"
	>
		<img src="{base}/icons/icon-192.png" alt="" class="size-11 shrink-0 rounded-xl" />

		{#if showIosHint}
			<div class="min-w-0 flex-1 text-sm leading-snug">
				<p class="font-bold">ثبّت تطبيق OPS</p>
				<p class="text-muted-foreground flex items-center gap-1 text-xs">
					اضغط <Share class="inline size-3.5" /> ثم «أضف إلى الشاشة الرئيسية»
				</p>
			</div>
			<button
				type="button"
				onclick={dismiss}
				aria-label="إغلاق"
				class="text-muted-foreground hover:text-foreground shrink-0 p-1"
			>
				<X class="size-5" />
			</button>
		{:else}
			<div class="min-w-0 flex-1">
				<p class="text-sm font-bold">ثبّت تطبيق OPS</p>
				<p class="text-muted-foreground text-xs">وصول أسرع من الشاشة الرئيسية</p>
			</div>
			<button
				type="button"
				onclick={dismiss}
				aria-label="لاحقاً"
				class="text-muted-foreground hover:text-foreground shrink-0 p-1"
			>
				<X class="size-5" />
			</button>
			<button
				type="button"
				onclick={install}
				class="bg-primary text-primary-foreground inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-bold"
			>
				<Download class="size-4" /> تثبيت
			</button>
		{/if}
	</div>
{/if}
