<script lang="ts">
	// Header chip: what is still on THIS operator's shelf — their branch only.
	// Two numbers for Alwaseet (packed but unsent · labelled and waiting for
	// their driver) and one for their own drivers. The sheet behind it carries
	// every branch, the operator's first and the rest folded.
	//
	// It exists for one moment in the day: the Alwaseet driver walks in and the
	// operator has to know how many parcels to count out. That number was only
	// ever obtainable by opening the list and counting rows by eye.
	import { onMount, onDestroy } from 'svelte';
	import { Dialog, DialogContent } from '$lib/components/ui/dialog';
	import { Box, Truck, Bike, X, RefreshCw, ChevronDown, Send, BellRing } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import {
		api,
		type PickupBranch,
		type PickupCounts,
		type PickupDriver,
		type PickupOrder
	} from '$lib/api';
	import { socketStore } from '$lib/stores/socket.svelte';
	import { haptic } from '$lib/utils/haptic';
	import HintPopover from '$lib/components/HintPopover.svelte';
	import { driverAvatar } from '$lib/utils/driverAvatar';
	import { formatPrice } from '$lib/utils/format';

	// `flat` drops the pill so this can share the centre chip with the clock.
	let { flat = false }: { flat?: boolean } = $props();

	let open = $state(false);
	let counts = $state<PickupCounts | null>(null);
	let loading = $state(false);
	let loadedOnce = $state(false);

	// The chip speaks for the operator's OWN branch. A shared total told an
	// operator at one branch to count out parcels sitting at the other; the
	// figure has to be the one they act on. Every branch is in the sheet.
	const mine = $derived(counts?.branches.find((b) => b.key === counts?.myBranch) ?? null);
	const toPack = $derived(mine?.alwaseet.toPack ?? 0);
	const awaiting = $derived(mine?.alwaseet.awaitingPickup ?? 0);
	const localTotal = $derived(mine?.local.total ?? 0);
	const idle = $derived(loadedOnce && toPack + awaiting + localTotal === 0);
	// Work sitting in another branch's pile, or in none — not counted on the
	// chip, but worth a dot so nobody has to open the sheet to know it is there.
	const elsewhere = $derived(
		(counts?.branches ?? [])
			.filter((b) => b.key !== counts?.myBranch)
			.reduce((n, b) => n + b.alwaseet.toPack + b.alwaseet.awaitingPickup + b.local.total, 0)
	);

	// Other branches start folded: an operator opens this to act on their own
	// pile, and the other branch's numbers are context, not their job. Keyed by
	// branch so a fold survives the 60s refresh.
	let expanded = $state<Record<string, boolean>>({});
	const isOpen = (key: string) => expanded[key] ?? key === counts?.myBranch;
	function toggle(key: string) {
		haptic(8);
		expanded = { ...expanded, [key]: !isOpen(key) };
	}

	async function load() {
		loading = true;
		try {
			const res = await api.pickupCounts();
			if (res.success && res.data) {
				counts = res.data;
				loadedOnce = true;
			}
		} catch {
			/* header chip is best-effort — a failed poll keeps the last figures */
		} finally {
			loading = false;
		}
	}

	// Live, not on a timer. Every state change that moves these numbers — packing,
	// sending, a driver assignment, the carrier poller seeing a pickup — ends in a
	// `submission_updated` emit, so the chip follows the same signal the order list
	// does. Coalesced: a bulk send fires one event per order and this is one query.
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	function refreshSoon() {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => void load(), 350);
	}

	// The socket can be down (the header shows «غير متصل» when it is), so a slow
	// timer stays as the floor rather than the mechanism.
	const POLL_MS = 30_000;
	let timer: ReturnType<typeof setInterval> | null = null;
	let stopSocket: (() => void) | null = null;
	onMount(() => {
		void load();
		timer = setInterval(() => void load(), POLL_MS);
		stopSocket = socketStore.onSubmissionUpdated(() => refreshSoon());
		// Coming back to the tab is the other moment the figures are stale — an
		// operator who was away at the counter is exactly who reads this next.
		const onVisible = () => {
			if (document.visibilityState === 'visible') void load();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
		if (refreshTimer) clearTimeout(refreshTimer);
		stopSocket?.();
	});

	// Opening the sheet is the one moment the figures must be current.
	$effect(() => {
		if (open) void load();
	});

	// Teach the two driver actions, when they first exist on screen. Nobody presses
	// a button they were never told about.
	//
	// Guarded per mount: this effect re-runs on every refresh of `counts` (the
	// socket, the poll, opening the sheet), and without the latch one visit would
	// spend several of the ten showings.
	// dicebear is a third-party image on a shop's network: it can be slow, blocked
	// or simply down. A broken avatar falls back to the bike rather than leaving a
	// blank disc where the driver should be.
	let avatarBroken = $state<Record<string, boolean>>({});

	// The hint is pinned to the first driver row, so the operator's eye lands on
	// the thing being described instead of on a corner of the screen.
	let driverRowEls = $state<Record<string, HTMLElement | null>>({});
	const hintAnchor = $derived(
		open
			? (Object.entries(driverRowEls).find(([k, el]) => el && k.includes(':local:'))?.[1] ?? null)
			: null
	);

	// ---- hover preview ------------------------------------------------------
	// A glance at WHICH parcels, not just how many: the operator counting them out
	// wants the names on the shelf. Pointer devices only — on a touch screen there
	// is no hover, and the tap already opens the full sheet.
	let hovering = $state(false);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;
	const canHover = () =>
		typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

	// The card cannot live inside the header. That bar sets its own stacking
	// context (sticky + backdrop-blur), so any z-index the card carries is only
	// ever compared against the header's siblings — it painted *under* the order
	// detail pane no matter how high. Moved to <body> and positioned by hand.
	let anchorEl = $state<HTMLElement | null>(null);
	let cardEl = $state<HTMLElement | null>(null);
	let pos = $state({ top: 0, left: 0 });

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	const GAP = 8;
	function place() {
		if (!anchorEl) return;
		const r = anchorEl.getBoundingClientRect();
		const width = cardEl?.offsetWidth ?? 352;
		// Aligned to the chip's own edge, then pulled back inside the viewport —
		// the chip sits at the very end of the header, so an un-clamped card would
		// hang off the screen.
		const left = Math.max(
			GAP,
			Math.min(r.left, window.innerWidth - width - GAP)
		);
		pos = { top: r.bottom + GAP, left };
	}

	// Re-place while it is open: the header is sticky, so the page can scroll
	// under a card that would otherwise drift away from its chip.
	$effect(() => {
		if (!hovering) return;
		place();
		requestAnimationFrame(place); // once more after the card has its width
		const onMove = () => place();
		window.addEventListener('scroll', onMove, true);
		window.addEventListener('resize', onMove);
		return () => {
			window.removeEventListener('scroll', onMove, true);
			window.removeEventListener('resize', onMove);
		};
	});

	function previewIn() {
		if (!canHover()) return;
		if (hoverTimer) clearTimeout(hoverTimer);
		hovering = true;
		void load();
	}
	function previewOut() {
		if (hoverTimer) clearTimeout(hoverTimer);
		// A little grace so crossing the gap between chip and card doesn't close it.
		hoverTimer = setTimeout(() => (hovering = false), 120);
	}
	const previewOrders = $derived(mine?.orders ?? []);

	// ---- the sheet's rows open into the orders behind them -------------------
	// A count answers "how many"; the operator counting parcels out then wants
	// "which". Each row (Alwaseet pile, to-pack pile, one driver) expands to its
	// own orders, and every order is a link into the order page.
	let openRow = $state<string | null>(null);
	function rowKey(branch: string, kind: string, driver?: string | null) {
		return `${branch}:${kind}:${driver ?? ''}`;
	}
	function toggleRow(key: string) {
		haptic(8);
		openRow = openRow === key ? null : key;
	}
	function ordersFor(b: PickupBranch, kind: PickupOrder['kind'], driver?: string | null) {
		return b.orders.filter((o) => o.kind === kind && (driver == null || o.driver === driver));
	}

	/** The rows one branch shows: the two Alwaseet piles, then a row per driver. */
	function sheetRows(b: PickupBranch) {
		return [
			{
				key: rowKey(b.key, 'awaiting'),
				kind: 'awaiting' as const,
				driver: null as string | null,
				label: 'بانتظار مندوب الوسيط',
				count: b.alwaseet.awaitingPickup,
				icon: 'truck',
				record: undefined as PickupDriver | undefined
			},
			{
				key: rowKey(b.key, 'toPack'),
				kind: 'toPack' as const,
				driver: null as string | null,
				label: 'للتجهيز (لم تُرسل بعد)',
				count: b.alwaseet.toPack,
				icon: 'box',
				record: undefined as PickupDriver | undefined
			},
			...b.local.drivers.map((d) => ({
				key: rowKey(b.key, 'local', d.name),
				kind: 'local' as const,
				driver: d.name as string | null,
				label: d.name,
				count: d.count,
				icon: 'bike',
				// The row's own driver record — the day-sheet and page buttons need
				// the id, and the name alone cannot give it.
				record: d as PickupDriver | undefined
			}))
		];
	}
	function openOrder(o: PickupOrder) {
		open = false;
		void goto(`${base}/order/${o.slug}/`);
	}

	// ---- one-tap stage change for an own-driver order ------------------------
	// The stages a LOCAL order actually moves through after assignment. Doing it
	// here saves opening the order for what is usually a single tap at the
	// counter — the same POST the order page makes.
	const LOCAL_STAGES: Array<{ key: 'OUT' | 'DELIVERED' | 'FAILED' | 'RETURNED'; label: string; tone: string }> = [
		{ key: 'OUT', label: 'خرج للتوصيل', tone: 'text-sky-700 dark:text-sky-300 border-sky-500/40 bg-sky-500/10' },
		{ key: 'DELIVERED', label: 'تم التسليم للزبون', tone: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
		{ key: 'FAILED', label: 'تعذّر', tone: 'text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10' },
		{ key: 'RETURNED', label: 'راجع', tone: 'text-rose-700 dark:text-rose-300 border-rose-500/40 bg-rose-500/10' }
	];
	// Which order is showing its stage buttons — deliberately a second tap, so a
	// scrolling thumb cannot mark a parcel delivered.
	let stageFor = $state<string | null>(null);
	let applying = $state<string | null>(null);

	// ---- driver actions from the sheet ---------------------------------------
	// The counter moment: the driver is standing here. Send them the list of what
	// they are taking (and move it out in the same act), or call them in.
	let daySheetFor = $state<{ id: string; name: string; count: number } | null>(null);
	let daySheetMarkOut = $state(true);
	let daySheetSending = $state(false);
	let pagingId = $state<string | null>(null);

	function askDaySheet(driver: PickupDriver) {
		if (!driver.id) return;
		haptic(12);
		daySheetMarkOut = true;
		daySheetFor = { id: driver.id, name: driver.name, count: driver.count };
	}

	async function sendDaySheet() {
		if (!daySheetFor || daySheetSending) return;
		daySheetSending = true;
		const t = toast.loading('جاري الإرسال…');
		try {
			const res = await api.driverDaySheet(daySheetFor.id, daySheetMarkOut);
			if (res.success) {
				toast.success(res.message || 'تم الإرسال', { id: t });
				daySheetFor = null;
				await load();
			} else {
				toast.error(res.error || 'تعذّر الإرسال', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			daySheetSending = false;
		}
	}

	async function pageDriver(driver: PickupDriver) {
		if (!driver.id || pagingId) return;
		pagingId = driver.id;
		haptic(12);
		const t = toast.loading('جاري الاستدعاء…');
		try {
			const res = await api.pageDriver(driver.id);
			if (res.success) toast.success(res.message || 'تم الاستدعاء', { id: t });
			else toast.error(res.error || 'تعذّر الاستدعاء', { id: t });
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			pagingId = null;
		}
	}

	async function applyStage(o: PickupOrder, status: 'OUT' | 'DELIVERED' | 'FAILED' | 'RETURNED') {
		applying = o.submissionId;
		try {
			const res = await api.localStatus(o.submissionId, status);
			if (res.success) {
				toast.success(res.message || 'تم التحديث');
				stageFor = null;
				await load();
			} else {
				toast.error(res.error || 'تعذّر التحديث');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			applying = null;
		}
	}
	const KIND_LABEL: Record<string, string> = {
		awaiting: 'بانتظار الوسيط',
		toPack: 'للتجهيز',
		local: 'مندوبنا'
	};
</script>

<span
	class="relative inline-flex"
	role="presentation"
	bind:this={anchorEl}
	onmouseenter={previewIn}
	onmouseleave={previewOut}
>
<button
	type="button"
	class={flat
		? `apple-press inline-flex h-9 items-center gap-1.5 px-2.5 text-xs font-bold transition-colors ${
				idle
					? 'text-muted-foreground opacity-55 hover:bg-secondary/60 hover:opacity-100 focus-visible:opacity-100'
					: 'text-sky-700 hover:bg-sky-500/15 active:bg-sky-500/25 dark:text-sky-300'
			}`
		: `apple-press inline-flex h-9 items-center gap-2 rounded-xl border text-xs font-bold ring-1 ring-inset backdrop-blur-2xl backdrop-saturate-200 transition-all ${
				idle
					? 'border-border/40 bg-transparent px-2.5 text-muted-foreground opacity-50 ring-transparent hover:opacity-100 focus-visible:opacity-100'
					: 'border-sky-500/35 bg-sky-500/15 px-3 text-sky-700 shadow-[0_2px_10px_rgba(59,130,246,0.15)] ring-sky-500/20 hover:bg-sky-500/25 active:bg-sky-500/35 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-300'
			}`}
	aria-label="طلبات فرعك التي لم تُسلَّم للمندوب"
	title={mine ? `${mine.label} — اضغط لرؤية بقية الفروع` : 'الطلبات التي لم تُسلَّم للمندوب'}
	onclick={() => {
		haptic(10);
		open = true;
	}}
>
	{#if !loadedOnce}
		<Truck class="size-4 shrink-0" />
		<span class="text-xs font-bold">التسليم</span>
	{:else if idle}
		<!-- Nothing to hand over: the chip stays in its place so the eye keeps
		     finding the row in the same shape, but gives up its fill, its border
		     and its words. Faded, not gone — it comes back to full strength on
		     hover or focus, and the title still says what it is. -->
		<Truck class="size-4 shrink-0" />
	{:else}
		<span class="flex items-center gap-1.5 text-xs font-black tabular-nums leading-none">
			<span class="flex items-center gap-1" title="بانتظار مندوب الوسيط">
				<Truck class="size-3.5 opacity-70" />{awaiting}
			</span>
			<span class="opacity-40">·</span>
			<span class="flex items-center gap-1" title="للتجهيز (لم تُرسل بعد)">
				<Box class="size-3.5 opacity-70" />{toPack}
			</span>
			{#if localTotal > 0}
				<span class="opacity-40">·</span>
				<span class="flex items-center gap-1" title="بذمة مندوبينا">
					<Bike class="size-3.5 opacity-70" />{localTotal}
				</span>
			{/if}
		</span>
	{/if}
	{#if loadedOnce && elsewhere > 0}
		<!-- Something is waiting outside your branch. No number: it is not yours to
		     count out, only worth knowing the sheet has more in it. -->
		<span
			class="size-1.5 shrink-0 rounded-full bg-current opacity-40"
			title="توجد طلبات في فروع أخرى"
		></span>
	{/if}
</button>

{#if hovering && loadedOnce && !open}
	<!-- Rendered on <body> (see `portal`) so nothing in the header can paint over
	     it, positioned against the chip by hand. -->
	<div
		use:portal
		bind:this={cardEl}
		style="position: fixed; top: {pos.top}px; left: {pos.left}px;"
		class="bg-card/95 z-[200] w-[26rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border shadow-[0_16px_44px_rgb(0_0_0/0.28)] ring-1 ring-inset ring-white/10 backdrop-blur-2xl"
		dir="rtl"
		onmouseenter={previewIn}
		onmouseleave={previewOut}
		role="presentation"
	>
		<div class="flex items-center justify-between gap-2 border-b px-4 py-3">
			<span class="truncate text-lg font-black">{mine?.label ?? 'فرعك'}</span>
			<span class="flex shrink-0 items-center gap-2 text-base font-black tabular-nums">
				<span class="flex items-center gap-1"><Truck class="size-4 opacity-70" />{awaiting}</span>
				<span class="opacity-40">·</span>
				<span class="flex items-center gap-1"><Box class="size-4 opacity-70" />{toPack}</span>
				{#if localTotal > 0}
					<span class="opacity-40">·</span>
					<span class="flex items-center gap-1"><Bike class="size-4 opacity-70" />{localTotal}</span>
				{/if}
			</span>
		</div>

		{#if previewOrders.length === 0}
			<p class="text-muted-foreground px-4 py-4 text-base">لا شيء بانتظار التسليم في فرعك.</p>
		{:else}
			<ul class="max-h-[26rem] divide-y overflow-y-auto">
				{#each previewOrders as o (o.submissionId)}
					<li class="flex items-center justify-between gap-3 px-4 py-3">
						<span class="flex min-w-0 items-center gap-2.5">
							{#if o.kind === 'local'}
								<Bike class="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
							{:else if o.kind === 'awaiting'}
								<Truck class="size-5 shrink-0 text-sky-600 dark:text-sky-400" />
							{:else}
								<Box class="text-muted-foreground size-5 shrink-0" />
							{/if}
							<span class="min-w-0">
								<span class="block truncate text-base font-bold">{o.name}</span>
								<span class="text-muted-foreground block truncate text-xs">
									{o.city}{o.driver ? ` · ${o.driver}` : ''} · {KIND_LABEL[o.kind] ?? ''}
								</span>
							</span>
						</span>
						<span class="shrink-0 text-base font-black tabular-nums">
							{formatPrice(o.price)}
						</span>
					</li>
				{/each}
			</ul>
			{#if (mine?.ordersTotal ?? 0) > previewOrders.length}
				<p class="text-muted-foreground border-t px-4 py-2 text-xs font-bold">
					+{(mine?.ordersTotal ?? 0) - previewOrders.length} أخرى — اضغط للقائمة كاملة
				</p>
			{/if}
		{/if}
	</div>
{/if}
</span>

<Dialog bind:open>
	<!-- Read at arm's length, in a hurry, with a driver waiting at the counter —
	     so the sheet is near-fullscreen on a phone and the figures are the biggest
	     thing on it. -->
	<DialogContent
		showCloseButton={false}
		class="inset-0 top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[88vh] sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
	>
		<div class="bg-card flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4 sm:rounded-t-3xl">
			<div class="flex items-center gap-2.5">
				<Truck class="size-7 text-sky-600 dark:text-sky-400" />
				<h2 class="text-2xl font-black">جاهز للتسليم</h2>
			</div>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="apple-press text-muted-foreground hover:text-foreground rounded-full p-2.5"
					aria-label="تحديث"
					onclick={() => {
						haptic(8);
						void load();
					}}
				>
					<RefreshCw class="size-6 {loading ? 'animate-spin' : ''}" />
				</button>
				<button
					type="button"
					class="apple-press text-muted-foreground hover:text-foreground rounded-full p-2.5"
					aria-label="إغلاق"
					onclick={() => (open = false)}
				>
					<X class="size-6" />
				</button>
			</div>
		</div>

		<div class="flex-1 space-y-5 overflow-y-auto p-5">
			{#each counts?.branches ?? [] as b (b.key)}
				{@const shown = isOpen(b.key)}
				<section class="space-y-2.5">
					<!-- The header is the fold control, and carries the branch's figures
					     so a folded branch still answers "how many" at a glance. -->
					<button
						type="button"
						class="apple-press flex w-full items-center justify-between gap-2 rounded-xl px-1 py-1.5 text-start"
						aria-expanded={shown}
						onclick={() => toggle(b.key)}
					>
						<span class="flex min-w-0 items-center gap-2">
							<ChevronDown
								class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 {shown
									? ''
									: '-rotate-90'}"
							/>
							<span class="truncate text-base font-black">{b.label}</span>
							{#if b.key === counts?.myBranch}
								<span class="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-black text-sky-700 dark:text-sky-300">
									فرعك
								</span>
							{/if}
						</span>
						<span class="flex shrink-0 items-center gap-2 text-base font-black tabular-nums">
							<span class="flex items-center gap-1"><Truck class="size-4 opacity-70" />{b.alwaseet.awaitingPickup}</span>
							<span class="opacity-40">·</span>
							<span class="flex items-center gap-1"><Box class="size-4 opacity-70" />{b.alwaseet.toPack}</span>
							{#if b.local.total > 0}
								<span class="opacity-40">·</span>
								<span class="flex items-center gap-1"><Bike class="size-4 opacity-70" />{b.local.total}</span>
							{/if}
						</span>
					</button>

					{#if shown}
						<div class="divide-y overflow-hidden rounded-2xl border">
							{#each sheetRows(b) as row (row.key)}
								{@const rowOpen = openRow === row.key}
								{@const list = ordersFor(b, row.kind, row.driver)}
								<div>
									<button
										type="button"
										class="apple-press flex w-full items-center justify-between gap-3 px-4 py-4 text-start transition-colors {rowOpen
											? 'bg-muted/50'
											: 'hover:bg-muted/30'}"
										aria-expanded={rowOpen}
										disabled={list.length === 0}
										bind:this={driverRowEls[row.key]}
										onclick={() => toggleRow(row.key)}
									>
										<span class="flex min-w-0 items-center gap-2.5">
											{#if row.icon === 'truck'}
												<Truck class="size-6 shrink-0 text-sky-600 dark:text-sky-400" />
											{:else if row.icon === 'box'}
												<Box class="text-muted-foreground size-6 shrink-0" />
											{:else if avatarBroken[row.key]}
												<Bike class="size-6 shrink-0 text-amber-600 dark:text-amber-400" />
											{:else}
												<!-- The driver's own face — the same one the directory
												     and their order card show. -->
												<img
													src={driverAvatar(row.label, row.record?.id)}
													alt=""
													class="bg-muted ring-border size-9 shrink-0 rounded-full ring-2"
													onerror={() => (avatarBroken = { ...avatarBroken, [row.key]: true })}
												/>
											{/if}
											<span
												class="truncate text-lg font-bold {row.kind === 'toPack'
													? 'text-muted-foreground'
													: ''}"
											>
												{row.label}
											</span>
										</span>
										<span class="flex shrink-0 items-center gap-2">
											<span class="text-4xl font-black tabular-nums">{row.count}</span>
											{#if list.length}
												<ChevronDown
													class="text-muted-foreground size-5 transition-transform duration-200 {rowOpen
														? ''
														: '-rotate-90'}"
												/>
											{/if}
										</span>
									</button>

									{#if rowOpen && row.record?.id}
										<!-- Handing over and telling them what they carry is one
										     act; calling them in is the other thing you do at a
										     counter with a driver's name in front of you. -->
										<div class="bg-muted/30 flex items-center gap-2 border-t px-3 py-2.5">
											<Button
												size="sm"
												class="h-11 flex-1 gap-1.5 bg-cyan-600 text-sm font-bold text-white hover:bg-cyan-700"
												onclick={() => askDaySheet(row.record!)}
											>
												<Send class="size-4" /> إرسال قائمة اليوم
											</Button>
											<Button
												size="sm"
												variant="outline"
												class="h-11 gap-1.5 border-amber-500/50 text-sm font-bold text-amber-700 dark:text-amber-300"
												disabled={pagingId === row.record.id}
												onclick={() => pageDriver(row.record!)}
											>
												<BellRing class="size-4" />
												{pagingId === row.record.id ? '…' : 'استدعاء'}
											</Button>
										</div>

									{/if}

									{#if rowOpen && list.length}
										<ul class="bg-muted/30 divide-y border-t">
											{#each list as o (o.submissionId)}
												{@const busy = applying === o.submissionId}
												<li class="px-3 py-2.5">
													<div class="flex items-center justify-between gap-2">
														<button
															type="button"
															class="apple-press flex min-w-0 flex-1 items-center gap-2 text-start"
															onclick={() => openOrder(o)}
														>
															<span class="min-w-0">
																<span class="block truncate text-base font-bold">{o.name}</span>
																<span class="text-muted-foreground block truncate text-xs">
																	<!-- The ref is LTR inside an RTL line; without isolation the
																	     '#' of a uuid ref lands on the wrong end. -->
																	<span class="tabular-nums" dir="ltr" style="unicode-bidi: isolate">
																		{o.label}
																	</span>{o.city ? ` · ${o.city}` : ''}
																</span>
															</span>
														</button>
														<span class="flex shrink-0 items-center gap-2">
															<span class="text-base font-black tabular-nums">
																{formatPrice(o.price)}
															</span>
															{#if row.kind === 'local'}
																<button
																	type="button"
																	class="apple-press text-muted-foreground hover:text-foreground rounded-lg border px-2 py-1 text-xs font-bold"
																	onclick={() =>
																		(stageFor = stageFor === o.submissionId ? null : o.submissionId)}
																	disabled={busy}
																>
																	{busy ? '…' : 'الحالة'}
																</button>
															{/if}
														</span>
													</div>

													{#if row.kind === 'local' && stageFor === o.submissionId}
														<!-- Second tap applies. Four stages, one row, no menu. -->
														<div class="mt-2 grid grid-cols-2 gap-1.5">
															{#each LOCAL_STAGES as st (st.key)}
																<button
																	type="button"
																	class="apple-press rounded-lg border px-1 py-1.5 text-xs font-bold {st.tone}"
																	disabled={busy}
																	onclick={() => applyStage(o, st.key)}
																>
																	{st.label}
																</button>
															{/each}
														</div>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/each}

							{#if b.local.total === 0 && b.alwaseet.toPack + b.alwaseet.awaitingPickup === 0}
								<div class="text-muted-foreground px-4 py-3 text-sm">
									لا شيء بانتظار التسليم في هذا الفرع.
								</div>
							{/if}
						</div>
					{/if}
				</section>
			{/each}

			<p class="text-muted-foreground text-sm leading-relaxed">
				«بانتظار مندوب الوسيط» = طلبات لها ملصق ولم يستلمها مندوب الوسيط — هذه هي التي تُسلَّم عند
				وصوله. الفرع يُحدَّد من حساب الوسيط للطلب، أو من الموظف الذي أرسله.
			</p>
		</div>
	</DialogContent>
</Dialog>

<!-- Day-sheet confirm: the count and the switch, nothing else to read. -->
<Dialog open={daySheetFor !== null} onOpenChange={(v) => { if (!v) daySheetFor = null; }}>
	<DialogContent class="z-[300] max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
		<DialogHeader>
			<DialogTitle class="text-center text-lg font-bold">
				إرسال قائمة اليوم — {daySheetFor?.name ?? ''}
			</DialogTitle>
		</DialogHeader>
		<div class="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-center">
			<div class="text-4xl font-black tabular-nums text-cyan-800 dark:text-cyan-100">
				{daySheetFor?.count ?? 0}
			</div>
			<div class="text-xs font-bold text-cyan-800 dark:text-cyan-200">
				طلبات بانتظاره — ستصله بالعناوين والمبالغ في رسالة واحدة
			</div>
		</div>
		<label class="apple-press flex items-center justify-between gap-3 rounded-xl border p-3">
			<span class="text-sm font-bold">وتحديث الحالة إلى «خرج للتوصيل»</span>
			<input type="checkbox" class="size-5 rounded-md accent-primary" bind:checked={daySheetMarkOut} />
		</label>
		<DialogFooter class="flex-row gap-2">
			<Button variant="outline" class="h-11 flex-1 font-bold" onclick={() => (daySheetFor = null)}>
				إلغاء
			</Button>
			<Button
				class="h-11 flex-1 bg-cyan-600 font-bold text-white hover:bg-cyan-700"
				disabled={daySheetSending}
				onclick={() => void sendDaySheet()}
			>
				{daySheetSending ? '…' : 'إرسال'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<HintPopover
	key="day-sheet"
	anchor={hintAnchor}
	text="افتح صف المندوب هنا لترسل له «قائمة اليوم» — كل طلباته بالعناوين والمبالغ برسالة واحدة — أو «استدعاء» ليحضر إلى المحل."
/>
