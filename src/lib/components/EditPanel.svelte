<script lang="ts">
	import { Sheet, SheetContent } from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { ChevronRight, Plus, AlertTriangle, Bike, Check } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api, type Order, type OrderItem, type CityOrRegion, type LocalDriver } from '$lib/api';
	import SearchableSelect from './SearchableSelect.svelte';
	import EditItemRow from './EditItemRow.svelte';
	import ConfirmDiscard from './ConfirmDiscard.svelte';

	type Props = {
		order: Order | null;
		open: boolean;
		onClose: () => void;
		onSaved: () => void;
		cities: CityOrRegion[];
	};
	let { order, open = $bindable(), onClose, onSaved, cities }: Props = $props();

	let name = $state('');
	let phone = $state('');
	let phone2 = $state('');
	let price = $state('');
	let address = $state('');
	let notes = $state('');
	let itemsNumber = $state(1);
	let returnOrder = $state(false);

	let city = $state<{ id: number | string | null; name: string }>({ id: null, name: '' });
	let region = $state<{ id: number | string | null; name: string }>({ id: null, name: '' });
	let regions = $state<CityOrRegion[]>([]);
	let regionsLoading = $state(false);
	let items = $state<OrderItem[]>([]);
	// price = items total + shipping/discount component. Capture that component at
	// load so editing items keeps the total in sync. Total is locked (derived) by
	// default; the operator ticks `manualTotal` to override it by hand.
	let shippingDelta = $state(0);
	let manualTotal = $state(false);

	// LOCAL delivery: which of our drivers is carrying this order. Chosen at
	// packing and previously fixed forever — but a parcel gets handed to whoever
	// is actually going that way, and six names in a list is easy to mis-tap.
	let drivers = $state<LocalDriver[]>([]);
	let driverId = $state<string | null>(null);
	let initialDriverId = $state<string | null>(null);
	// A drop across town and a drop next door are not the same fee, so a new
	// driver is the moment to reprice: their fee, and the total the customer pays
	// (the ledger is price − fee, so both move the debt).
	let deliveryFee = $state('');
	const isLocal = $derived(order?.shipment?.carrierMethod === 'LOCAL');
	// Settled = the money is already counted back under this driver's name.
	// Moving the order would rewrite two ledgers, so the server refuses it too.
	const driverLocked = $derived(Boolean(order?.shipment?.settledAt));

	let saving = $state(false);

	function itemsSum() {
		return items.reduce(
			(sum, it) => sum + (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
			0
		);
	}

	// Once the carrier has the parcel it refuses edits — so we stop syncing to it
	// and let the operator edit LOCAL fields only. Read from the poller-saved
	// status (status_id 2 = تم الاستلام من قبل المندوب; ≥2 = in transit).
	const carrierReceived = $derived.by(() => {
		const s = order?.shipment;
		if (!s || s.carrierArchivedAt) return false;
		// An own-driver order has no carrier to have received it — and it stamps
		// the same pickedUpAt the moment it is assigned, which was reading as
		// "الوسيط استلم الطلب" on every LOCAL order in this panel.
		if (s.carrierMethod === 'LOCAL') return false;
		if (s.pickedUpAt) return true;
		const id = parseInt(String(s.alwaseetStatusId ?? ''), 10);
		if (!Number.isNaN(id) && id >= 2) return true;
		return ['DELIVERED', 'RETURNING', 'ATTENTION'].includes(s.carrierClass ?? '');
	});

	const isAlwaseet = $derived(
		order &&
			['SENT_TO_CARRIER', 'SUCCESS'].includes(order.status) &&
			Boolean(order.shipment?.trackingNumber) &&
			!carrierReceived
	);

	// Alwaseet rejects a COD price that is not a multiple of 250 IQD
	// («يجب أن يكون السعر من مضاعفات 250»). Only enforce when the edit actually
	// syncs to Alwaseet — a local-only edit has no such rule.
	const PRICE_STEP = 250;
	const priceInvalid = $derived(
		Boolean(isAlwaseet) && (Number(price) || 0) % PRICE_STEP !== 0
	);
	function roundPrice() {
		price = String(Math.round((Number(price) || 0) / PRICE_STEP) * PRICE_STEP);
		manualTotal = true; // a hand-rounded total must not be recomputed away
	}

	// Only (re)load fields when the panel opens or a different order is shown —
	// NOT when the same order's data is refreshed underneath us (30s poll / tab
	// focus), which would wipe the operator's in-progress edits.
	let loadedId: string | null = null;

	$effect(() => {
		if (!open) {
			loadedId = null;
			baseline = '';
			return;
		}
		if (!order || order.id === loadedId) return;
		loadedId = order.id;
		// Empty until the loaded values have settled — see captureBaseline().
		baseline = '';
		{
			name = order.customerName ?? '';
			phone = order.customerPhone ?? '';
			phone2 = order.customerPhone2 ?? '';
			price = String(order.price ?? '');
			address = order.fullAddress ?? '';
			notes = order.notes ?? '';
			itemsNumber = order.itemsNumber ?? 1;
			returnOrder = Boolean(order.returnOrder || order.replacement);

			let cityId: number | string | null = order.cityId ?? null;
			const cityName = order.cityName ?? '';
			if (!cityId && cityName && cities.length) {
				const found = cities.find((c) => c.nameAr === cityName || c.name === cityName);
				if (found) cityId = found.id;
			}
			city = { id: cityId, name: cityName };
			region = { id: order.regionId ?? null, name: order.regionName ?? '' };
			items = order.items ? ($state.snapshot(order.items) as OrderItem[]) : [];
			driverId = order.shipment?.localDriverId ?? null;
			initialDriverId = driverId;
			deliveryFee =
				order.shipment?.localDeliveryFee == null ? '' : String(order.shipment.localDeliveryFee);
			if (order.shipment?.carrierMethod === 'LOCAL') void loadDrivers();
			// Shipping/discount = whatever the stored total has beyond the line items.
			// Sum from order.items (the source), NOT the reactive `items` we just wrote,
			// to avoid a self-referential loop inside this effect.
			const loadedSum = (order.items ?? []).reduce(
				(sum, it) => sum + (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
				0
			);
			shippingDelta = (Number(order.price) || 0) - loadedSum;
			manualTotal = false;

			// The baseline waits for the regions: preselecting one rewrites
			// region.name from the region list (nameAr), and comparing against a
			// snapshot taken before that would call an untouched panel edited.
			if (cityId) void loadRegions(Number(cityId), order.regionId ?? null).then(captureBaseline);
			else {
				regions = [];
				captureBaseline();
			}
		}
	});

	// ---- leaving with edits in hand ------------------------------------------
	// The panel is a full-screen sheet on a phone, so it is dismissed by a back
	// gesture and by a tap on the backdrop — two easy ways to lose a rewritten
	// address. What counts as an edit is decided by comparing against the values
	// the panel opened with, not by "was anything typed": returning a field to
	// what it was is not an edit, and should not be argued with.
	let baseline = $state('');
	let confirmLeave = $state(false);

	function fingerprint() {
		return JSON.stringify({
			name,
			phone,
			phone2,
			price,
			address,
			notes,
			itemsNumber,
			returnOrder,
			cityId: city.id,
			cityName: city.name,
			regionId: region.id,
			regionName: region.name,
			driverId,
			deliveryFee,
			items: items.map((it) => ({
				sku: it.sku ?? '',
				name: it.name ?? '',
				quantity: Number(it.quantity) || 1,
				unitPrice: Number(it.unitPrice) || 0
			}))
		});
	}

	function captureBaseline() {
		baseline = fingerprint();
	}

	const dirty = $derived(baseline !== '' && fingerprint() !== baseline);

	function requestClose() {
		if (!dirty) {
			onClose();
			return;
		}
		// A backdrop tap or Escape has already closed the sheet by the time this
		// runs; put it back so the question is asked over the edits themselves.
		open = true;
		confirmLeave = true;
	}

	function discardAndClose() {
		baseline = '';
		onClose();
	}

	$effect(() => {
		if (!open || !dirty) return;
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});

	async function loadRegions(cityId: number, preselectId: number | null) {
		regionsLoading = true;
		try {
			const res = await api.getRegions(cityId);
			regions = res.success && res.data ? res.data : [];
			if (preselectId) {
				const found = regions.find((r) => r.id === Number(preselectId));
				if (found) region = { id: found.id, name: found.nameAr ?? found.name };
			}
		} catch {
			regions = [];
		} finally {
			regionsLoading = false;
		}
	}

	function onCityChange(item: { id: number | string; name: string }) {
		region = { id: null, name: '' };
		regions = [];
		void loadRegions(Number(item.id), null);
	}

	function addItem() {
		items = [...items, { name: '', quantity: 1, unitPrice: 0 }];
	}

	function removeItem(index: number) {
		items = items.filter((_, i) => i !== index);
		recomputeItemsNumber();
		recomputeTotal();
	}

	function updateItem(index: number, field: keyof OrderItem, value: unknown) {
		items = items.map((it, i) => (i === index ? { ...it, [field]: value } : it));
		if (field === 'quantity') recomputeItemsNumber();
		if (field === 'quantity' || field === 'unitPrice') recomputeTotal();
	}

	function recomputeItemsNumber() {
		itemsNumber = items.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
	}

	// Keep the total in step with the line items (items sum + shipping/discount),
	// unless the operator has unlocked manual entry.
	function recomputeTotal() {
		if (manualTotal) return;
		price = String(itemsSum() + shippingDelta);
	}

	// Toggling manual override off snaps the total back to the derived value.
	function toggleManualTotal() {
		manualTotal = !manualTotal;
		if (!manualTotal) recomputeTotal();
	}

	async function loadDrivers() {
		if (drivers.length) return; // the directory is small and rarely changes
		try {
			const res = await api.listLocalDrivers();
			if (res.success) drivers = (res.data ?? []).filter((d) => d.active || d.id === driverId);
		} catch {
			/* the panel still saves everything else without the list */
		}
	}

	async function save() {
		if (!order) return;
		saving = true;
		const payload: Record<string, unknown> = {
			customerName: name,
			price,
			customerPhone: phone,
			customerPhone2: phone2,
			cityId: city.id,
			cityName: city.name,
			regionId: region.id || null,
			regionName: region.name || null,
			fullAddress: address,
			itemsNumber,
			notes,
			returnOrder
		};
		try {
			let driverNotified = false;
			if (isAlwaseet) {
				await api.editAlwaseet(order.id, payload);
			} else {
				// Drop rows with neither a name nor a SKU — they'd be stored as
				// 'Unspecified' placeholders.
				payload.items = items
					.filter((it) => (it.name ?? '').trim() || (it.sku ?? '').trim())
					.map((it) => ({
						...it,
						unitPrice: Number(it.unitPrice) || 0,
						quantity: Number(it.quantity) || 1
					}));
				const res = await api.update(order.id, payload);
				driverNotified = Boolean(res.driverNotified);
			}
			// Separate call on purpose: the driver lives on the shipment, not on the
			// submission the payload above writes, and it has its own refusal rule.
			if (isLocal && driverId && driverId !== initialDriverId) {
				const fee = deliveryFee.trim() === '' ? null : Number(deliveryFee) || 0;
				const res = await api.setLocalDriver(order.id, driverId, fee);
				if (res.success) initialDriverId = driverId;
			}
			if (carrierReceived) {
				toast.success('تم الحفظ محلياً — الوسيط استلم الطلب ولم يُعدّل فيه');
			} else if (driverNotified) {
				toast.success('تم الحفظ — وتم إشعار المندوب بالتعديل');
			} else {
				toast.success('تم الحفظ');
			}
			// Saved — nothing left to guard on the way out.
			baseline = '';
			onClose();
			onSaved();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			saving = false;
		}
	}
</script>

<Sheet bind:open onOpenChange={(v) => !v && requestClose()}>
	<SheetContent
		side="bottom"
		class="h-[100dvh] max-h-[100dvh] gap-0 p-0 sm:mx-auto sm:max-w-2xl sm:rounded-t-3xl border-t border-border/60 bg-background/95 backdrop-blur-2xl"
		showCloseButton={false}
	>
		<!-- Apple Navigation Bar -->
		<div class="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-border/40 bg-card/85 px-4 py-3 shadow-xs backdrop-blur-2xl backdrop-saturate-200 supports-[backdrop-filter]:bg-card/75">
			<Button
				variant="ghost"
				class="apple-press h-9 px-2 text-sm font-bold text-primary hover:bg-primary/10 hover:text-primary [&_svg]:size-4.5"
				onclick={requestClose}
			>
				<ChevronRight class="rotate-180" /> رجوع
			</Button>
			<h2 class="text-base font-bold">تعديل الطلب</h2>
			<Button
				class="apple-press h-9 min-w-[76px] rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground shadow-xs ring-1 ring-white/20 ring-inset"
				onclick={save}
				disabled={saving || priceInvalid}
			>
				{saving ? '…' : 'حفظ'}
			</Button>
		</div>

		<div class="flex-1 space-y-4 overflow-y-auto p-4 pb-12">
			{#if carrierReceived}
				<!-- The carrier already has the parcel; edits here stay local. -->
				<div class="flex items-start gap-2 rounded-2xl border-2 border-amber-500 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
					<AlertTriangle class="mt-0.5 size-5 shrink-0" />
					<p class="text-sm font-bold leading-relaxed">
						الوسيط استلم الطلب — لا يمكن تعديله لدى الوسيط. أي تعديل هنا محلي فقط ولن
						يصل إلى الوسيط.
					</p>
				</div>
			{/if}
			<!-- Group 1: Customer Information -->
			<div class="space-y-3 rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm ring-1 ring-white/10 ring-inset backdrop-blur-xl">
				<div class="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">معلومات الزبون</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="space-y-1.5">
						<Label for="edit-name" class="text-xs font-semibold">اسم الزبون</Label>
						<Input id="edit-name" bind:value={name} class="rounded-xl border-border/60 bg-muted/30 focus:bg-background" />
					</div>
					<div class="space-y-1.5">
						<Label for="edit-phone" class="text-xs font-semibold">رقم الهاتف</Label>
						<Input id="edit-phone" type="tel" inputmode="tel" bind:value={phone} dir="ltr" class="rounded-xl border-border/60 bg-muted/30 focus:bg-background" />
					</div>
				</div>

				<div class="space-y-1.5">
					<Label for="edit-phone2" class="text-xs font-semibold">هاتف إضافي</Label>
					<Input id="edit-phone2" type="tel" inputmode="tel" bind:value={phone2} dir="ltr" class="rounded-xl border-border/60 bg-muted/30 focus:bg-background" />
				</div>
			</div>

			<!-- Group 2: Total Price Card -->
			<div
				class="space-y-2 rounded-2xl border p-4 shadow-xs ring-1 ring-inset transition-colors backdrop-blur-xl
					{manualTotal
						? 'border-primary/50 bg-primary/10 ring-primary/20'
						: 'border-emerald-500/40 bg-emerald-500/10 ring-emerald-500/20'}"
			>
				<div class="flex items-center justify-between">
					<Label for="edit-price" class="text-xs font-extrabold uppercase tracking-wider {manualTotal ? 'text-primary' : 'text-emerald-700 dark:text-emerald-300'}">
						المجموع الكلي (د.ع)
					</Label>
					<label class="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-muted-foreground">
						<input
							type="checkbox"
							class="size-4 rounded-md accent-primary"
							checked={manualTotal}
							onchange={toggleManualTotal}
						/>
						تعديل يدوي
					</label>
				</div>
				<Input
					id="edit-price"
					type="number"
					inputmode="numeric"
					class="h-12 rounded-xl border-border/60 bg-background/80 text-xl font-black tabular-nums shadow-xs disabled:opacity-100"
					bind:value={price}
					disabled={!manualTotal}
				/>
				<p class="text-[11px] font-medium text-muted-foreground">
					{manualTotal
						? 'تعديل يدوي — لن يتغير تلقائياً عند إضافة أو حذف منتجات'
						: 'يُحسب تلقائياً: مجموع أسعار المنتجات + فرق التوصيل'}
				</p>
				{#if priceInvalid}
					<div class="flex items-center justify-between gap-2 rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2">
						<p class="flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-300">
							<AlertTriangle class="size-3.5 shrink-0" /> السعر يجب أن يكون من مضاعفات 250
						</p>
						<button
							type="button"
							onclick={roundPrice}
							class="shrink-0 rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-700"
						>
							تقريب لأقرب 250
						</button>
					</div>
				{/if}
			</div>

			<!-- Group 3: Location Details -->
			<div class="relative z-30 space-y-3 rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm ring-1 ring-white/10 ring-inset backdrop-blur-xl">
				<div class="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">العنوان والتوصيل</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label class="text-xs font-semibold">المدينة</Label>
						<SearchableSelect items={cities} bind:value={city} onSelect={onCityChange} />
					</div>
					<div class="space-y-1.5">
						<Label class="text-xs font-semibold">المنطقة</Label>
						{#if city.id}
							<SearchableSelect
								items={regions}
								bind:value={region}
								placeholder={regionsLoading ? 'جاري التحميل…' : 'ابحث…'}
								disabled={regionsLoading || regions.length === 0}
							/>
						{:else}
							<Input disabled placeholder="اختر المدينة أولاً" class="rounded-xl border-border/60" />
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-3 gap-3">
					<div class="col-span-2 space-y-1.5">
						<Label for="edit-address" class="text-xs font-semibold">العنوان التفصيلي</Label>
						<Input
							id="edit-address"
							bind:value={address}
							placeholder="المنطقة، الزقاق، الدار…"
							class="rounded-xl border-border/60 bg-muted/30 focus:bg-background"
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="edit-items-number" class="text-xs font-semibold">القطع</Label>
						<Input
							id="edit-items-number"
							type="number"
							inputmode="numeric"
							bind:value={itemsNumber}
							class="rounded-xl border-border/60 bg-muted/30 focus:bg-background font-mono tabular-nums"
						/>
					</div>
				</div>
			</div>

			<!-- Group 4: Line Items -->
			{#if !isAlwaseet}
				<div class="relative z-20 space-y-3 rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm ring-1 ring-white/10 ring-inset backdrop-blur-xl">
					<div class="flex items-center justify-between">
						<div class="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">المنتجات ({items.length})</div>
					</div>
					<div class="space-y-2">
						{#each items as item, i (i)}
							<EditItemRow
								{item}
								onChange={(field, value) => updateItem(i, field, value)}
								onRemove={() => removeItem(i)}
							/>
						{/each}
					</div>
					<Button type="button" variant="outline" size="sm" class="apple-press w-full rounded-xl border-dashed border-primary/40 font-bold text-primary hover:bg-primary/5" onclick={addItem}>
						<Plus class="size-4" /> إضافة منتج
					</Button>
				</div>
			{/if}

			<!-- Group 4b: LOCAL delivery — which of our drivers is carrying it -->
			{#if isLocal}
				<div class="space-y-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/[0.07] p-4 shadow-sm ring-1 ring-cyan-500/15 ring-inset backdrop-blur-xl">
					<div class="flex items-center gap-2">
						<Bike class="size-4 text-cyan-600 dark:text-cyan-400" />
						<span class="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
							المندوب المحلي
						</span>
					</div>

					{#if driverLocked}
						<p class="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-700 dark:text-amber-300">
							<AlertTriangle class="size-3.5 shrink-0" />
							تمت تسوية حساب هذا الطلب مع {order?.shipment?.localDriverName || 'المندوب'} — ألغِ التسوية أولاً لتغيير المندوب.
						</p>
					{:else if drivers.length === 0}
						<p class="text-muted-foreground text-[11px]">لا توجد قائمة مندوبين.</p>
					{:else}
						<div class="grid grid-cols-2 gap-2">
							{#each drivers as d (d.id)}
								<button
									type="button"
									onclick={() => (driverId = d.id)}
									class="apple-press flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start transition-colors
										{driverId === d.id
										? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200'
										: 'border-border/60 bg-card/70 hover:bg-accent/40'}"
								>
									<span class="min-w-0">
										<span class="block truncate text-sm font-bold">{d.name}</span>
										{#if d.phone}
											<span class="text-muted-foreground block truncate text-[10px] tabular-nums" dir="ltr">
												{d.phone}
											</span>
										{/if}
									</span>
									{#if driverId === d.id}
										<Check class="size-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
									{/if}
								</button>
							{/each}
						</div>
						{#if driverId !== initialDriverId}
							<p class="text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
								سيُنقل الطلب من {order?.shipment?.localDriverName || 'غير محدد'} إلى
								{drivers.find((d) => d.id === driverId)?.name} عند الحفظ — وتنتقل معه الذمة.
							</p>

							<!-- Repricing lives here, not in the money group above: a new
							     driver is the only moment the fee is genuinely in question,
							     and the ledger is (total − fee), so both belong together. -->
							<div class="grid grid-cols-2 gap-2 border-t border-cyan-500/20 pt-3">
								<div class="space-y-1.5">
									<Label for="edit-driver-fee" class="text-[11px] font-bold text-muted-foreground">
										أجور التوصيل (د.ع)
									</Label>
									<Input
										id="edit-driver-fee"
										type="number"
										inputmode="numeric"
										bind:value={deliveryFee}
										placeholder="5000"
										class="rounded-xl border-cyan-500/30 bg-background/70 font-bold tabular-nums"
									/>
								</div>
								<div class="space-y-1.5">
									<Label for="edit-driver-total" class="text-[11px] font-bold text-muted-foreground">
										المجموع الكلي (د.ع)
									</Label>
									<Input
										id="edit-driver-total"
										type="number"
										inputmode="numeric"
										bind:value={price}
										oninput={() => (manualTotal = true)}
										class="rounded-xl border-cyan-500/30 bg-background/70 font-bold tabular-nums"
									/>
								</div>
							</div>
							<p class="text-[11px] text-muted-foreground">
								يبقى بذمة المندوب: <span class="font-bold tabular-nums">
									{((Number(price) || 0) - (Number(deliveryFee) || 0)).toLocaleString('en-US')} د.ع
								</span>
								— المجموع ناقص أجوره.
							</p>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- Group 5: Replacement Toggle -->
			<button
				type="button"
				onclick={() => (returnOrder = !returnOrder)}
				class="apple-press flex w-full items-center justify-between rounded-2xl border p-4 shadow-xs ring-1 ring-inset transition-colors backdrop-blur-xl
					{returnOrder
						? 'border-orange-500/50 bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300'
						: 'border-border/60 bg-card/65 text-muted-foreground ring-white/10'}"
			>
				<div class="flex items-center gap-3">
					<span class="text-2xl">🔄</span>
					<div class="text-right">
						<div class="text-sm font-bold text-foreground">طلب استبدال</div>
						<div class="text-xs text-muted-foreground">تفعيل عند إرجاع أو استبدال بضاعة</div>
					</div>
				</div>
				<div
					class="size-5 rounded-full border-2 transition-colors
						{returnOrder ? 'border-orange-500 bg-orange-500 shadow-xs' : 'border-border bg-transparent'}"
				></div>
			</button>

			<!-- Group 6: Notes -->
			<div class="space-y-2 rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm ring-1 ring-white/10 ring-inset backdrop-blur-xl">
				<Label for="edit-notes" class="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">ملاحظات الطلب</Label>
				<Textarea id="edit-notes" bind:value={notes} rows={3} class="rounded-xl border-border/60 bg-muted/30 focus:bg-background" />
			</div>
		</div>
	</SheetContent>
</Sheet>

<ConfirmDiscard
	bind:open={confirmLeave}
	onDiscard={discardAndClose}
	title="إغلاق التعديل بدون حفظ؟"
	body="التعديلات على هذا الطلب لم تُحفظ وسيتم فقدانها."
	discardLabel="إغلاق بدون حفظ"
/>
