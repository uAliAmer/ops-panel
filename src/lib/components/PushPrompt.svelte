<script lang="ts">
	/**
	 * Offers notifications on opening ops, instead of leaving them behind the
	 * bell in the chat panel — which nobody found.
	 *
	 * Deliberately OUR card first, not the browser's dialog.
	 * `Notification.requestPermission()` fired on page load, with no tap behind
	 * it, is what Chrome answers with its quiet UI — and a Block is permanent:
	 * the browser never asks again and the operator has to dig through site
	 * settings to undo it. So this asks in Arabic, in the app, and only calls
	 * the browser when the operator taps تفعيل — inside that gesture, where the
	 * prompt is the ordinary loud one and a "later" costs nothing.
	 */
	import { browser } from '$app/environment';
	import { Bell, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { auth } from '$lib/stores/auth.svelte';
	import { haptic } from '$lib/utils/haptic';
	import { pushSupported, currentSubscription, enablePush, syncPush } from '$lib/utils/push';
	import { tourSeen, CHAT_TOUR_KEY } from '$lib/utils/tour';

	const SNOOZE_KEY = 'chatPushPromptUntil';
	const DAY = 24 * 60 * 60 * 1000;
	/** Long enough not to nag a shift, short enough to catch a new starter. */
	const SNOOZE_MS = 3 * DAY;
	/** After the card has appeared, before it appears — the page settles first. */
	const DELAY_MS = 2500;

	let visible = $state(false);
	let busy = $state(false);
	let asked = false;

	/**
	 * Hung off the chat icon in the header, not parked at the bottom of the
	 * screen.
	 *
	 * It used to sit in the corner the PWA install card owns, which read as a
	 * second advert from nowhere in particular. Notifications are about the
	 * messages that arrive at that icon, so the offer points at it: an operator
	 * can see what is being talked about, and where to go afterwards to change
	 * their mind.
	 */
	const GAP = 8;
	const EDGE = 8;
	const CARD_W = 320;
	let pos = $state({ top: 72, right: EDGE, caretRight: 24 });

	/** The visible copy of the chip: both bars are mounted and CSS hides one, and
	 *  a hidden button reports a zero-sized rect. */
	function anchorRect(): DOMRect | null {
		const buttons = [...document.querySelectorAll<HTMLElement>('[data-chat-trigger]')];
		for (const b of buttons) {
			const r = b.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) return r;
		}
		return null;
	}

	function place() {
		const width = Math.min(CARD_W, window.innerWidth - 2 * EDGE);
		const a = anchorRect();
		if (!a) {
			// No chip on this screen — still show it, just under the header.
			pos = { top: 72, right: EDGE, caretRight: width / 2 };
			return;
		}
		// Anchored by its END edge, this being RTL, but clamped so the other edge
		// cannot leave the screen on a narrow phone.
		const wanted = window.innerWidth - a.right;
		const maxRight = Math.max(EDGE, window.innerWidth - width - EDGE);
		const right = Math.max(EDGE, Math.min(wanted, maxRight));
		// The caret sits under the middle of the icon, wherever the card landed.
		const caret = window.innerWidth - (a.left + a.width / 2) - right;
		pos = {
			top: a.bottom + GAP,
			right,
			caretRight: Math.max(12, Math.min(width - 12, caret))
		};
	}

	$effect(() => {
		if (!visible) return;
		place();
		const onMove = () => place();
		window.addEventListener('resize', onMove);
		window.addEventListener('scroll', onMove, true);
		return () => {
			window.removeEventListener('resize', onMove);
			window.removeEventListener('scroll', onMove, true);
		};
	});

	function snoozed() {
		try {
			return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0);
		} catch {
			return false; // private mode, blocked storage — ask rather than never ask
		}
	}

	function snooze(ms: number) {
		try {
			localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
		} catch {
			/* nothing to remember it with; the card returns next load */
		}
	}

	$effect(() => {
		if (!browser || !auth.isAuthenticated || asked) return;
		asked = true;
		let alive = true;
		const timer = setTimeout(async () => {
			if (!alive || !pushSupported() || Notification.permission === 'denied') return;

			// Already subscribed: nothing to ask, just re-point it at whoever is
			// logged in now — these are shared machines.
			if (await currentSubscription()) {
				void syncPush();
				return;
			}
			// Permission is already granted on this device — a second operator
			// logging in, or a subscription that lapsed. Subscribing shows no
			// browser dialog at all, so there is nothing to ask about.
			if (Notification.permission === 'granted') {
				void enablePush();
				return;
			}
			if (!alive || snoozed()) return;
			// The chat walkthrough dims the screen and is mid-sentence at this
			// point. Two things asking for attention at once is how both get
			// dismissed unread; this one comes back on the next load.
			if (!tourSeen(CHAT_TOUR_KEY)) return;
			visible = true;
		}, DELAY_MS);

		return () => {
			alive = false;
			clearTimeout(timer);
		};
	});

	async function enable() {
		if (busy) return;
		busy = true;
		haptic(15);
		try {
			const state = await enablePush();
			visible = false;
			if (state === 'on') toast.success('ستصلك التنبيهات على هذا الجهاز');
			else if (state === 'ios-needs-install')
				toast.info('على iPhone: شارك ← أضف إلى الشاشة الرئيسية، ثم فعّل التنبيهات', {
					duration: 8000
				});
			else if (state === 'denied') {
				// Nothing more to offer: the browser will not ask again either.
				snooze(365 * DAY);
				toast.error('التنبيهات محظورة — فعّلها من إعدادات المتصفح لهذا الموقع');
			} else snooze(SNOOZE_MS);
		} finally {
			busy = false;
		}
	}

	function later() {
		haptic(8);
		snooze(SNOOZE_MS);
		visible = false;
	}
</script>

{#if visible}
	<div
		class="bg-card border-border pointer-events-auto fixed z-[200] flex w-[20rem] max-w-[calc(100vw-1rem)] items-center gap-3 rounded-2xl border-2 p-3 shadow-2xl"
		style="top: {pos.top}px; right: {pos.right}px;"
		dir="rtl"
	>
		<!-- Points at the chat icon it is talking about. Square, rotated, with the
		     two lit edges matching the card's border so it reads as one shape. -->
		<span
			class="bg-card border-border absolute -top-[7px] size-3 rotate-45 border-l-2 border-t-2"
			style="right: {pos.caretRight}px;"
		></span>
		<span class="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
			<Bell class="size-5" />
		</span>
		<div class="min-w-0 flex-1">
			<p class="text-sm font-bold">تنبيهات الرسائل</p>
			<p class="text-muted-foreground text-xs">لتصلك رسائل الفريق والجهاز مقفل</p>
		</div>
		<button
			type="button"
			onclick={later}
			aria-label="لاحقاً"
			class="text-muted-foreground hover:text-foreground shrink-0 p-1"
		>
			<X class="size-5" />
		</button>
		<button
			type="button"
			onclick={enable}
			disabled={busy}
			class="bg-primary text-primary-foreground inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-bold disabled:opacity-60"
		>
			<Bell class="size-4" /> تفعيل
		</button>
	</div>
{/if}
