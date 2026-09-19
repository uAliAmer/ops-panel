<script lang="ts">
	import { updated } from '$app/state';
	import { RefreshCw } from '@lucide/svelte';

	// `updated.current` flips to true when SvelteKit detects a newer deployed
	// version. Tell the waiting service worker to activate, then reload once it
	// takes control — otherwise the old SW keeps serving the page and the reload
	// is a no-op (the bug where only Ctrl+Shift+R picked up changes).
	let reloading = $state(false);

	async function reload() {
		if (reloading) return;
		reloading = true;
		try {
			if ('serviceWorker' in navigator) {
				const reg = await navigator.serviceWorker.getRegistration();
				const waiting = reg?.waiting;
				if (waiting) {
					navigator.serviceWorker.addEventListener(
						'controllerchange',
						() => location.reload(),
						{ once: true }
					);
					waiting.postMessage({ type: 'SKIP_WAITING' });
					return; // reload fires on controllerchange
				}
			}
		} catch {
			/* fall through to a plain reload */
		}
		location.reload();
	}
</script>

{#if updated.current}
	<!-- Centered, full-screen update prompt -->
	<!-- pointer-events-auto is load-bearing, not decoration. A bits-ui modal sets
	     pointer-events:none on <body> while it is open, and every element outside
	     the dialog inherits it — so this prompt drew on top at z-200 and still
	     swallowed the click, which is why the button only worked once every other
	     panel had been closed. -->
	<div
		class="pointer-events-auto fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
	>
		<div class="bg-card flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border p-7 text-center shadow-2xl">
			<div class="bg-primary/15 text-primary flex size-16 items-center justify-center rounded-full">
				<RefreshCw class="size-8 {reloading ? 'animate-spin' : ''}" />
			</div>
			<div class="space-y-1">
				<h2 class="text-xl font-bold">نسخة جديدة متوفرة</h2>
				<p class="text-muted-foreground text-sm">اضغط للتحديث للحصول على آخر التغييرات</p>
			</div>
			<button
				type="button"
				onclick={reload}
				disabled={reloading}
				class="bg-primary text-primary-foreground flex h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-bold shadow-lg active:opacity-90 disabled:opacity-70"
			>
				<RefreshCw class="size-5 {reloading ? 'animate-spin' : ''}" />
				{reloading ? 'جاري التحديث…' : 'تحديث الآن'}
			</button>
		</div>
	</div>
{/if}
