<script lang="ts">
	/**
	 * A three-step walkthrough for the chat, shown once.
	 *
	 * This app ships with no release notes and its operators learned the screen
	 * months ago and stopped reading it — a new button is invisible to anyone who
	 * was never told it exists (the same reason hint.ts exists). Chat is bigger
	 * than a button: a room, DMs, a thread on every order, and @mentions. Nobody
	 * finds four things by accident.
	 *
	 * Deliberately small: it spotlights the real control, says one sentence, and
	 * ends. It shows ONCE per browser, waits for the page to settle, is skippable
	 * at every step, and never appears at all for an operator who already opened
	 * the chat panel on their own — someone who found it does not need a tour of
	 * it (ChatChip marks it seen).
	 */
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { fly, fade } from 'svelte/transition';
	import { MessageCircle, AtSign, Package, X } from '@lucide/svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { haptic } from '$lib/utils/haptic';
	import { tourSeen, markTourSeen, CHAT_TOUR_KEY } from '$lib/utils/tour';

	type Step = {
		/** What to point at. Null = say it in the middle of the screen. */
		selector: string | null;
		title: string;
		text: string;
		icon: typeof MessageCircle;
	};

	const STEPS: Step[] = [
		{
			selector: '[data-chat-trigger]',
			title: 'جديد: محادثة الفريق',
			text: 'كل الرسائل هنا — غرفة الفريق، رسائل خاصة مع أي زميل، ومحادثات الطلبات. الرقم الأحمر يعني رسائل لم تقرأها.',
			icon: MessageCircle
		},
		{
			selector: '[data-chat-trigger]',
			title: 'أشِر إلى زميل بـ @',
			text: 'اكتب @ ثم اسم الزميل داخل أي رسالة — تصله إشارة، وتظهر له في تبويب «الإشارات». من الجرس داخل اللوحة يفعّل التنبيهات لتصله والشاشة مقفلة.',
			icon: AtSign
		},
		{
			selector: '[data-order-card]',
			title: 'لكل طلب محادثته',
			text: 'افتح أي طلب وستجد المحادثة داخله — اكتب عنه هنا بدل واتساب وتبقى ملاحظتك مع الطلب. آخر رسالة تظهر على بطاقة الطلب.',
			icon: Package
		}
	];

	let step = $state(0);
	let visible = $state(false);
	let rect = $state<DOMRect | null>(null);

	const current = $derived(STEPS[step]);

	/** The visible copy of an anchor: the header chip is mounted twice with CSS
	 *  hiding one, and a hidden element reports a zero-sized rect. */
	function findAnchor(selector: string | null): HTMLElement | null {
		if (!selector) return null;
		for (const el of document.querySelectorAll<HTMLElement>(selector)) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) return el;
		}
		return null;
	}

	function measure() {
		const el = findAnchor(current?.selector ?? null);
		rect = el ? el.getBoundingClientRect() : null;
	}

	$effect(() => {
		if (!visible) return;
		void step; // re-measure on every step
		measure();
		const onMove = () => measure();
		window.addEventListener('resize', onMove);
		window.addEventListener('scroll', onMove, true);
		return () => {
			window.removeEventListener('resize', onMove);
			window.removeEventListener('scroll', onMove, true);
		};
	});

	onMount(() => {
		if (!browser || !auth.isAuthenticated || tourSeen(CHAT_TOUR_KEY)) return;
		// After the page has settled. Landing on top of a loading list would make
		// the app feel like it opened with an advert.
		const timer = setTimeout(() => {
			// No chip on screen means this is not a screen the tour can explain.
			if (!findAnchor('[data-chat-trigger]')) return;
			visible = true;
		}, 1500);
		return () => clearTimeout(timer);
	});

	function next() {
		haptic(8);
		if (step < STEPS.length - 1) {
			step += 1;
			return;
		}
		finish();
	}

	function finish() {
		haptic(10);
		visible = false;
		markTourSeen(CHAT_TOUR_KEY);
	}

	/** Card placement: under the anchor, or centred when there is nothing to
	 *  point at. Clamped so neither edge leaves the screen on a phone. */
	const CARD_W = 320;
	const GAP = 12;
	const placement = $derived.by(() => {
		if (!rect) return null;
		const w = Math.min(CARD_W, (browser ? window.innerWidth : 360) - 24);
		const below = rect.bottom + GAP;
		const wantLeft = rect.left + rect.width / 2 - w / 2;
		const left = Math.max(12, Math.min(wantLeft, (browser ? window.innerWidth : 360) - w - 12));
		return {
			top: below,
			left,
			width: w,
			arrow: Math.max(16, Math.min(rect.left + rect.width / 2 - left, w - 16))
		};
	});
</script>

{#if visible && current}
	<!-- The dim is cast BY the spotlight — one element with an enormous spread
	     shadow, so the anchor stays lit and everything else recedes without
	     cutting a hole in anything. Clicking the dim moves on, the way a tour
	     that respects the reader should. -->
	<div class="fixed inset-0 z-[500]" transition:fade={{ duration: 150 }} dir="rtl">
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default"
			aria-label="التالي"
			onclick={next}
		></button>

		{#if rect}
			<div
				class="pointer-events-none absolute rounded-2xl ring-2 ring-white/90 transition-all duration-300 dark:ring-white/70"
				style="top: {rect.top - 6}px; left: {rect.left - 6}px; width: {rect.width + 12}px; height: {rect.height +
					12}px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.62);"
			></div>
		{:else}
			<div class="pointer-events-none absolute inset-0 bg-black/62"></div>
		{/if}

		<div
			class="pointer-events-auto absolute rounded-2xl border border-border/60 bg-card p-4 shadow-2xl"
			style={placement
				? `top: ${placement.top}px; left: ${placement.left}px; width: ${placement.width}px;`
				: 'top: 50%; left: 50%; width: min(20rem, calc(100vw - 1.5rem)); transform: translate(-50%, -50%);'}
			transition:fly={{ y: 8, duration: 180 }}
			role="dialog"
			aria-live="polite"
		>
			{#if placement}
				<span
					class="bg-card border-border/60 absolute -top-[7px] size-3 rotate-45 border-l border-t"
					style="left: {placement.arrow - 6}px;"
				></span>
			{/if}

			<div class="flex items-start gap-2.5">
				<span class="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
					<current.icon class="size-4.5" />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-black">{current.title}</p>
					<p class="text-muted-foreground mt-1 text-xs font-semibold leading-relaxed">{current.text}</p>
				</div>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground -mt-1 -ml-1 shrink-0 p-1"
					aria-label="تخطّي"
					onclick={finish}
				>
					<X class="size-4" />
				</button>
			</div>

			<div class="mt-3 flex items-center justify-between gap-2">
				<span class="flex items-center gap-1.5" aria-hidden="true">
					{#each STEPS as _, i (i)}
						<span
							class="size-1.5 rounded-full transition-colors {i === step
								? 'bg-primary'
								: 'bg-muted-foreground/30'}"
						></span>
					{/each}
				</span>
				<div class="flex items-center gap-2">
					{#if step < STEPS.length - 1}
						<button
							type="button"
							class="text-muted-foreground px-2 py-1 text-xs font-bold"
							onclick={finish}
						>
							تخطّي
						</button>
					{/if}
					<button
						type="button"
						class="bg-primary text-primary-foreground apple-press h-9 rounded-xl px-4 text-xs font-black"
						onclick={next}
					>
						{step < STEPS.length - 1 ? 'التالي' : 'فهمت'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
