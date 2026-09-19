<script lang="ts">
	import { base } from '$app/paths';
	import { fly } from 'svelte/transition';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { LogOut, RefreshCw, Search, Sun, Moon, Plus, MoreHorizontal, Scale } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { haptic } from '$lib/utils/haptic';
	import WalletChip from '$lib/components/WalletChip.svelte';
	import DriversWalletChip from '$lib/components/DriversWalletChip.svelte';
	import PickupChip from '$lib/components/PickupChip.svelte';
	import RemindersChip from '$lib/components/RemindersChip.svelte';
	import ChatChip from '$lib/components/ChatChip.svelte';
	import RetroClock from '$lib/components/RetroClock.svelte';

	type Props = {
		count?: number;
		connected?: boolean;
		refreshing?: boolean;
		onRefresh?: () => void;
		onSearchToggle?: () => void;
		onNew?: () => void;
	};
	let deskMenuOpen = $state(false);
	let deskMenuBtn = $state<HTMLElement | null>(null);
	let deskMenuPos = $state({ top: 0, right: 0 });

	/**
	 * The header is sticky with a z-index of its own, which makes it a stacking
	 * context: a menu nested inside it cannot rise above anything outside with a
	 * higher z, whatever z-index the menu itself carries. That is why this one
	 * appeared UNDER an open order detail. Moving it to <body> takes it out of
	 * the header's context entirely — the same fix HintPopover and the chat
	 * panel already use.
	 */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	function placeDeskMenu() {
		if (!deskMenuBtn) return;
		const r = deskMenuBtn.getBoundingClientRect();
		const width = 176; // w-44
		const wanted = window.innerWidth - r.right;
		const maxRight = Math.max(8, window.innerWidth - width - 8);
		deskMenuPos = { top: r.bottom + 8, right: Math.max(8, Math.min(wanted, maxRight)) };
	}

	$effect(() => {
		if (!deskMenuOpen) return;
		placeDeskMenu();
		const onMove = () => placeDeskMenu();
		window.addEventListener('resize', onMove);
		window.addEventListener('scroll', onMove, true);
		return () => {
			window.removeEventListener('resize', onMove);
			window.removeEventListener('scroll', onMove, true);
		};
	});

	let { count = 0, connected = false, refreshing = false, onRefresh, onSearchToggle, onNew }: Props =
		$props();

	// Spin the refresh icon for at least a moment even when the fetch is instant,
	// so the tap always registers visually.
	let spinning = $state(false);
	let spinTimer: ReturnType<typeof setTimeout> | null = null;

	function handleRefresh() {
		haptic(12);
		spinning = true;
		if (spinTimer) clearTimeout(spinTimer);
		spinTimer = setTimeout(() => (spinning = false), 600);
		onRefresh?.();
	}

	function tap(fn?: () => void) {
		haptic(10);
		fn?.();
	}

	// Settlement (تسوية الوسيط) is finance-only: the backend gates it on a
	// FINANCE_EMAILS allowlist and hands `finance` back with the user. Hiding the
	// entry is convenience — the 403 is the gate.
	const canSettle = $derived(auth.user?.finance === true);

	function openSettlement() {
		haptic(10);
		goto(`${base}/settlement/`);
	}

	// Mobile overflow menu (⋯) behind the third floating circle.
	let menuOpen = $state(false);
	function closeMenu() {
		menuOpen = false;
	}

	// Shared glass-circle style for the mobile floating buttons.
	const circle =
		'apple-press flex size-11 shrink-0 items-center justify-center rounded-full border border-border/40 bg-card/75 supports-[backdrop-filter]:bg-card/60 shadow-[0_6px_20px_rgb(0_0_0/0.2)] ring-1 ring-inset ring-white/15 backdrop-blur-2xl backdrop-saturate-200 transition-all duration-150 active:scale-95';
</script>

<!-- ===================== Desktop bar (lg+) ===================== -->
<header
	class="bg-card/70 border-border supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30 hidden items-center justify-between gap-2 border-b px-3 py-2.5 backdrop-blur-xl backdrop-saturate-150 lg:flex relative"
>
	<div class="flex min-w-0 items-center gap-2">
		<img src="{base}/icons/icon-192.png" alt="OPS" class="size-7 rounded-lg" />
		<h1 class="truncate text-base font-black tracking-tight">OPS</h1>
		{#if count > 0}
			<Badge variant="secondary" class="px-1.5 py-0 text-xs">{count}</Badge>
		{/if}
		{#if connected}
			<span class="size-2 rounded-full bg-emerald-500" title="متصل — التحديث المباشر يعمل"></span>
		{:else}
			<span
				class="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400"
				title="انقطع الاتصال — اسحب أو اضغط تحديث لجلب الجديد"
			>
				<span class="size-1.5 rounded-full bg-rose-500"></span>
				غير متصل
			</span>
		{/if}
	</div>

	<!-- Centred on the BAR, not placed between the groups: the two sides are
	     different widths, so a clock sitting between them would land wherever
	     their contents pushed it and drift every time a chip changed size.
	     Absolute centring pins it to the middle of the screen regardless.

	     Shown from lg, where this bar first appears: the two side groups come to
	     roughly 670px and the centre chip to 200, so they clear each other even
	     at 1024. Hiding it below xl would have taken the clock and the delivery
	     count off the bar entirely between 1024 and 1280. -->
	<div class="pointer-events-none absolute start-1/2 hidden -translate-x-1/2 lg:block rtl:translate-x-1/2">
		<!-- Clock and delivery count in one chip. They belong together: both
		     answer "where are we right now" rather than asking to be acted on,
		     which is what the rest of the bar does. The delivery half still
		     recedes when there is nothing waiting, so the chip quietly becomes
		     just a clock without changing shape or moving anything. -->
		<div
			class="border-border/60 bg-card/60 pointer-events-auto inline-flex h-9 items-center divide-x divide-border/40 overflow-hidden rounded-xl border shadow-xs ring-1 ring-white/10 ring-inset backdrop-blur-2xl backdrop-saturate-200 rtl:divide-x-reverse"
		>
			<RetroClock flat />
			<PickupChip flat />
		</div>
	</div>

	<!-- Two kinds of thing live here and they were spaced as if they were one:
	     chips that CARRY a number, and icon buttons that DO something. They now
	     sit in their own groups with a rule between them — the chips breathe at
	     gap-1.5, the actions tuck together at gap-0.5, and everything is h-9 so
	     the row has one baseline. -->
	<div class="flex shrink-0 items-center gap-2">
		<div class="flex items-center gap-1.5">
		<!-- Wider and labelled on the desktop bar: there is room for it there,
		     and chat is the one header control an operator opens on purpose
		     rather than glances at. -->
		<ChatChip
			class="h-9 w-auto gap-1.5 px-3"
			iconClass="size-[1.15rem]"
			label="المحادثات"
			surface="desktop"
		/>
		<RemindersChip />
		<!-- Carrier wallet and driver debt as one pill: two money figures that
		     were two separate chips taking two chips' worth of a crowded bar.
		     Each half keeps its own colour and its own sheet — they are still
		     two different questions, just one object. -->
		<div
			class="border-border/60 bg-card/60 inline-flex h-9 shrink-0 flex-col justify-center divide-y divide-border/40 overflow-hidden rounded-xl border shadow-xs ring-1 ring-white/10 ring-inset backdrop-blur-2xl backdrop-saturate-200"
		>
			<WalletChip flat />
			<DriversWalletChip flat />
		</div>
		</div>

		<div class="bg-border/60 h-5 w-px shrink-0"></div>

		<div class="flex items-center gap-0.5">
		{#if canSettle}
			<Button
				variant="ghost"
				size="icon"
				aria-label="تسوية الوسيط"
				title="تسوية الوسيط"
				onclick={openSettlement}
			>
				<Scale class="size-5" />
			</Button>
		{/if}
		{#if onNew}
			<!-- The one filled control in the bar, and the only thing here that
			     CREATES rather than reveals. It keeps the primary fill but takes
			     the row's shape — rounded-xl like every chip beside it, instead of
			     the button default's tighter corner — with the glow and inset
			     ring the coloured chips use, so it reads as the same family at a
			     higher volume rather than a component from somewhere else. -->
			<Button
				size="sm"
				class="h-9 gap-1.5 rounded-xl px-3.5 text-sm font-black shadow-[0_3px_14px_rgba(59,130,246,0.35)] ring-1 ring-white/25 ring-inset transition-all hover:shadow-[0_4px_18px_rgba(59,130,246,0.45)] active:scale-95"
				aria-label="طلب جديد"
				onclick={() => tap(onNew)}
			>
				<Plus class="size-4" /> جديد
			</Button>
		{/if}
		<!-- Grows from an icon to an invitation on hover or keyboard focus. The
		     label animates its max-width and margin rather than being toggled, so
		     the button slides open instead of the row jumping when a word appears
		     in it. Width is the only thing that moves — the icon stays put. -->
		<button
			type="button"
			class="group apple-press hover:bg-secondary/70 focus-visible:bg-secondary/70 inline-flex h-9 shrink-0 items-center rounded-xl px-2.5 text-sm font-bold transition-colors outline-none"
			aria-label="بحث"
			onclick={() => tap(onSearchToggle)}
		>
			<Search class="size-5 shrink-0" />
			<span
				class="ms-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-out group-hover:ms-1.5 group-hover:max-w-[9rem] group-hover:opacity-100 group-focus-visible:ms-1.5 group-focus-visible:max-w-[9rem] group-focus-visible:opacity-100 motion-reduce:transition-none"
			>
				تدور على شي؟
			</span>
		</button>
		<!-- Theme and logout behind one menu: neither is pressed during a shift,
		     and each was spending a permanent slot in the row to say so. Refresh
		     is gone from this bar entirely — useRefresh already reloads on the
		     socket, on tab focus, and every 30s, so the button only ever bought
		     reassurance; it stays in the mobile menu, where the connection is
		     worst and that reassurance is worth something. -->
		<div bind:this={deskMenuBtn} class="inline-flex">
			<Button
				variant="ghost"
				size="icon"
				aria-label="المزيد"
				aria-expanded={deskMenuOpen}
				onclick={() => { haptic(10); deskMenuOpen = !deskMenuOpen; }}
			>
				<MoreHorizontal class="size-5" />
			</Button>
		</div>
		{#if deskMenuOpen}
			<div use:portal class="fixed inset-0 z-[80]">
				<button
					type="button"
					class="absolute inset-0 cursor-default"
					aria-label="إغلاق القائمة"
					onclick={() => (deskMenuOpen = false)}
				></button>
				<div
					transition:fly={{ y: -8, duration: 150 }}
					class="border-border/40 bg-card/85 supports-[backdrop-filter]:bg-card/75 absolute flex w-44 flex-col gap-0.5 rounded-2xl border p-1.5 shadow-[0_12px_36px_rgb(0_0_0/0.28)] ring-1 ring-white/15 ring-inset backdrop-blur-2xl"
					style="top: {deskMenuPos.top}px; right: {deskMenuPos.right}px;"
					dir="rtl"
					role="menu"
				>
					<button
						type="button"
						role="menuitem"
						class="hover:bg-secondary/70 flex items-center gap-2 rounded-xl px-3 py-2 text-right text-sm font-bold"
						onclick={() => { deskMenuOpen = false; tap(() => theme.toggle()); }}
					>
						{#if theme.effective === 'dark'}
							<Sun class="size-4" /> وضع فاتح
						{:else}
							<Moon class="size-4" /> وضع داكن
						{/if}
					</button>
					<button
						type="button"
						role="menuitem"
						class="flex items-center gap-2 rounded-xl px-3 py-2 text-right text-sm font-bold text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
						onclick={() => { deskMenuOpen = false; tap(() => auth.logout()); }}
					>
						<LogOut class="size-4" /> خروج
					</button>
				</div>
			</div>
		{/if}
		</div>
	</div>
</header>

<!-- ============ Mobile floating glass circles (no top bar) ============ -->
<!-- Three circles pinned to the top-start (right, in RTL); content scrolls
     under them. Search expands the field below, ＋ opens the new-order form,
     and the menu circle holds refresh / theme / wallet / connection / logout. -->
<div
	class="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-3 pt-[max(0.6rem,env(safe-area-inset-top))] lg:hidden"
>
	<!-- Search — top-start corner (right in RTL) -->
	<button type="button" class={circle} aria-label="بحث" onclick={() => tap(onSearchToggle)}>
		<Search class="size-5" />
	</button>

	<!-- Chat + ＋New + Menu — top-end corner (left in RTL) -->
	<div class="flex items-center gap-2">
	<!-- Out of the overflow menu and onto the bar: messages arrive while you
	     work, and a badge nobody can see until they open a menu is not a badge.
	     Sized as a header circle so it reads as part of the bar, not a chip
	     borrowed from the desktop one. -->
	<ChatChip
		class="size-11 rounded-full border-border/40 bg-card/75 shadow-[0_6px_20px_rgb(0_0_0/0.2)]"
		iconClass="size-5"
		surface="mobile"
	/>

	{#if onNew}
		<button
			type="button"
			class="{circle} !bg-primary !text-primary-foreground !border-primary/50"
			aria-label="طلب جديد"
			onclick={() => tap(onNew)}
		>
			<Plus class="size-5" />
		</button>
	{/if}

	<div class="relative">
		<button
			type="button"
			class={circle}
			aria-label="المزيد"
			aria-expanded={menuOpen}
			onclick={() => { haptic(10); menuOpen = !menuOpen; }}
		>
			<MoreHorizontal class="size-5" />
		</button>

		{#if menuOpen}
			<!-- Outside-tap catcher -->
			<button
				type="button"
				class="fixed inset-0 z-40 cursor-default"
				aria-label="إغلاق القائمة"
				onclick={closeMenu}
			></button>
			<div
				transition:fly={{ y: -8, duration: 150 }}
				class="border-border/40 bg-card/85 supports-[backdrop-filter]:bg-card/75 absolute end-0 top-full z-50 mt-2 flex w-52 origin-top-left flex-col gap-0.5 rounded-2xl border p-1.5 shadow-[0_12px_36px_rgb(0_0_0/0.28)] ring-1 ring-inset ring-white/15 backdrop-blur-2xl backdrop-saturate-200"
				role="menu"
			>
				<!-- Wallet + driver-debt chips: each shows a total and opens its dialog -->
				<div class="flex flex-wrap items-center gap-1.5 px-1 py-0.5" role="menuitem">
					<RetroClock />
					<RemindersChip />
					<PickupChip />
					<div
						class="border-border/60 bg-card/60 inline-flex h-9 shrink-0 flex-col justify-center divide-y divide-border/40 overflow-hidden rounded-xl border shadow-xs ring-1 ring-white/10 ring-inset"
					>
						<WalletChip flat />
						<DriversWalletChip flat />
					</div>
				</div>

				<div class="bg-border/60 my-1 h-px"></div>

				{#if canSettle}
					<button
						type="button"
						role="menuitem"
						class="hover:bg-accent flex items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-semibold transition-colors"
						onclick={() => { closeMenu(); openSettlement(); }}
					>
						<Scale class="size-4" /> تسوية الوسيط
					</button>
				{/if}
				<button
					type="button"
					role="menuitem"
					class="hover:bg-accent flex items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-semibold transition-colors"
					onclick={() => { closeMenu(); handleRefresh(); }}
				>
					<RefreshCw class="size-4 {spinning || refreshing ? 'animate-spin' : ''}" /> تحديث
				</button>
				<button
					type="button"
					role="menuitem"
					class="hover:bg-accent flex items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-semibold transition-colors"
					onclick={() => { closeMenu(); tap(() => theme.toggle()); }}
				>
					{#if theme.effective === 'dark'}
						<Sun class="size-4" /> وضع فاتح
					{:else}
						<Moon class="size-4" /> وضع داكن
					{/if}
				</button>

				<!-- Live-connection status, moved out of the (now removed) top bar -->
				<div class="text-muted-foreground flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold">
					{#if connected}
						<span class="size-2 rounded-full bg-emerald-500"></span> متصل — تحديث مباشر
					{:else}
						<span class="size-2 rounded-full bg-rose-500"></span>
						<span class="text-rose-600 dark:text-rose-400">غير متصل</span>
					{/if}
				</div>

				<div class="bg-border/60 my-1 h-px"></div>

				<button
					type="button"
					role="menuitem"
					class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
					onclick={() => { closeMenu(); tap(() => auth.logout()); }}
				>
					<LogOut class="size-4" /> خروج
				</button>
			</div>
		{/if}
		</div>
	</div>
</div>
