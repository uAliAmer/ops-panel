<script lang="ts">
	import { Sheet, SheetContent } from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import WhatsAppIcon from '$lib/components/WhatsAppIcon.svelte';
	import HintPopover from '$lib/components/HintPopover.svelte';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { X, Package, Check, Receipt, Truck, MessageCircle, MessageCircleOff, AlertTriangle, HelpCircle, Hand, Bike, Ban, Plus, Phone, ChevronLeft, ArrowRight, Pencil, Trash2 } from '@lucide/svelte';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import { api, type Order, type OrderItem, type LocalDriver } from '$lib/api';
	import { haptic } from '$lib/utils/haptic';
	import { cn } from '$lib/utils';
	import { resolveImage } from '$lib/utils/image';
	import { whatsappHref } from '$lib/utils/phone';
	import { auth } from '$lib/stores/auth.svelte';
	import ImageViewer from './ImageViewer.svelte';
	import StickerScanner from './StickerScanner.svelte';

	// ERP account the invoice will be created from (per-user assignment).
	const erpAccount = $derived(auth.user?.erpAccount ?? '');

	// Printerless branches bind a preprinted sticker instead of printing a label.
	const printerless = $derived(auth.user?.printerless === true);

	// The Alwaseet carrier account this operator sends under, as a readable branch
	// name. Keys are the account slugs the backend assigns per user.
	const CARRIER_BRANCHES: Record<string, string> = {
		main: 'فرع المول',
		asalet: 'فرع عكد النصارى'
	};
	const carrierBranch = $derived(
		CARRIER_BRANCHES[auth.user?.alwaseetAccount ?? 'main'] ?? 'الوسيط'
	);
	// The validated sticker id for this send; empty until one is scanned/accepted.
	let stickerId = $state('');

	let viewerSrc = $state<string | null>(null);
	// Rect of the tapped thumbnail — the viewer zooms the photo out of it.
	let viewerOrigin = $state<DOMRect | null>(null);

	function openViewer(e: Event, src: string) {
		const host = e.currentTarget as HTMLElement | null;
		const thumb = host?.querySelector('img') ?? host;
		viewerOrigin = thumb?.getBoundingClientRect() ?? null;
		viewerSrc = src;
	}

	type PackItem = OrderItem & { packedQty: number; requiredQty: number };

	type Props = {
		order: Order | null;
		open: boolean;
		/** Set true to open the fulfillment confirm dialog directly, without the
		 *  packing checklist — for orders with no items (nothing to pack). */
		confirmOnly?: boolean;
		onClose: () => void;
		onPacked: () => void;
		/** Toast "عرض" action — jump the list to the history tab where the order landed. */
		onGoToHistory?: () => void;
	};
	let { order, open = $bindable(), confirmOnly = $bindable(false), onClose, onPacked, onGoToHistory }: Props = $props();

	let items = $state<PackItem[]>([]);
	let submitting = $state(false);
	// Which order we've already seeded packing rows for — guards against
	// background refreshes (poll/socket/visibility) wiping in-progress counts.
	let seededFor = $state<string | null>(null);

	// Fulfillment confirm dialog (opens after packing — pick carrier / ERP).
	let confirmOpen = $state(false);
	// How this order leaves: 'carrier' = Alwaseet, 'local' = our own driver (a
	// friend/colleague), 'manual' = fulfilled outside the system.
	let deliveryMode = $state<'carrier' | 'local' | 'manual'>('carrier');
	const opSendCarrier = $derived(deliveryMode === 'carrier');
	const isLocal = $derived(deliveryMode === 'local');
	const manualComplete = $derived(deliveryMode === 'manual');
	// Own-driver delivery is a Baghdad-only option (our drivers are local to it).
	const localAllowed = $derived((order?.cityName || '').includes('بغداد'));
	// Own-driver directory + inline add.
	let localDrivers = $state<LocalDriver[]>([]);
	let selectedDriverId = $state('');
	// The per-order WhatsApp is right when a parcel is added while the driver is
	// out, and noise when three are handed over together — the day sheet carries
	// those. On by default; the operator turns it off for a batch.
	let notifyDriver = $state(true);
	// The customer tracking-link WhatsApp, sent once the order goes to Alwaseet.
	// Off for orders the operator doesn't want the customer contacted about
	// (e.g. a replacement/exchange already confirmed by phone). Defaults to on,
	// unless the order was created with the new-order form's customer-WhatsApp
	// checkbox off (order.customerWaOptOut) — openConfirm() seeds it then.
	let notifyCustomerTracking = $state(true);

	// The hint hangs off the switch itself — see HintPopover. It only appears once
	// a driver is chosen, which is when the switch starts to mean anything.
	let notifyToggleEl = $state<HTMLElement | null>(null);
	const notifyHintAnchor = $derived(isLocal && selectedDriverId ? notifyToggleEl : null);
	let newDriverName = $state('');
	let newDriverPhone = $state('');
	let addingDriver = $state(false);
	// Two real, editable numbers — no placeholder math.
	//   collectVal = what the customer pays (order total, delivery included)
	//   feeVal     = the driver's delivery fee (part of that total)
	// The driver hands us back the rest:  owed = collect − fee.
	// Editing the fee shifts the customer total by the same delta (products kept);
	// editing the customer total sets it directly. openConfirm() seeds both.
	let feeVal = $state(5000);
	let collectVal = $state(0);
	const localOwed = $derived(Math.max(0, collectVal - feeVal));
	// Raise/lower the fee → the customer total moves with it, products unchanged.
	function onFeeInput(raw: string) {
		const nf = Number(raw) || 0;
		collectVal = Math.max(0, collectVal + (nf - feeVal));
		feeVal = nf;
	}
	const localReady = $derived(!isLocal || selectedDriverId !== '');
	// A printerless operator sending to the carrier must bind a sticker first.
	const stickerRequired = $derived(printerless && opSendCarrier);
	// Set true to re-scan when the order already carries a sticker bound at creation.
	let changeSticker = $state(false);
	const stickerReady = $derived(!stickerRequired || stickerId !== '');
	// Alwaseet rejects a COD price that is not a multiple of 250 IQD — block the
	// send here rather than failing at the carrier and stranding the order FAILED.
	const priceInvalid = $derived(opSendCarrier && (Number(order?.price) || 0) % 250 !== 0);
	let opErpInvoice = $state(true);
	let skipMode = $state(false); // true when sending WITHOUT a complete pack

	// A dropship parcel must not leave in a GSTAR bag: its customer belongs to the
	// reseller and must not learn who filled the order. The bag is picked up
	// before a single item is counted, so this gates the checklist rather than
	// reminding afterwards, when the parcel is already sealed in the wrong bag.
	// Keyed on suppressCustomerContact — the dropship lock — because storeName is
	// a display label that renaming must not quietly switch this off.
	let bagGateOpen = $state(false);
	let bagGateAckedFor = $state<string | null>(null);
	// The itemless flow ("إرسال بدون أصناف") never opens the checklist sheet, so
	// the gate has to stand in front of the fulfilment wizard instead and open it
	// once acknowledged. Without this an itemless dropship parcel — which is
	// still a physical parcel needing a plain bag — skipped the rule entirely.
	let bagGateThenConfirm = $state(false);
	// Held shut for three seconds so the bags are actually looked at. A dialog
	// that can be dismissed on reflex is one an operator taps through without
	// reading, which is the whole failure this is meant to prevent.
	const BAG_GATE_SECONDS = 5;
	// Second step: the first tap only asks "متأكد؟". A single button, however long
	// it is held shut, still ends in one reflex tap — this makes the operator
	// answer for the bag rather than dismiss a dialog.
	let bagGateConfirming = $state(false);
	let bagGateSecondsLeft = $state(0);
	let bagGateTimer: ReturnType<typeof setInterval> | null = null;

	function startBagGate() {
		bagGateConfirming = false;
		bagGateSecondsLeft = BAG_GATE_SECONDS;
		if (bagGateTimer) clearInterval(bagGateTimer);
		bagGateTimer = setInterval(() => {
			bagGateSecondsLeft -= 1;
			if (bagGateSecondsLeft <= 0) stopBagGateTimer();
		}, 1000);
		bagGateOpen = true;
	}

	function stopBagGateTimer() {
		if (bagGateTimer) {
			clearInterval(bagGateTimer);
			bagGateTimer = null;
		}
	}

	// Don't leave an interval running if the panel is torn down mid-countdown.
	$effect(() => () => stopBagGateTimer());

	// Two-step confirm wizard: 1 = pick how it leaves, 2 = details for that choice.
	let step = $state<1 | 2>(1);
	// Mini driver sheet, stacked over step 2 of the local flow. editDriverId set ⇒
	// editing an existing driver; null ⇒ adding a new one.
	let addDriverOpen = $state(false);
	let editDriverId = $state<string | null>(null);
	let deletingDriver = $state(false);

	// Long-press state for the deliberately-annoying "skip packing" affordance.
	let holdPct = $state(0);
	let holdTimer: ReturnType<typeof setInterval> | null = null;
	const HOLD_MS = 2000;

	// First-time onboarding overlay (shown once, re-openable via the ? button).
	const HELP_KEY = 'packing_help_seen';
	let showHelp = $state(false);

	$effect(() => {
		if (open && typeof localStorage !== 'undefined' && !localStorage.getItem(HELP_KEY)) {
			showHelp = true;
		}
	});

	function markHelpSeen() {
		try {
			localStorage.setItem(HELP_KEY, '1');
		} catch {
			/* ignore */
		}
	}

	function dismissHelp() {
		showHelp = false;
		markHelpSeen();
	}

	const totalRequired = $derived(items.reduce((s, i) => s + i.requiredQty, 0));
	const totalPacked = $derived(items.reduce((s, i) => s + i.packedQty, 0));
	const progressPct = $derived(totalRequired > 0 ? (totalPacked / totalRequired) * 100 : 0);
	const done = $derived(totalRequired > 0 && totalPacked >= totalRequired);
	// One item → a big image-forward hero card; several → the compact list.
	const singleItem = $derived(items.length === 1);
	// Header progress ring geometry (r = 14).
	const RING_C = 2 * Math.PI * 14;

	$effect(() => {
		if (open && order?.items && order.id !== seededFor) {
			// Seed once when the panel opens for this order. Don't re-run on
			// background order refreshes, or in-progress packed counts reset.
			items = order.items.map((it) => ({
				...it,
				packedQty: 0,
				requiredQty: Number(it.quantity) || 1
			}));
			submitting = false;
			seededFor = order.id;
			if (order.suppressCustomerContact && bagGateAckedFor !== order.id) {
				startBagGate();
			}
		} else if (!open) {
			seededFor = null;
		}
	});

	function ackBagRule() {
		// Belt and braces: the button is disabled, but never let the handler
		// through early if something else reaches it.
		if (bagGateSecondsLeft > 0) return;
		haptic(12);
		bagGateConfirming = true;
	}

	function confirmBagRule() {
		if (bagGateSecondsLeft > 0 || !bagGateConfirming) return;
		haptic([15, 30]);
		bagGateConfirming = false;
		bagGateAckedFor = order?.id ?? null;
		bagGateOpen = false;
		if (bagGateThenConfirm) {
			bagGateThenConfirm = false;
			openConfirm(false);
		}
	}

	// Per parcel, not per session: the next open asks again.
	function resetBagGate() {
		bagGateAckedFor = null;
		bagGateThenConfirm = false;
		bagGateConfirming = false;
		stopBagGateTimer();
		bagGateSecondsLeft = 0;
	}

	function tap(idx: number) {
		const item = items[idx];
		if (item.packedQty >= item.requiredQty) return;
		const nextPacked = item.packedQty + 1;
		const rowCompleted = nextPacked >= item.requiredQty;
		items = items.map((it, i) => (i === idx ? { ...it, packedQty: nextPacked } : it));
		if (rowCompleted) {
			haptic([15, 30]);
		} else {
			haptic(10);
		}
		if (totalPacked + 1 >= totalRequired) haptic([30, 60]);
	}

	function openConfirm(skip: boolean) {
		skipMode = skip;
		step = 1;
		deliveryMode = 'carrier';
		opErpInvoice = true;
		selectedDriverId = '';
		newDriverName = '';
		newDriverPhone = '';
		addDriverOpen = false;
		editDriverId = null;
		// Seed the money: fee defaults to 5,000 and the customer total is the order
		// total (which already includes that delivery).
		feeVal = 5000;
		collectVal = Number(order?.price) || 0;
		// Sticker was already scanned + validated at order creation → pre-fill it so
		// the operator confirms in one tap instead of re-scanning.
		changeSticker = false;
		if (printerless && order?.preStickerId) stickerId = order.preStickerId;
		// The new-order form's "don't WhatsApp this customer" opt-out is only a
		// default here, not a lock — start the toggle off, but the operator can
		// still turn it back on for this send. A dropship order is the lock: that
		// customer belongs to the reseller and hears nothing from us, so the
		// request never carries a true the backend would refuse anyway.
		notifyCustomerTracking = !order?.customerWaOptOut && !order?.suppressCustomerContact;
		confirmOpen = true;
		void loadDrivers();
	}

	// Deterministic cartoon avatar per driver (DiceBear "critters"). Seeded by name
	// so the same driver always gets the same face; id is the fallback seed.
	const driverAvatar = (d: LocalDriver) =>
		`https://api.dicebear.com/10.x/critters/svg?scale=1.22&translateX=0&tags=animation&animationVariant=fast:89,fastest:60,medium:56,none:65,slow:57,slowest:57&seed=${encodeURIComponent(d.name || d.id)}`;

	// Step 1 → step 2. Picking a delivery mode advances immediately (auto-advance).
	function pickDelivery(mode: 'carrier' | 'local' | 'manual') {
		if (mode === 'local' && !localAllowed) return;
		deliveryMode = mode;
		haptic(12);
		step = 2;
	}

	async function loadDrivers() {
		try {
			const res = await api.listLocalDrivers();
			if (res.success) localDrivers = res.data ?? [];
		} catch {
			/* directory is optional; local mode can still add one inline */
		}
	}

	// Open the mini sheet to add a fresh driver.
	function openAddDriver() {
		editDriverId = null;
		newDriverName = '';
		newDriverPhone = '';
		addDriverOpen = true;
	}

	// Open the mini sheet to edit an existing driver.
	function openEditDriver(d: LocalDriver) {
		editDriverId = d.id;
		newDriverName = d.name;
		newDriverPhone = d.phone ?? '';
		addDriverOpen = true;
	}

	// Save the mini sheet — creates a new driver or updates the one being edited.
	async function saveDriver() {
		const name = (newDriverName ?? '').trim();
		if (!name) return;
		const phone = (newDriverPhone ?? '').trim();
		addingDriver = true;
		try {
			const res = editDriverId
				? await api.updateLocalDriver(editDriverId, name, phone)
				: await api.createLocalDriver(name, phone);
			if (res.success && res.data) {
				const d = res.data;
				if (localDrivers.some((x) => x.id === d.id)) {
					localDrivers = localDrivers.map((x) => (x.id === d.id ? { ...x, ...d } : x));
				} else {
					// New driver appended → newest ends up last in the list.
					localDrivers = [...localDrivers, d];
				}
				selectedDriverId = d.id;
				newDriverName = '';
				newDriverPhone = '';
				addDriverOpen = false;
				editDriverId = null;
				haptic(12);
			} else {
				toast.error(res.error ?? 'فشل حفظ المندوب');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			addingDriver = false;
		}
	}

	// Retire the driver being edited (soft delete on the backend).
	async function removeDriver() {
		if (!editDriverId) return;
		deletingDriver = true;
		try {
			const res = await api.deleteLocalDriver(editDriverId);
			if (res.success) {
				const gone = editDriverId;
				localDrivers = localDrivers.filter((x) => x.id !== gone);
				if (selectedDriverId === gone) selectedDriverId = '';
				addDriverOpen = false;
				editDriverId = null;
				haptic([10, 20]);
			} else {
				toast.error(res.error ?? 'فشل حذف المندوب');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			deletingDriver = false;
		}
	}

	// Itemless orders: jump straight to the confirm dialog, no checklist sheet.
	// A dropship one still has to clear the bag rule first — the wizard opens
	// from ackBagRule() instead of here.
	$effect(() => {
		if (confirmOnly && order) {
			confirmOnly = false;
			if (order.suppressCustomerContact && bagGateAckedFor !== order.id) {
				bagGateThenConfirm = true;
				startBagGate();
			} else {
				openConfirm(false);
			}
		}
	});

	// WhatsApp the customer about out-of-stock / damaged items.
	function notifyCustomer() {
		if (!order) return;
		const msg = 'السلام عليكم';
		const url = `${whatsappHref(order.customerPhone)}?text=${encodeURIComponent(msg)}`;
		window.open(url, '_blank');
		haptic(12);
	}

	// Press-and-hold to unlock the skip (no accidental skips).
	function startHold() {
		cancelHold();
		const t0 = Date.now();
		holdTimer = setInterval(() => {
			holdPct = Math.min(100, ((Date.now() - t0) / HOLD_MS) * 100);
			if (holdPct >= 100) {
				cancelHold();
				haptic([20, 40, 20]);
				openConfirm(true);
			}
		}, 30);
	}
	function cancelHold() {
		if (holdTimer) clearInterval(holdTimer);
		holdTimer = null;
		holdPct = 0;
	}


	async function confirmPack() {
		if (!order) return;
		submitting = true;
		const t = toast.loading(
			manualComplete ? 'جاري الإنجاز اليدوي…' : isLocal ? 'جاري التسليم للمندوب المحلي…' : 'جاري التجهيز والإرسال…'
		);
		try {
			const res = await api.pack(order.id, {
				sendToCarrier: opSendCarrier,
				createErpInvoice: opErpInvoice,
				skipped: skipMode,
				// Own-driver delivery — the backend infers no-carrier from this.
				...(isLocal && selectedDriverId
					? {
							localDriverId: selectedDriverId,
							localDeliveryFee: feeVal || 5000,
							// Customer total the driver collects; backend owes-us = this − fee.
							localTotalPrice: collectVal,
							notifyDriver
						}
					: {}),
				// Only meaningful for a printerless carrier send; the backend
				// re-checks the flag and re-validates the label before binding.
				...(stickerRequired && stickerId ? { stickerQrId: stickerId } : {}),
				// Silence the customer tracking-link WhatsApp for a carrier send.
				...(opSendCarrier ? { notifyCustomer: notifyCustomerTracking } : {})
			});
			if (res.success) {
				const tracking = (res.data as { trackingNumber?: string } | undefined)?.trackingNumber;
				// Remind the operator which physical sticker to stick on the parcel.
				const boundSticker = stickerRequired && stickerId ? stickerId : '';
				const driverName = localDrivers.find((d) => d.id === selectedDriverId)?.name || '';
				const base = manualComplete
					? 'تم الإنجاز يدوياً'
					: isLocal
						? `تم التسليم للمندوب المحلي${driverName ? ` — ${driverName}` : ''}`
						: boundSticker
							? `تم — الصق الملصق رقم ${boundSticker} على الطلب`
							: tracking
								? `تم — تتبع: ${tracking}`
								: 'تم تجهيز الطلب';
				const withErp = opErpInvoice ? `${base} — الفاتورة قيد الإنشاء بالخلفية` : base;
				toast.success(`${withErp} — انتقل الطلب إلى «سابقة»`, {
					id: t,
					duration: boundSticker ? 8000 : undefined,
					action: { label: 'عرض', onClick: () => onGoToHistory?.() }
				});
				stickerId = '';
				confirmOpen = false;
				onClose();
				onPacked();
			} else {
				toast.error(res.error ?? 'فشل التجهيز', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			submitting = false;
		}
	}
</script>

<Sheet bind:open onOpenChange={(v) => { if (!v) { resetBagGate(); onClose(); } }}>
	<SheetContent
		side="bottom"
		class="h-[100dvh] max-h-[100dvh] gap-0 p-0 sm:max-w-full"
		showCloseButton={false}
	>
		<div class="bg-card flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
			<div class="flex items-center gap-2.5">
				<!-- Progress ring: fills as items are packed, turns green when done -->
				<div class="relative flex size-9 shrink-0 items-center justify-center">
					<svg viewBox="0 0 32 32" class="size-9 -rotate-90">
						<circle cx="16" cy="16" r="14" fill="none" class="text-muted" stroke="currentColor" stroke-width="3" />
						<circle
							cx="16" cy="16" r="14" fill="none"
							class={done ? 'text-emerald-500' : 'text-primary'}
							stroke="currentColor" stroke-width="3" stroke-linecap="round"
							stroke-dasharray={RING_C}
							stroke-dashoffset={RING_C * (1 - progressPct / 100)}
							style="transition: stroke-dashoffset 0.3s ease"
						/>
					</svg>
					<span class="absolute text-[9px] font-bold tabular-nums">{totalPacked}/{totalRequired}</span>
				</div>
				<div class="min-w-0">
					<h2 class="font-semibold leading-tight">تجهيز الطلب</h2>
					{#if order}
						<span class="text-muted-foreground text-xs">#{(order.submissionId || '').slice(0, 8)}</span>
					{/if}
				</div>
			</div>
			<div class="flex items-center">
				<Button variant="ghost" size="icon" onclick={() => (showHelp = true)} aria-label="شرح">
					<HelpCircle class="size-5" />
				</Button>
				<Button variant="ghost" size="icon" onclick={onClose} aria-label="إغلاق">
					<X class="size-5" />
				</Button>
			</div>
		</div>

		<div class={cn('flex-1 overflow-y-auto', singleItem ? 'flex flex-col p-4 sm:mx-auto sm:w-full sm:max-w-md' : 'space-y-2 p-3')}>
			{#if singleItem}
				{@const item = items[0]}
				{@const isPacked = item.packedQty >= item.requiredQty}
				{@const imgSrc = resolveImage(item.imageUrl)}
				<!-- Single-item HERO: big photo, name, and a giant tap-to-pack counter. -->
				<div
					role="button"
					tabindex="0"
					class={cn(
						'apple-press flex flex-1 flex-col overflow-hidden rounded-2xl border-2 text-center transition-all duration-200',
						'sm:my-auto sm:max-h-[32rem] sm:flex-none sm:h-[32rem]',
						isPacked ? 'border-emerald-500 bg-emerald-500/5' : 'cursor-pointer border-border active:bg-accent/40'
					)}
					onclick={() => tap(0)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(0); } }}
				>
					<!-- Photo (tap the image to zoom; never packs) -->
					<button
						type="button"
						onclick={(e) => { e.stopPropagation(); if (imgSrc) openViewer(e, imgSrc); }}
						aria-label="عرض الصورة"
						class={cn(
							'bg-muted relative flex min-h-0 flex-1 items-center justify-center overflow-hidden',
							imgSrc ? 'cursor-zoom-in' : 'cursor-default'
						)}
					>
						{#if imgSrc}
							<img src={imgSrc} alt="" class="size-full object-contain" />
						{:else}
							<Package class="text-muted-foreground size-20" />
						{/if}
						{#if isPacked}
							<div class="absolute end-3 top-3 flex size-9 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md animate-pop-in">
								<Check class="size-5" />
							</div>
						{/if}
					</button>
					<!-- Info + big counter -->
					<div class="shrink-0 space-y-2 p-4">
						<div>
							<div class="text-base font-bold leading-snug">{item.name || item.sku || 'منتج'}</div>
							<div class="text-muted-foreground text-xs">{item.sku || '-'}</div>
						</div>
						<div
							class={cn(
								'mx-auto w-fit rounded-xl px-6 py-2 font-mono text-2xl font-extrabold tabular-nums transition-all duration-150',
								isPacked ? 'bg-emerald-500 text-white shadow-xs' : 'bg-muted'
							)}
						>
							{item.packedQty} / {item.requiredQty}
						</div>
						{#if !isPacked}
							<p class="text-muted-foreground text-xs">اضغط للتجهيز</p>
						{/if}
					</div>
				</div>
			{:else}
				{#each items as item, idx (idx)}
					{@const isPacked = item.packedQty >= item.requiredQty}
					{@const isPartial = item.packedQty > 0 && !isPacked}
					{@const imgSrc = resolveImage(item.imageUrl)}
					<!-- Tapping the row packs the item. Tap the thumbnail to open the image. -->
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div
						class={cn(
							'apple-press relative flex w-full items-center gap-3 overflow-hidden rounded-xl border-2 p-3 text-right transition-all duration-200',
							isPacked && 'border-emerald-500 bg-emerald-500/10 shadow-xs',
							isPartial && 'border-amber-500 bg-amber-500/10',
							!isPacked && !isPartial && 'border-border',
							!isPacked && 'cursor-pointer active:bg-accent/60'
						)}
						onclick={() => tap(idx)}
					>
						<!-- Per-row spring progress fill bar -->
						<div
							class="pointer-events-none absolute inset-y-0 start-0 bg-emerald-500/15 transition-all duration-300 ease-out"
							style:width="{(item.packedQty / item.requiredQty) * 100}%"
						></div>
						<!-- Thumbnail: tap to view the image, never packs -->
						<button
							type="button"
							onclick={(e) => { e.stopPropagation(); if (imgSrc) openViewer(e, imgSrc); }}
							aria-label="عرض الصورة"
							class={cn(
								'bg-muted relative z-10 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md',
								imgSrc ? 'cursor-zoom-in' : 'cursor-default'
							)}
						>
							{#if imgSrc}
								<img src={imgSrc} alt="" class="size-full object-cover" />
							{:else}
								<Package class="text-muted-foreground size-6" />
							{/if}
						</button>
						<div class="relative z-10 min-w-0 flex-1">
							<div class="truncate text-sm font-medium">{item.name || item.sku || 'منتج'}</div>
							<div class="text-muted-foreground truncate text-xs">{item.sku || '-'}</div>
						</div>
						<!-- Counter -->
						<div
							class={cn(
								'relative z-10 shrink-0 rounded-md px-3 py-2 font-mono text-sm tabular-nums transition-all duration-150',
								isPacked ? 'bg-emerald-500 text-white animate-pop-in shadow-xs' : 'bg-muted'
							)}
						>
							{item.packedQty} / {item.requiredQty}
						</div>
						<!-- Round status check -->
						<div class={cn(
							'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
							isPacked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-muted-foreground/30'
						)}>
							{#if isPacked}<Check class="size-3.5" />{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<div
			class="bg-card shrink-0 space-y-2 border-t px-4 pt-3"
			style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));"
		>
			<!-- Out-of-stock / damaged: contact the customer on WhatsApp -->
			<Button
				variant="outline"
				class="h-11 w-full gap-2 border-2 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
				onclick={notifyCustomer}
			>
				<MessageCircle class="size-5" /> إبلاغ الزبون (نقص / تلف)
			</Button>

			<Button
				class="h-12 w-full bg-emerald-600 text-base text-white hover:bg-emerald-700"
				disabled={!done || submitting}
				onclick={() => openConfirm(false)}
			>
				<Check /> تحديد كـ مجهز
			</Button>

			{#if !done}
				<!-- Deliberately annoying skip: press and hold to unlock -->
				<button
					type="button"
					class="relative w-full overflow-hidden rounded-md py-2 text-center text-xs font-medium text-muted-foreground select-none"
					onpointerdown={startHold}
					onpointerup={cancelHold}
					onpointerleave={cancelHold}
					onpointercancel={cancelHold}
				>
					<span
						class="absolute inset-y-0 right-0 bg-rose-500/20"
						style:width="{holdPct}%"
					></span>
					<span class="relative">استمر بالضغط لتخطّي التجهيز والإرسال…</span>
				</button>
			{/if}
		</div>
	</SheetContent>
</Sheet>

<!-- The two real GSTAR bags, drawn rather than photographed: an SVG stays sharp
     on a phone, carries no asset to ship, and reads in both themes. `clear` is
     the frosted bag with the red mark, `red` the solid one with the white mark,
     `plain` the unbranded bag that dropship parcels must go in. -->
{#snippet bagArt(kind: 'clear' | 'red' | 'plain' | 'carton')}
	{@const ink = kind === 'red' ? '#FCE9E9' : '#D8232A'}
	{@const banned = kind === 'clear' || kind === 'red'}
	<svg viewBox="0 0 64 86" class="h-[88px] w-auto sm:h-[132px]" aria-hidden="true">
		{#if kind === 'carton'}
			<!-- Flat, not isometric: at this size an iso box turns to mush. -->
			<rect x="6" y="30" width="52" height="46" rx="2" fill="#C8A268" stroke="#A07B45" stroke-width="1.5" />
			<rect x="6" y="18" width="52" height="12" rx="2" fill="#D8B77E" stroke="#A07B45" stroke-width="1.5" />
			<path d="M32 18 V30" stroke="#A07B45" stroke-width="1.5" />
			<rect x="3" y="26" width="58" height="7" rx="1.5" fill="#EBD9B8" opacity="0.85" stroke="#C6AE86" stroke-width="1" />
		{:else}
			<rect
				x="5" y="12" width="54" height="66" rx="3"
				fill={kind === 'red' ? '#D8232A' : kind === 'clear' ? '#F4F1ED' : '#E8E3DC'}
				stroke={kind === 'red' ? '#B31B21' : '#CBC4BC'}
				stroke-width="1.5"
			/>
			<!-- die-cut handle slot -->
			<rect x="24" y="16" width="16" height="5" rx="2.5" fill={kind === 'red' ? '#AE181E' : '#D6CFC7'} />
		{/if}
		{#if banned}
			<!-- The G: the crossbar's top edge sits on the ring's centre line and its
			     right end IS the arc's terminal, so bar and lower arc read as one
			     hook; the mouth is the wedge left between that bar and the top arm.
			     Drawn as an arc, not a dashed circle, so the mouth lands exactly
			     where the bar meets the ring. Two earlier tries got this wrong: a bar
			     at mid-height makes the mark read as an 'e', and a mouth that stops
			     short of the bar leaves a stub of ring that reads as a tongue.
			     The sparkle rides in the bowl just left of the bar's inner end. -->
			<path d="M43.74 44.5 A12 12 0 1 1 41.83 35.12" fill="none" stroke={ink} stroke-width="5" />
			<path d="M32.5 44.5 H43.74" stroke={ink} stroke-width="5" />
			<path
				d="M30.8 32.8 Q31.9 37.2 37.4 38.3 Q31.9 39.4 30.8 44.8 Q29.7 39.4 24.2 38.3 Q29.7 37.2 30.8 32.8 z"
				fill={ink}
			/>
			<text
				x="32" y="63" text-anchor="middle" font-size="8" font-weight="700"
				letter-spacing="0.6" fill={ink} font-family="system-ui, sans-serif"
			>GSTAR</text>
			<!-- A slash badge, not an X over the whole bag: the operator has to be able
			     to still recognise WHICH bag is being refused. -->
			<circle cx="49" cy="73" r="9.5" fill="#DC2626" stroke="#fff" stroke-width="2" />
			<circle cx="49" cy="73" r="4.8" fill="none" stroke="#fff" stroke-width="2.1" />
			<line x1="45.6" y1="76.4" x2="52.4" y2="69.6" stroke="#fff" stroke-width="2.1" stroke-linecap="round" />
		{:else}
			<circle cx="49" cy="73" r="9.5" fill="#16A34A" stroke="#fff" stroke-width="2" />
			<path d="M44.9 73 l2.8 2.8 5.2 -5.7" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
		{/if}
	</svg>
{/snippet}

<!-- Not skippable, deliberately: no close button, escape and outside taps
     ignored. The one way out is the acknowledgement. -->
<Dialog bind:open={bagGateOpen}>
	<DialogContent
		showCloseButton={false}
		escapeKeydownBehavior="ignore"
		interactOutsideBehavior="ignore"
		class="max-w-[23rem] gap-3 border-amber-500/40 p-4 sm:max-w-xl sm:gap-4 sm:p-6"
	>
		<DialogHeader class="gap-1.5">
			<DialogTitle class="flex items-center gap-2 text-base font-extrabold text-amber-700 sm:text-xl dark:text-amber-400">
				<Ban class="size-5 shrink-0 sm:size-6" />
				طلب دروبشيبنغ — كيس سادة فقط
			</DialogTitle>
		</DialogHeader>

		<div class="flex items-end justify-center gap-1.5 sm:gap-4">
			{#each [
				{ kind: 'clear' as const, label: 'ممنوع', bad: true },
				{ kind: 'red' as const, label: 'ممنوع', bad: true },
				{ kind: 'plain' as const, label: 'مسموح', bad: false },
				{ kind: 'carton' as const, label: 'مسموح', bad: false }
			] as opt (opt.kind)}
				<div class="flex flex-col items-center gap-1">
					{@render bagArt(opt.kind)}
					<span
						class={cn(
							'text-[11px] font-bold sm:text-sm',
							opt.bad
								? 'text-rose-600 dark:text-rose-400'
								: 'text-emerald-600 dark:text-emerald-400'
						)}>{opt.label}</span>
				</div>
			{/each}
		</div>

		<p class="text-sm leading-relaxed font-semibold sm:text-base">
			زبون هذا الطلب يخص الموزع{order?.resellerName ? ` ${order.resellerName}` : ''} ويجب ألّا يعرف من أين جاءت البضاعة.
			استخدم كيساً سادة أو كارتوناً بلا أي علامة، ولا تضع أي ورقة أو فاتورة تحمل اسم المحل.
		</p>

		<DialogFooter class="flex-col gap-2 sm:flex-col">
			{#if bagGateConfirming}
				<p class="w-full text-center text-sm font-extrabold sm:text-base">
					متأكد؟ الطلب سيخرج بكيس سادة أو كارتون بلا أي علامة.
				</p>
				<div class="flex w-full gap-2">
					<Button
						variant="outline"
						class="h-11 flex-1 text-sm font-bold sm:h-12 sm:text-base"
						onclick={() => { haptic(10); bagGateConfirming = false; }}
					>
						رجوع
					</Button>
					<Button
						class="h-11 flex-1 text-sm font-bold sm:h-12 sm:text-base"
						onclick={confirmBagRule}
					>
						<Check class="size-4" /> نعم، متأكد
					</Button>
				</div>
			{:else}
				<!-- Drains over the three seconds. The transition is 1s linear so it
				     glides between ticks instead of stepping once a second. -->
				<div class="bg-muted h-1 w-full overflow-hidden rounded-full">
					<div
						class="h-full rounded-full bg-amber-500"
						style="width: {(bagGateSecondsLeft / BAG_GATE_SECONDS) * 100}%; transition: width 1s linear"
					></div>
				</div>
				<Button
					class="h-11 w-full text-sm font-bold sm:h-12 sm:text-base"
					disabled={bagGateSecondsLeft > 0}
					onclick={ackBagRule}
				>
					{#if bagGateSecondsLeft > 0}
						<span class="tabular-nums">{bagGateSecondsLeft}</span> انظر إلى الصور…
					{:else}
						<Check class="size-4" /> فهمت — سأستخدم كيساً سادة
					{/if}
				</Button>
			{/if}
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Fulfillment confirm: full-screen two-step wizard.
     Step 1 = how the order leaves (auto-advances on pick).
     Step 2 = details for that choice + ERP invoice + confirm. -->
<Dialog bind:open={confirmOpen} onOpenChange={(v) => { if (!v) resetBagGate(); }}>
	<DialogContent
		showCloseButton={false}
		class="inset-0 top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 ring-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[92vh] sm:min-h-[34rem] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
	>
		<!-- Header: back (step 2) + title + order summary + close -->
		<div class="bg-card flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3 sm:rounded-t-3xl">
			<div class="flex min-w-0 items-center gap-2">
				{#if step === 2}
					<Button variant="ghost" size="icon" class="shrink-0" onclick={() => { haptic(10); step = 1; }} aria-label="رجوع">
						<ArrowRight class="size-5" />
					</Button>
				{/if}
				<div class="min-w-0">
					<h2 class="truncate font-bold lg:text-lg">{skipMode ? 'إرسال بدون تجهيز كامل' : 'تأكيد التجهيز'}</h2>
					<p class="text-muted-foreground truncate text-xs lg:text-sm">
						{order?.customerName || '-'} · {order?.cityName || '-'} · {(Number(order?.price) || 0).toLocaleString()} د.ع
					</p>
				</div>
			</div>
			<Button variant="ghost" size="icon" class="shrink-0" onclick={() => { stickerId = ''; confirmOpen = false; }} aria-label="إغلاق">
				<X class="size-5" />
			</Button>
		</div>

		<!-- Step dots -->
		<div class="bg-card flex shrink-0 items-center justify-center gap-2 border-b py-2.5">
			<span class={cn('h-2 rounded-full transition-all duration-300', step === 1 ? 'bg-primary w-7' : 'bg-muted w-2')}></span>
			<span class={cn('h-2 rounded-full transition-all duration-300', step === 2 ? 'bg-primary w-7' : 'bg-muted w-2')}></span>
		</div>

		<div class="flex-1 overflow-y-auto px-4 py-4 sm:py-5">
			<div class="mx-auto w-full max-w-md sm:max-w-none">
				{#if step === 1}
					<!-- STEP 1 — how does it leave -->
					{#if skipMode}
						<p class="mb-4 flex items-center justify-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-2 text-center text-sm font-semibold text-rose-600 lg:text-base dark:text-rose-400">
							<AlertTriangle class="size-4" /> لم يكتمل تجهيز كل القطع
						</p>
					{/if}
					<p class="mb-5 text-center text-lg font-bold lg:mb-7 lg:text-2xl">كيف يخرج الطلب؟</p>
					<div class="space-y-3 lg:space-y-4">
						<!-- Carrier -->
						<button
							type="button"
							onclick={() => pickDelivery('carrier')}
							class={cn(
								'flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-right transition-all active:scale-[0.99] lg:gap-5 lg:p-6',
								opSendCarrier ? 'border-primary bg-primary/10' : 'border-border'
							)}
						>
							<div class="bg-primary/15 text-primary flex size-14 lg:size-20 shrink-0 items-center justify-center rounded-xl">
								<Truck class="size-7 lg:size-10" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="text-base font-bold lg:text-xl">الوسيط</div>
								<div class="text-muted-foreground text-xs">{carrierBranch}</div>
							</div>
							<ChevronLeft class="text-muted-foreground size-5 shrink-0 lg:size-6" />
						</button>

						<!-- Local driver (Baghdad only) -->
						{#if localAllowed}
							<button
								type="button"
								onclick={() => pickDelivery('local')}
								class={cn(
									'flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-right transition-all active:scale-[0.99] lg:gap-5 lg:p-6',
									isLocal ? 'border-primary bg-primary/10' : 'border-border'
								)}
							>
								<div class="flex size-14 lg:size-20 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
									<Bike class="size-7 lg:size-10" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="text-base font-bold lg:text-xl">مندوب محلي</div>
									<div class="text-muted-foreground text-xs">توصيل بمندوبنا داخل بغداد</div>
								</div>
								<ChevronLeft class="text-muted-foreground size-5 shrink-0 lg:size-6" />
							</button>
						{/if}

						<!-- Manual (no carrier) -->
						<button
							type="button"
							onclick={() => pickDelivery('manual')}
							class={cn(
								'flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-right transition-all active:scale-[0.99] lg:gap-5 lg:p-6',
								manualComplete ? 'border-primary bg-primary/10' : 'border-border'
							)}
						>
							<div class="flex size-14 lg:size-20 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400">
								<Ban class="size-7 lg:size-10" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="text-base font-bold lg:text-xl">بدون وسيط</div>
								<div class="text-muted-foreground text-xs">مُنجز يدوياً / في فرع آخر</div>
							</div>
							<ChevronLeft class="text-muted-foreground size-5 shrink-0 lg:size-6" />
						</button>
					</div>
				{:else}
					<!-- STEP 2 — details for the chosen mode -->
					<div class="space-y-3">
						{#if opSendCarrier}
							<div class="flex items-center gap-3 rounded-2xl border bg-muted/30 p-4">
								<div class="bg-primary/15 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
									<Truck class="size-6" />
								</div>
								<div>
									<div class="font-bold">الوسيط</div>
									<div class="text-muted-foreground text-xs">{carrierBranch}</div>
								</div>
							</div>

							{#if priceInvalid}
								<p class="flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-center text-xs font-bold text-rose-700 dark:text-rose-300">
									<AlertTriangle class="size-3.5 shrink-0" />
									السعر ({(Number(order?.price) || 0).toLocaleString()}) غير صالح — يجب أن يكون من مضاعفات 250. عدّل السعر قبل الإرسال.
								</p>
							{/if}

							{#if stickerRequired}
								<div class="space-y-2 rounded-2xl border bg-muted/30 p-4">
									<p class="text-center text-sm font-semibold">الملصق المطبوع مسبقاً</p>
									{#if order?.preStickerId && !changeSticker}
										<div class="flex flex-col items-center gap-1 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-4">
											<div class="flex size-11 items-center justify-center rounded-full bg-emerald-500 text-white">
												<Check class="size-6" />
											</div>
											<span class="text-lg font-extrabold tabular-nums" dir="ltr">{order.preStickerId}</span>
											<span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">مربوط مسبقاً — جاهز للإرسال</span>
											<button
												type="button"
												class="text-muted-foreground mt-1 text-[11px] underline"
												onclick={() => { changeSticker = true; stickerId = ''; }}
											>
												مسح ملصق آخر
											</button>
										</div>
									{:else}
										<StickerScanner onValid={(id) => (stickerId = id)} onReset={() => (stickerId = '')} />
									{/if}
									{#if stickerId}
										<p class="flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-amber-600 dark:text-amber-400">
											<AlertTriangle class="size-3.5" /> لا يمكن التراجع — سيُربط الطلب بهذا الملصق نهائياً
										</p>
									{/if}
								</div>
							{/if}

							<!-- The customer tracking link. Off when the customer already
							     knows what's coming (a confirmed exchange/replacement) and
							     a fresh tracking message would only confuse them.
							
							     Absent entirely on a dropship order: that customer is the
							     reseller's and hears nothing from us. notificationService
							     refuses the send regardless, so offering the toggle only
							     promised a message that was never going to arrive. The fact
							     replaces the control rather than leaving a gap, because a
							     missing toggle reads as a bug. -->
							{#if order?.suppressCustomerContact}
								<div class="flex w-full items-center gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-400/10 p-3 text-right">
									<MessageCircleOff class="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
									<span class="min-w-0 flex-1">
										<span class="block text-sm font-bold text-amber-700 dark:text-amber-300">
											لا يُشعَر الزبون
										</span>
										<span class="block text-[11px] text-amber-700/80 dark:text-amber-400/80">
											طلب دروبشيب — الزبون يخص الموزع، وهو من يتابع الطلب معه
										</span>
									</span>
								</div>
							{:else}
							<button
								type="button"
								onclick={() => (notifyCustomerTracking = !notifyCustomerTracking)}
								class={cn(
									'flex w-full items-center gap-2.5 rounded-2xl border p-3 text-right transition-colors',
									notifyCustomerTracking ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border bg-muted/40'
								)}
							>
								<WhatsAppIcon class="size-5 shrink-0" />
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-bold">إشعار الزبون برابط التتبع</span>
									<span class="text-muted-foreground block text-[11px]">
										{notifyCustomerTracking ? 'سيصله رابط تتبع الطلب' : 'لن تُرسل له أي رسالة'}
									</span>
								</span>

								<span class={cn(
									'relative h-6 w-11 shrink-0 rounded-full transition-colors',
									notifyCustomerTracking ? 'bg-emerald-500' : 'bg-muted-foreground/30'
								)}>
									<span class={cn(
										'absolute top-0.5 size-5 rounded-full bg-white transition-all',
										notifyCustomerTracking ? 'start-0.5' : 'start-[1.375rem]'
									)}></span>
								</span>
							</button>
							{/if}
						{:else if manualComplete}
							<div class="flex items-center gap-3 rounded-2xl border bg-teal-500/10 p-4">
								<div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/20 text-teal-600 dark:text-teal-400">
									<Ban class="size-6" />
								</div>
								<div>
									<div class="font-bold text-teal-700 dark:text-teal-400">بدون وسيط</div>
									<div class="text-xs text-teal-700/80 dark:text-teal-400/80">سيُحدَّد الطلب كـ «مكتمل يدوياً» (مُنجز في فرع آخر)</div>
								</div>
							</div>
						{:else if isLocal}
							<!-- Own-driver delivery: pick a driver (add via the mini sheet). -->
							<div class="space-y-2.5 rounded-2xl border bg-muted/30 p-3 lg:p-4">
								<div class="flex items-center justify-between">
									<p class="text-sm font-semibold lg:text-base">اختر المندوب المحلي</p>
									<span class="text-muted-foreground text-[11px] tabular-nums lg:text-xs">{localDrivers.length} مندوب</span>
								</div>
								<!-- Card grid is the only flexible region: it scrolls on its own so
								     the fee / money / ERP / confirm below stay on-screen even on
								     short, DPI-scaled displays. -->
								<div class="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto pe-0.5 sm:grid-cols-4 lg:max-h-72 lg:grid-cols-5 lg:gap-3">
									{#each localDrivers as d (d.id)}
										{@const active = selectedDriverId === d.id}
										<div class="group relative">
											<button
												type="button"
												onclick={() => (selectedDriverId = d.id)}
												class={cn(
													'flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 p-2.5 text-center transition-all active:scale-[0.97] lg:p-3',
													active ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'
												)}
											>
												{#if active}
													<div class="bg-primary absolute end-1.5 top-1.5 flex size-5 items-center justify-center rounded-full text-white shadow-sm lg:size-6">
														<Check class="size-3 lg:size-3.5" />
													</div>
												{/if}
												<img
													src={driverAvatar(d)}
													alt=""
													loading="lazy"
													class={cn(
														'bg-muted size-12 rounded-full ring-2 lg:size-16',
														active ? 'ring-primary' : 'ring-border'
													)}
												/>
												<div class="w-full min-w-0">
													<div class="truncate text-xs font-bold lg:text-sm">{d.name}</div>
													{#if d.phone}
														<div class="text-muted-foreground truncate text-[10px] tabular-nums lg:text-xs" dir="ltr">{d.phone}</div>
													{/if}
												</div>
												{#if d.outstanding}
													<span class="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 tabular-nums lg:text-[10px] dark:text-amber-400">
														بذمته {d.outstanding.toLocaleString()}
													</span>
												{/if}
											</button>
											<!-- Edit: always visible on touch, on hover for pointer devices. -->
											<button
												type="button"
												onclick={() => openEditDriver(d)}
												aria-label="تعديل المندوب"
												class="bg-card text-muted-foreground hover:text-foreground absolute start-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border shadow-sm transition-opacity lg:size-7 lg:opacity-0 lg:group-hover:opacity-100"
											>
												<Pencil class="size-3 lg:size-3.5" />
											</button>
										</div>
									{/each}
									<!-- Add-new card opens the mini sheet -->
									<button
										type="button"
										onclick={openAddDriver}
										class="border-primary/40 text-primary hover:bg-primary/10 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed p-2.5 text-center transition-colors lg:p-3"
									>
										<div class="border-primary/40 flex size-12 items-center justify-center rounded-full border-2 border-dashed lg:size-16">
											<Plus class="size-6 lg:size-7" />
										</div>
										<span class="text-xs font-bold lg:text-sm">مندوب جديد</span>
									</button>
								</div>

								<!-- Money: two input tiles (customer total | delivery fee) with the
								     driver-owes-us result below them. -->
								<div class="space-y-2">
									<div class="grid grid-cols-2 gap-2">
										<!-- Customer total -->
										<div class="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 p-3 text-center">
											<div class="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">يُحصّل من الزبون</div>
											<div class="mt-1.5 flex items-center justify-center gap-1">
												<Input
													value={collectVal}
													oninput={(e) => (collectVal = Number(e.currentTarget.value) || 0)}
													type="number"
													inputmode="numeric"
													class="h-11 w-full border-emerald-500/40 bg-card text-center text-lg font-extrabold tabular-nums"
												/>
											</div>
											<div class="mt-1 text-[9px] text-emerald-700/70 dark:text-emerald-400/70">شامل التوصيل · د.ع</div>
										</div>
										<!-- Delivery fee -->
										<div class="rounded-2xl border-2 border-border bg-card p-3 text-center">
											<div class="flex items-center justify-center gap-1 text-[11px] font-bold"><Bike class="size-3.5" /> أجور التوصيل</div>
											<div class="mt-1.5">
												<Input
													value={feeVal}
													oninput={(e) => onFeeInput(e.currentTarget.value)}
													type="number"
													inputmode="numeric"
													class="h-11 w-full text-center text-lg font-extrabold tabular-nums"
												/>
											</div>
											<div class="text-muted-foreground mt-1 text-[9px]">يحتفظ بها المندوب · د.ع</div>
										</div>
									</div>
									<!-- Result: what the driver hands back to us -->
									<div class="flex items-center justify-center gap-2 rounded-2xl bg-muted/50 px-3 py-2.5">
										<Check class="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
										<span class="text-muted-foreground text-xs font-semibold">يورده المندوب لنا</span>
										<span class="text-base font-extrabold tabular-nums" dir="ltr">{localOwed.toLocaleString()} <span class="text-muted-foreground text-[10px]">د.ع</span></span>
									</div>
								</div>
								<!-- The immediate ping. Off when the parcels are going out
								     together — «إرسال قائمة اليوم» from «جاهز للتسليم» then
								     carries them all in one message. -->
								<button
									type="button"
									bind:this={notifyToggleEl}
									onclick={() => (notifyDriver = !notifyDriver)}
									class={cn(
										'flex w-full items-center gap-2.5 rounded-2xl border p-3 text-right transition-colors',
										notifyDriver ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border bg-muted/40'
									)}
								>
									<WhatsAppIcon class="size-5 shrink-0" />
									<span class="min-w-0 flex-1">
										<span class="block text-sm font-bold">إشعار المندوب الآن</span>
										<span class="text-muted-foreground block text-[11px]">
											{notifyDriver ? 'ستصله رسالة بهذا الطلب' : 'لن تصله رسالة — ستُرسل ضمن قائمة اليوم'}
										</span>
									</span>

									<span class={cn(
										'relative h-6 w-11 shrink-0 rounded-full transition-colors',
										notifyDriver ? 'bg-emerald-500' : 'bg-muted-foreground/30'
									)}>
										<span class={cn(
											'absolute top-0.5 size-5 rounded-full bg-white transition-all',
											notifyDriver ? 'start-0.5' : 'start-[1.375rem]'
										)}></span>
									</span>
								</button>

								{#if !localReady}
									<p class="text-center text-[11px] font-medium text-amber-600 dark:text-amber-400">اختر مندوباً أو أضف واحداً للمتابعة</p>
								{/if}
							</div>
						{/if}

						<!-- ERP invoice — big toggle card, on by default -->
						<button
							type="button"
							onclick={() => (opErpInvoice = !opErpInvoice)}
							class={cn(
								'flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-right transition-colors lg:gap-4 lg:p-5',
								opErpInvoice ? 'border-emerald-500 bg-emerald-500/10' : 'border-border'
							)}
						>
							<div class={cn(
								'flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors lg:size-14',
								opErpInvoice ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
							)}>
								<Receipt class="size-6 lg:size-7" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="font-bold lg:text-lg">فاتورة ERP</div>
								<div class="text-muted-foreground text-xs lg:text-sm">
									{opErpInvoice ? 'ستُنشأ تلقائياً' : 'لن تُنشأ'}{erpAccount ? ` · ${erpAccount}` : ''}
								</div>
							</div>
							<!-- toggle pill -->
							<div class={cn(
								'relative h-6 w-11 shrink-0 rounded-full transition-colors',
								opErpInvoice ? 'bg-emerald-500' : 'bg-muted-foreground/30'
							)}>
								<span class={cn(
									'absolute top-0.5 size-5 rounded-full bg-white shadow-xs transition-all',
									opErpInvoice ? 'end-0.5' : 'start-0.5'
								)}></span>
							</div>
						</button>
					</div>
				{/if}
			</div>
		</div>

		<!-- Footer: back + confirm sit together (short pointer travel) -->
		<div
			class="bg-card shrink-0 border-t p-4 sm:rounded-b-3xl"
			style="padding-bottom: max(1rem, env(safe-area-inset-bottom));"
		>
			{#if step === 2}
				<div class="mx-auto flex w-full max-w-xl gap-2">
					<Button
						variant="outline"
						class="h-14 shrink-0 gap-1.5 px-5 text-base font-bold lg:h-16"
						onclick={() => { haptic(10); step = 1; }}
						disabled={submitting}
					>
						<ArrowRight class="size-5" /> رجوع
					</Button>
					<Button
						class={cn(
							'h-14 flex-1 text-base font-bold text-white lg:h-16 lg:text-lg',
							manualComplete ? 'bg-teal-600 hover:bg-teal-700' : 'bg-emerald-600 hover:bg-emerald-700'
						)}
						disabled={submitting || !stickerReady || priceInvalid || !localReady}
						onclick={() => { haptic(15); void confirmPack(); }}
					>
						{submitting
							? '…'
							: manualComplete
								? 'إنجاز يدوياً'
								: isLocal
									? !localReady ? 'اختر المندوب' : 'تسليم للمندوب'
									: priceInvalid
										? 'السعر غير صالح'
										: stickerRequired && !stickerId ? 'امسح الملصق' : 'تأكيد وإرسال'}
					</Button>
				</div>
			{:else}
				<p class="text-muted-foreground text-center text-xs">اختر طريقة الخروج للمتابعة</p>
			{/if}
		</div>
	</DialogContent>
</Dialog>

<!-- Mini driver sheet (add / edit), stacked over step 2 of the local flow -->
<Dialog bind:open={addDriverOpen}>
	<DialogContent class="max-w-sm gap-4">
		<DialogHeader>
			<DialogTitle class="text-center text-lg font-bold">{editDriverId ? 'تعديل المندوب' : 'مندوب جديد'}</DialogTitle>
		</DialogHeader>
		<div class="space-y-3">
			<div class="space-y-1">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-muted-foreground text-xs font-semibold">الاسم</label>
				<Input bind:value={newDriverName} placeholder="اسم المندوب" class="h-12 text-base" autofocus />
			</div>
			<div class="space-y-1">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-muted-foreground text-xs font-semibold">الهاتف (اختياري)</label>
				<Input bind:value={newDriverPhone} inputmode="numeric" placeholder="07XXXXXXXXX" class="h-12 text-base tabular-nums" dir="ltr" />
				<p class="text-muted-foreground/70 text-[10px]">أي صيغة تُحوَّل تلقائياً — ‎+964‎ أو ‎00964‎ تصبح ‎07…‎</p>
			</div>
		</div>
		<DialogFooter class="flex-col gap-2 sm:flex-col">
			<div class="grid grid-cols-2 gap-2">
				<Button variant="outline" class="h-12 font-bold" onclick={() => (addDriverOpen = false)} disabled={addingDriver || deletingDriver}>إلغاء</Button>
				<Button
					class="h-12 bg-emerald-600 font-bold text-white hover:bg-emerald-700"
					disabled={addingDriver || deletingDriver || !(newDriverName ?? '').trim()}
					onclick={() => void saveDriver()}
				>
					{addingDriver ? '…' : editDriverId ? 'حفظ' : 'حفظ واختيار'}
				</Button>
			</div>
			{#if editDriverId}
				<Button
					variant="ghost"
					class="h-11 w-full gap-2 font-bold text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
					disabled={addingDriver || deletingDriver}
					onclick={() => void removeDriver()}
				>
					<Trash2 class="size-4" /> {deletingDriver ? 'جاري الحذف…' : 'حذف المندوب'}
				</Button>
			{/if}
		</DialogFooter>
	</DialogContent>
</Dialog>

{#if viewerSrc}
	<ImageViewer src={viewerSrc} origin={viewerOrigin} onClose={() => (viewerSrc = null)} />
{/if}

<!-- First-time onboarding — full-screen Dialog (stacks above the sheet) -->
<Dialog bind:open={showHelp} onOpenChange={(v) => { if (!v) markHelpSeen(); }}>
	<DialogContent
		showCloseButton={false}
		class="inset-0 top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-6 ring-0 sm:max-w-none"
	>
		<div class="m-auto flex w-full max-w-md flex-col gap-8 text-center">
			<div>
				<div class="bg-primary/15 text-primary mx-auto mb-4 flex size-20 items-center justify-center rounded-full">
					<Package class="size-10" />
				</div>
				<h2 class="text-2xl font-bold">كيف تجهّز الطلب</h2>
			</div>

			<ol class="space-y-4 text-right">
				<li class="bg-card flex items-center gap-4 rounded-2xl border p-4">
					<div class="bg-emerald-500/15 text-emerald-600 flex size-12 shrink-0 items-center justify-center rounded-xl">
						<Check class="size-6" />
					</div>
					<p class="text-base font-medium leading-snug">اضغط على المنتج لتجهيزه — العدّاد يزداد حتى يكتمل.</p>
				</li>
				<li class="bg-card flex items-center gap-4 rounded-2xl border p-4">
					<div class="bg-rose-500/15 text-rose-600 flex size-12 shrink-0 items-center justify-center rounded-xl">
						<Hand class="size-6" />
					</div>
					<p class="text-base font-medium leading-snug">للتخطّي والإرسال مباشرة، استمر بالضغط على الزر السفلي.</p>
				</li>
			</ol>

			<Button
				class="bg-primary text-primary-foreground h-14 w-full text-lg font-bold"
				onclick={dismissHelp}
			>
				فهمت، لنبدأ
			</Button>
		</div>
	</DialogContent>
</Dialog>

<HintPopover
	key="driver-notify"
	anchor={notifyHintAnchor}
	place="top"
	text="تقدر تطفئ «إشعار المندوب الآن» إذا راح ياخذ عدة طلبات معاً — وبعدها أرسل له «قائمة اليوم» من «جاهز للتسليم» برسالة واحدة تجمعها كلها."
/>
