<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto, beforeNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { Toaster } from '$lib/components/ui/sonner';
	import { ChevronRight, Plus, MessageCircle, MapPin, Check, RotateCcw, X, AlertTriangle } from '@lucide/svelte';
	import { cn, NO_SPINNER } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import { api, type CityOrRegion, type OrderItem, type ContactLookup, type ContactAddressSuggestion } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import EditItemRow from '$lib/components/EditItemRow.svelte';
	import FloatingField from '$lib/components/FloatingField.svelte';
	import ConfirmDiscard from '$lib/components/ConfirmDiscard.svelte';
	import StickerScanner from '$lib/components/StickerScanner.svelte';
	import { haptic } from '$lib/utils/haptic';
	import { formatPrice } from '$lib/utils/format';

	// Printerless operators can bind a preprinted Alwaseet sticker up front; it's
	// validated (011=free) by the scanner and saved on the order so packing
	// pre-fills it. Optional — an order can still be created without one.
	const printerless = $derived(auth.user?.printerless === true);
	let preStickerId = $state('');

	let name = $state('');
	let phone = $state('');
	let phone2 = $state('');
	let price = $state('');
	let address = $state('');
	let notes = $state('');
	let itemsNumber = $state(1);
	let returnOrder = $state(false);
	let sendWhatsapp = $state(true);

	let city = $state<{ id: number | string | null; name: string }>({ id: null, name: '' });
	let region = $state<{ id: number | string | null; name: string }>({ id: null, name: '' });
	let cities = $state<CityOrRegion[]>([]);
	let regions = $state<CityOrRegion[]>([]);
	let regionsLoading = $state(false);
	let items = $state<OrderItem[]>([]);
	let manualTotal = $state(false);

	// Most orders in the system carry a 5,000 delivery fee (3,000 on some
	// routes). There is no source for it — regions.deliveryFee exists but is 0
	// on 6,273 of 6,283 rows — so it starts at the common value and the operator
	// adjusts. It is folded into `price`, not sent separately: the edit panel
	// recovers it later as (stored total − items sum).
	const DEFAULT_DELIVERY = 5000;
	let delivery = $state(String(DEFAULT_DELIVERY));

	// Plenty of orders arrive with a phone and nothing else. The backend still
	// requires a name (adminShipments.js: 'الاسم مطلوب'), so a blank one is
	// filled in here rather than blocking the save over something the operator
	// often cannot supply.
	const DEFAULT_NAME = 'عميل عام';

	// The second phone and the note are both exceptions, not the rule — kept
	// folded away so they are not fields to skip past on every order.
	let showPhone2 = $state(false);
	let showNotes = $state(false);

	let saving = $state(false);

	const itemsTotal = $derived(
		items.reduce((sum, it) => sum + (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0), 0)
	);
	const deliveryFee = $derived(Number(delivery) || 0);

	// The total is derived whenever there are rows to derive it from. Keyed off
	// the summed price instead, a freshly added row read as "nothing priced yet"
	// and removing the last row left the stale figure behind in a field that had
	// quietly become editable again.
	const autoTotal = $derived(!manualTotal && items.length > 0);

	$effect(() => {
		if (autoTotal) price = String(itemsTotal + deliveryFee);
	});

	// Alwaseet rejects a COD price that is not a multiple of 250 IQD
	// («يجب أن يكون السعر من مضاعفات 250»), so it is invalid up front. Only flag a
	// real, non-empty amount — an empty form is not an error yet.
	const PRICE_STEP = 250;
	// `price` is typed as a string, but `bind:value` on <input type="number">
	// writes a NUMBER back the moment the operator types — so anything that
	// treats it as text has to go through this. Calling .trim() on it directly
	// threw inside a derived, which killed the whole reactive flush: the total in
	// the action dock then froze on its last good render while the field kept
	// accepting digits.
	const priceText = $derived(String(price ?? '').trim());
	const priceInvalid = $derived(priceText !== '' && (Number(price) || 0) % PRICE_STEP !== 0);
	function roundPrice() {
		price = String(Math.round((Number(price) || 0) / PRICE_STEP) * PRICE_STEP);
		manualTotal = true; // a hand-rounded total must not be recomputed away
		haptic(8);
	}

	// Phone → past-customer lookup (name + saved addresses)
	let lookup = $state<ContactLookup | null>(null);
	let lookupTimer: ReturnType<typeof setTimeout> | null = null;
	let lastLookedUp = '';
	let selectedAddrId = $state<string | null>(null);

	// Live WhatsApp existence check per phone field (idle | checking | yes | no)
	type WaState = 'idle' | 'checking' | 'yes' | 'no';
	let waStatus = $state<WaState>('idle');
	let wa2Status = $state<WaState>('idle');
	let waTimer: ReturnType<typeof setTimeout> | null = null;
	let wa2Timer: ReturnType<typeof setTimeout> | null = null;

	// Public, same-origin endpoint (fail-open: returns valid:true on any error).
	async function checkWhatsapp(num: string): Promise<WaState> {
		const res = await fetch('/api/public/check-whatsapp', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ numbers: [num] })
		});
		const data = await res.json();
		return data.success && data.valid ? 'yes' : 'no';
	}

	// Iraqi mobile format, same rule as the public form + backend:
	// optional +964/964/0 prefix then 7 and 9 digits
	const PHONE_RE = /^(\+964|964|0)?7\d{9}$/;
	const phoneValid = $derived(PHONE_RE.test(phone.replace(/[\s-]/g, '')));
	const phone2Valid = $derived(!phone2.trim() || PHONE_RE.test(phone2.replace(/[\s-]/g, '')));

	// What still blocks the save, in the order the fields appear. Drives both the
	// footer hint and where a blocked save jumps to — a greyed-out button told the
	// operator nothing about which field it was waiting on.
	const missing = $derived.by(() => {
		const out: { id: string; label: string }[] = [];
		if (!phoneValid) out.push({ id: 'new-phone', label: 'رقم الهاتف' });
		if (!phone2Valid) out.push({ id: 'new-phone2', label: 'الهاتف الإضافي' });
		if (!city.id) out.push({ id: 'new-city', label: 'المدينة' });
		return out;
	});

	// Folding the field away also drops whatever was typed into it, so a hidden
	// half-finished number can't sit there failing the save with nothing on
	// screen to explain it.
	function hidePhone2() {
		phone2 = '';
		wa2Status = 'idle';
		showPhone2 = false;
	}

	onMount(() => {
		void loadCities();
		// The screen exists to type a phone number into. Skipping the first tap
		// also puts the caret where the operator's eye already is.
		document.getElementById('new-phone')?.focus();
	});

	// Debounced contact lookup as the operator types the phone.
	$effect(() => {
		const digits = phone.replace(/\D/g, '');
		if (lookupTimer) clearTimeout(lookupTimer);
		if (digits.length < 10) {
			lookup = null;
			lastLookedUp = '';
			selectedAddrId = null;
			return;
		}
		if (digits === lastLookedUp) return;
		lookupTimer = setTimeout(async () => {
			try {
				const res = await api.lookupContact(phone.trim());
				lastLookedUp = digits;
				lookup = res.success ? (res.data ?? null) : null;
				// Prefill the name if the operator hasn't typed one yet.
				if (lookup && !name.trim()) name = lookup.name;
			} catch {
				lookup = null;
			}
		}, 350);
	});

	// Debounced live WhatsApp check for the primary phone.
	$effect(() => {
		const digits = phone.replace(/\D/g, '');
		if (waTimer) clearTimeout(waTimer);
		if (digits.length < 10) { waStatus = 'idle'; return; }
		waStatus = 'checking';
		waTimer = setTimeout(async () => {
			try { waStatus = await checkWhatsapp(phone.trim()); }
			catch { waStatus = 'idle'; }
		}, 450);
	});

	// Debounced live WhatsApp check for the secondary phone.
	$effect(() => {
		const digits = phone2.replace(/\D/g, '');
		if (wa2Timer) clearTimeout(wa2Timer);
		if (digits.length < 10) { wa2Status = 'idle'; return; }
		wa2Status = 'checking';
		wa2Timer = setTimeout(async () => {
			try { wa2Status = await checkWhatsapp(phone2.trim()); }
			catch { wa2Status = 'idle'; }
		}, 450);
	});

	async function applyAddress(addr: ContactAddressSuggestion) {
		haptic(8);
		selectedAddrId = addr.id;
		if (lookup && !name.trim()) name = lookup.name;
		city = { id: addr.cityId, name: addr.cityName };
		address = addr.fullAddress ?? '';
		region = { id: null, name: '' };
		await loadRegions(addr.cityId);
		if (addr.regionId) region = { id: addr.regionId, name: addr.regionName ?? '' };
	}

	async function loadCities() {
		try {
			const res = await api.getCities();
			cities = res.data ?? [];
		} catch {
			cities = [];
		}
	}

	async function loadRegions(cityId: number) {
		regionsLoading = true;
		try {
			const res = await api.getRegions(cityId);
			regions = res.success && res.data ? res.data : [];
		} catch {
			regions = [];
		} finally {
			regionsLoading = false;
		}
	}

	function onCityChange(item: { id: number | string; name: string }) {
		region = { id: null, name: '' };
		regions = [];
		void loadRegions(Number(item.id));
	}

	async function addItem() {
		items = [...items, { name: '', quantity: 1, unitPrice: 0 } as OrderItem];
		// Adding a row is itself a piece. Without this the count only moved when
		// a quantity was typed by hand, so picking products from the search — the
		// normal way — left القطع stuck at 1 however many were added.
		recomputeItemsNumber();
		// Land in the new row's code field: that is what gets typed first, and it
		// drives the product search that fills the rest of the row.
		await tick();
		const skus = document.querySelectorAll<HTMLInputElement>('[data-item-sku]');
		skus[skus.length - 1]?.focus();
	}
	function removeItem(index: number) {
		items = items.filter((_, i) => i !== index);
		recomputeItemsNumber();
		// With no rows left there is nothing to derive from, so the effect below
		// stops writing and the last computed figure would sit in the field as
		// though it had been typed. Clear it.
		if (!items.length && !manualTotal) price = '';
	}
	function updateItem(index: number, field: keyof OrderItem, value: unknown) {
		items = items.map((it, i) => (i === index ? { ...it, [field]: value } : it));
		if (field === 'quantity') recomputeItemsNumber();
	}
	function recomputeItemsNumber() {
		itemsNumber = items.length
			? items.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0)
			: 1;
	}

	// ---- leaving a half-written order ---------------------------------------
	// A whole order is typed on one screen, so a stray back gesture used to throw
	// away several minutes of an operator's phone typing without a word.
	//
	// "Filled" means the operator put something here: an empty form, or one where
	// only the delivery fee still sits at its default, leaves without a question.
	const dirty = $derived(
		name.trim() !== '' ||
			phone.trim() !== '' ||
			phone2.trim() !== '' ||
			address.trim() !== '' ||
			notes.trim() !== '' ||
			city.id !== null ||
			region.id !== null ||
			items.length > 0 ||
			returnOrder ||
			delivery !== String(DEFAULT_DELIVERY) ||
			// With no rows the total is only ever there because it was typed.
			(items.length === 0 && priceText !== '')
	);

	let confirmLeave = $state(false);
	// Set once the operator has answered the question, or once the order has been
	// created — both mean the next navigation is intended and must not re-ask.
	let leaving = $state(false);
	let pendingLeave: (() => void) | null = null;

	function back() {
		if (dirty && !leaving) {
			pendingLeave = leaveNow;
			confirmLeave = true;
			return;
		}
		leaveNow();
	}

	function leaveNow() {
		leaving = true;
		if (history.length > 1) history.back();
		else void goto(`${base}/`);
	}

	function discardAndLeave() {
		const go = pendingLeave ?? leaveNow;
		pendingLeave = null;
		leaving = true;
		go();
	}

	// Everything that is not the رجوع button: the phone's back gesture, the
	// header's own links, a swipe. beforeNavigate can cancel those; it cannot
	// cancel a tab close, which is what the beforeunload below is for.
	beforeNavigate((nav) => {
		if (!dirty || leaving) return;
		// 'leave' is the browser leaving the app entirely — beforeunload owns it,
		// and cancelling here would do nothing.
		if (nav.type === 'leave') return;
		nav.cancel();
		const target = nav.to?.url;
		pendingLeave = () => void goto(target ? target.href : `${base}/`);
		confirmLeave = true;
	});

	$effect(() => {
		if (!dirty || leaving) return;
		// The browser's own wording, in the browser's own dialog — the page cannot
		// draw this one, it can only ask for it.
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});

	// Saving with something missing jumps to the field instead of doing nothing.
	function attemptSubmit() {
		if (saving) return;
		if (missing.length) {
			haptic(30);
			const first = missing[0];
			const host = document.getElementById(first.id);
			const field = host instanceof HTMLInputElement ? host : host?.querySelector('input');
			host?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			field?.focus();
			toast.error(`أكمل أولاً: ${missing.map((m) => m.label).join('، ')}`);
			return;
		}
		void submit();
	}

	async function submit() {
		saving = true;
		const t = toast.loading('جاري إنشاء الطلب…');
		try {
			const res = await api.createOrder({
				customerName: name.trim() || DEFAULT_NAME,
				customerPhone: phone.trim(),
				customerPhone2: phone2.trim() || null,
				cityId: city.id,
				cityName: city.name,
				regionId: region.id || null,
				regionName: region.name || null,
				fullAddress: address.trim(),
				notes: notes.trim() || null,
				price: Number(price) || 0,
				itemsNumber,
				replacement: returnOrder ? 1 : 0,
				items: items
					.filter((it) => (it.name ?? '').trim() || it.sku)
					.map((it) => ({
						sku: it.sku,
						name: it.name,
						nameAr: it.nameAr,
						// Carried from the product picked in the search menu — without it
						// the saved line has no image and the card shows a blank tile.
						imageUrl: it.imageUrl,
						quantity: Number(it.quantity) || 1,
						unitPrice: Number(it.unitPrice) || 0
					})),
				sendCustomerWhatsapp: sendWhatsapp,
				preStickerId: printerless && preStickerId ? preStickerId : null
			});
			toast.success('تم إنشاء الطلب', { id: t });
			haptic(15);
			// Saved — the form is no longer worth guarding.
			leaving = true;
			await goto(`${base}/`);
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>OPS</title>
</svelte:head>

<!-- Section titles with Apple badge -->
{#snippet legend(n: string, title: string)}
	<div class="mb-3 flex items-center gap-2">
		<span
			class="flex size-5.5 items-center justify-center rounded-full bg-primary/15 text-xs font-black text-primary ring-1 ring-primary/20 ring-inset"
		>
			{n}
		</span>
		<h2 class="text-sm font-extrabold tracking-tight text-foreground">{title}</h2>
	</div>
{/snippet}

{#if !auth.isAuthenticated}
	<LoginScreen />
{:else}
	<div class="flex min-h-dvh flex-col bg-[#f2f3f7] [background-image:radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(120,160,240,0.12),transparent_70%),radial-gradient(ellipse_50%_40%_at_100%_100%,rgba(160,180,220,0.10),transparent_70%)] dark:bg-[#000000] dark:[background-image:radial-gradient(ellipse_75%_55%_at_50%_-10%,rgba(255,255,255,0.05),transparent_70%),radial-gradient(ellipse_55%_45%_at_100%_100%,rgba(255,255,255,0.03),transparent_70%)]">
		<!-- Apple Frosted Navigation Bar -->
		<header
			class="sticky top-0 z-30 flex shrink-0 items-center justify-between border-b border-black/10 bg-white/80 px-3 py-2.5 shadow-xs ring-1 ring-black/5 ring-inset backdrop-blur-2xl backdrop-saturate-200 dark:border-white/12 dark:bg-card/85 dark:ring-white/10"
		>
			<Button variant="ghost" class="apple-press h-9 px-2 text-sm font-bold text-primary hover:bg-primary/10 hover:text-primary [&_svg]:size-4.5" onclick={back}>
				<ChevronRight class="rotate-180" /> رجوع
			</Button>
			<h1 class="text-base font-bold text-foreground">طلب جديد</h1>
			<!-- Balances the back button so the title sits centred -->
			<div class="w-16 shrink-0"></div>
		</header>

		<div class="mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-y-auto px-3.5 pb-8 pt-4">
			<!-- ① Customer ------------------------------------------------------- -->
			<section class="relative z-40 space-y-3 rounded-3xl border border-black/[0.08] bg-white/78 p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-white/80 ring-inset backdrop-blur-2xl dark:border-white/[0.12] dark:bg-card/75 dark:shadow-[0_4px_16px_rgba(0,0,0,0.35),0_12px_32px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:ring-white/[0.08]">
				{@render legend('1', 'معلومات الزبون')}

				<div class="space-y-1">
					<FloatingField
						id="new-phone"
						label="الهاتف"
						type="tel"
						inputmode="tel"
						dir="ltr"
						placeholder="07XXXXXXXXX"
						bind:value={phone}
						invalid={Boolean(phone.trim()) && !phoneValid}
					/>
					<!-- Fixed-height slot: the WhatsApp check lands ~450ms after typing
					     stops, and a line appearing there used to shove every field
					     below it down mid-tap. The add-a-second-phone link shares the
					     row rather than taking one of its own. -->
					<div class="flex items-center justify-between gap-2">
						<p class="min-h-5 min-w-0 truncate text-[13px] leading-5">
							{#if phone.trim() && !phoneValid}
								<span class="font-semibold text-red-600">رقم غير صحيح — مثال: 07701234567</span>
							{:else if waStatus === 'checking'}
								<span class="text-muted-foreground">جارٍ التحقق من واتساب…</span>
							{:else if waStatus === 'yes'}
								<span class="font-semibold text-green-600">✓ يمتلك واتساب</span>
							{:else if waStatus === 'no'}
								<span class="font-semibold text-red-600">✗ لا يمتلك واتساب</span>
							{/if}
						</p>
						{#if !showPhone2}
							<button
								type="button"
								class="apple-press inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-primary underline decoration-dashed underline-offset-4 hover:text-primary/80"
								onclick={() => {
									showPhone2 = true;
									void tick().then(() => document.getElementById('new-phone2')?.focus());
								}}
							>
								<Plus class="size-3.5" /> هاتف إضافي
							</button>
						{/if}
					</div>
				</div>

				<!-- Sits with the number it belongs to, folded until asked for -->
				{#if showPhone2}
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<FloatingField
								id="new-phone2"
								label="هاتف إضافي"
								type="tel"
								inputmode="tel"
								dir="ltr"
								placeholder="07XXXXXXXXX"
								bind:value={phone2}
								invalid={Boolean(phone2.trim()) && !phone2Valid}
								class="flex-1"
							/>
							<Button
								variant="ghost"
								size="icon"
								class="apple-press size-12 shrink-0 rounded-xl"
								onclick={() => {
									phone2 = '';
									showPhone2 = false;
								}}
								aria-label="إلغاء الهاتف الإضافي"
							>
								<X class="size-5" />
							</Button>
						</div>
						<p class="min-h-5 text-[13px] leading-5">
							{#if phone2.trim() && !phone2Valid}
								<span class="font-semibold text-red-600">رقم غير صحيح — مثال: 07701234567</span>
							{:else if wa2Status === 'checking'}
								<span class="text-muted-foreground">جارٍ التحقق من واتساب…</span>
							{:else if wa2Status === 'yes'}
								<span class="font-semibold text-green-600">✓ واتساب</span>
							{:else if wa2Status === 'no'}
								<span class="font-semibold text-red-600">✗ لا واتساب</span>
							{/if}
						</p>
					</div>
				{/if}

				<div class="space-y-1">
					<FloatingField
						id="new-name"
						label="اسم الزبون (اختياري)"
						placeholder={DEFAULT_NAME}
						bind:value={name}
					/>
					<p class="min-h-5 text-[13px] leading-5 text-muted-foreground">
						{#if !name.trim()}يُحفظ باسم «{DEFAULT_NAME}» إن ترك فارغاً{/if}
					</p>
				</div>

				<!-- Past-customer addresses. Sits at the foot of the section on
				     purpose: it appears 350ms after the phone is typed, so anything
				     under it moves — put it where the next thing to move is the
				     next section, not the name field being typed into. -->
				{#if lookup}
					<div class="space-y-2 rounded-2xl border border-primary/30 bg-primary/10 p-3.5 ring-1 ring-primary/20 ring-inset">
						<p class="text-sm font-extrabold text-primary">زبون سابق: {lookup.name}</p>
						{#if lookup.addresses.length}
							<p class="text-xs font-semibold text-muted-foreground">اضغط على عنوان لتعبئته:</p>
							<div class="space-y-1.5">
								{#each lookup.addresses as addr (addr.id)}
									<button
										type="button"
										onclick={() => applyAddress(addr)}
										class={cn(
											'apple-press flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-right text-sm transition-all',
											selectedAddrId === addr.id
												? 'border-primary bg-primary/15 ring-2 ring-primary'
												: 'border-border/60 bg-card/60 hover:bg-card'
										)}
									>
										<MapPin class="mt-0.5 size-4 shrink-0 text-primary" />
										<span class="flex-1">
											<span class="font-bold text-foreground">{addr.cityName}{addr.regionName ? ' — ' + addr.regionName : ''}</span>
											{#if addr.fullAddress}<span class="block text-xs text-muted-foreground">{addr.fullAddress}</span>{/if}
										</span>
										{#if selectedAddrId === addr.id}
											<Check class="mt-0.5 size-4 shrink-0 text-primary" />
										{:else if addr.isDefault}
											<span class="shrink-0 text-[10px] font-black text-primary">افتراضي</span>
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</section>

			<!-- ② Address -------------------------------------------------------- -->
			<section class="relative z-30 space-y-3 rounded-3xl border border-black/[0.08] bg-white/78 p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-white/80 ring-inset backdrop-blur-2xl dark:border-white/[0.12] dark:bg-card/75 dark:shadow-[0_4px_16px_rgba(0,0,0,0.35),0_12px_32px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:ring-white/[0.08]">
				{@render legend('2', 'العنوان والتوصيل')}

				<div class="grid grid-cols-2 gap-2">
					<div id="new-city">
						<SearchableSelect
							id="new-city-input"
							label="المدينة"
							items={cities}
							bind:value={city}
							onSelect={onCityChange}
						/>
					</div>

					<!-- Always the same control, disabled until a city is picked. -->
					<SearchableSelect
						id="new-region-input"
						label="المنطقة"
						items={regions}
						bind:value={region}
						placeholder={!city.id
							? 'اختر المدينة أولاً'
							: regionsLoading
								? 'جاري التحميل…'
								: 'ابحث…'}
						disabled={!city.id || regionsLoading || regions.length === 0}
					/>
				</div>

				<FloatingField
					id="new-address"
					label="العنوان التفصيلي"
					placeholder="المنطقة، الزقاق، الدار…"
					bind:value={address}
				/>
			</section>

			<!-- ③ Products ------------------------------------------------------- -->
			<section class="relative z-20 space-y-3 rounded-3xl border border-black/[0.08] bg-white/78 p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-white/80 ring-inset backdrop-blur-2xl dark:border-white/[0.12] dark:bg-card/75 dark:shadow-[0_4px_16px_rgba(0,0,0,0.35),0_12px_32px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:ring-white/[0.08]">
				{@render legend('3', `المنتجات (${items.length})`)}

				{#if items.length}
					<div class="space-y-2">
						{#each items as item, i (i)}
							<EditItemRow
								{item}
								onChange={(field, value) => updateItem(i, field, value)}
								onRemove={() => removeItem(i)}
							/>
						{/each}
					</div>
				{/if}

				<div class="flex items-center gap-2">
					<Button type="button" variant="outline" class="apple-press h-12 flex-1 rounded-2xl border-dashed border-primary/40 font-bold text-primary hover:bg-primary/5" onclick={addItem}>
						<Plus class="size-4" /> إضافة منتج
					</Button>
					<!-- Piece count follows the rows but stays editable -->
					<FloatingField
						id="new-items-number"
						label="القطع"
						type="number"
						inputmode="numeric"
						bind:value={itemsNumber}
						class="w-20 shrink-0"
						inputClass={cn('text-center font-bold tabular-nums', NO_SPINNER)}
					/>
				</div>
			</section>

			<!-- ④ Money ---------------------------------------------------------- -->
			<section
				class="relative z-10 space-y-3 rounded-3xl border p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-inset backdrop-blur-2xl transition-colors dark:shadow-[0_4px_16px_rgba(0,0,0,0.35),0_12px_32px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.12)]
					{autoTotal
						? 'border-emerald-500/40 bg-emerald-500/10 ring-emerald-500/20'
						: 'border-black/[0.08] bg-white/78 ring-white/80 dark:border-white/[0.12] dark:bg-card/75 dark:ring-white/[0.08]'}"
			>
				{@render legend('4', 'المبلغ والحسابات')}

				<div class="flex items-start gap-2">
					<FloatingField
						id="new-price"
						label="المجموع الكلي (د.ع)"
						type="number"
						inputmode="numeric"
						bind:value={price}
						disabled={autoTotal}
						class="flex-1"
						inputClass={cn('text-xl font-black tabular-nums disabled:opacity-100', NO_SPINNER)}
					/>
					<FloatingField
						id="new-delivery"
						label="التوصيل"
						type="number"
						inputmode="numeric"
						bind:value={delivery}
						class="w-24 shrink-0"
						inputClass={cn('tabular-nums font-bold', NO_SPINNER)}
					/>
				</div>

				<div class="flex items-center justify-between gap-2">
					<p class="min-h-5 truncate text-[13px] font-medium text-muted-foreground">
						{#if autoTotal}
							المنتجات {formatPrice(itemsTotal)} + التوصيل {formatPrice(deliveryFee)}
						{:else if items.length}
							تلقائياً {formatPrice(itemsTotal + deliveryFee)} د.ع
						{:else}
							أضف المنتجات ليُحسب المجموع تلقائياً
						{/if}
					</p>
					<label
						class={cn(
							'flex shrink-0 items-center gap-1.5 text-[13px] font-bold',
							items.length ? 'cursor-pointer text-muted-foreground' : 'text-muted-foreground/50'
						)}
					>
						<input
							type="checkbox"
							class="size-4 rounded-md accent-primary"
							bind:checked={manualTotal}
							disabled={items.length === 0}
						/>
						تعديل يدوي
					</label>
				</div>

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
			</section>

			<!-- ⑤ Options -------------------------------------------------------- -->
			<section class="relative space-y-3 rounded-3xl border border-black/[0.08] bg-white/78 p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-white/80 ring-inset backdrop-blur-2xl dark:border-white/[0.12] dark:bg-card/75 dark:shadow-[0_4px_16px_rgba(0,0,0,0.35),0_12px_32px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:ring-white/[0.08]">
				{@render legend('5', 'خيارات إضافية')}

				<!-- Routine and on by default -->
				<label class="apple-press flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card/50 p-3">
					<span class="flex min-w-0 items-center gap-2.5">
						<MessageCircle
							class={cn('size-5 shrink-0', sendWhatsapp ? 'text-emerald-600' : 'text-muted-foreground')}
						/>
						<span class="min-w-0">
							<span class="block text-sm font-bold text-foreground">إشعار واتساب للزبون</span>
							<span class="block text-[13px] text-muted-foreground">
								{sendWhatsapp
									? 'سيُرسل تأكيد الطلب للزبون'
									: 'لن يُرسل تأكيد الطلب، ولا رابط التتبع لاحقاً — يمكن تفعيله عند التجهيز'}
							</span>
						</span>
					</span>
					<Switch bind:checked={sendWhatsapp} class="shrink-0" />
				</label>

				<!-- Rare replacement -->
				<label
					class={cn(
						'apple-press flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-3 transition-colors',
						returnOrder
							? 'border-orange-500/50 bg-orange-500/10 text-orange-700 ring-1 ring-orange-500/20 ring-inset dark:text-orange-300'
							: 'border-border/50 bg-card/50 text-foreground'
					)}
				>
					<span class="flex min-w-0 items-center gap-2.5">
						<RotateCcw
							class={cn('size-5 shrink-0', returnOrder ? 'text-orange-600' : 'text-muted-foreground')}
						/>
						<span class="min-w-0">
							<span class="block text-sm font-bold text-foreground">طلب استبدال</span>
							<span class="block text-[13px] text-muted-foreground">
								عند إرجاع أو استبدال بضاعة
							</span>
						</span>
					</span>
					<Switch bind:checked={returnOrder} class="shrink-0" />
				</label>

				<!-- Printerless preprinted sticker -->
				{#if printerless}
					<div class="space-y-2 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-3.5 ring-1 ring-indigo-500/20 ring-inset">
						<div class="flex items-center gap-2 text-sm font-extrabold text-indigo-700 dark:text-indigo-300">
							🏷️ ربط ملصق مطبوع مسبقاً <span class="text-[11px] font-normal text-muted-foreground">(اختياري)</span>
						</div>
						{#if preStickerId}
							<div class="flex items-center justify-between gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-white shadow-xs">
								<span class="font-mono text-sm font-bold tabular-nums" dir="ltr">✓ {preStickerId}</span>
								<button
									type="button"
									class="apple-press text-xs font-bold underline underline-offset-2"
									onclick={() => {
										preStickerId = '';
										haptic(10);
									}}
								>
									إلغاء الربط
								</button>
							</div>
						{:else}
							<StickerScanner
								onValid={(code) => {
									preStickerId = code;
									haptic(20);
									toast.success(`تم قراءة الملصق: ${code}`);
								}}
								onReset={() => {
									preStickerId = '';
								}}
							/>
						{/if}
					</div>
				{/if}

				<!-- Notes toggle -->
				{#if showNotes}
					<div class="space-y-1.5">
						<FloatingField
							id="new-notes"
							label="ملاحظات الطلب"
							bind:value={notes}
							multiline
							rows={3}
						/>
					</div>
				{:else}
					<button
						type="button"
						class="apple-press inline-flex items-center gap-1.5 text-xs font-bold text-primary underline decoration-dashed underline-offset-4 hover:text-primary/80"
						onclick={() => {
							showNotes = true;
							void tick().then(() => document.getElementById('new-notes')?.focus());
						}}
					>
						<Plus class="size-3.5" /> إضافة ملاحظة
					</button>
				{/if}
			</section>
		</div>

		<!-- Apple Liquid Glass Action Dock (Sticky Bottom) -->
		<div
			class="sticky bottom-0 z-30 border-t border-black/10 bg-white/80 p-3.5 shadow-[0_-10px_35px_rgba(0,0,0,0.08)] ring-1 ring-black/5 ring-inset backdrop-blur-2xl backdrop-saturate-200 dark:border-white/15 dark:bg-card/85 dark:shadow-[0_-12px_40px_rgba(0,0,0,0.4)] dark:ring-white/15"
			style="padding-bottom: max(0.85rem, env(safe-area-inset-bottom));"
		>
			<div class="mx-auto flex max-w-2xl items-center justify-between gap-3">
				<div class="min-w-0 flex-1 truncate">
					<div class="text-[11px] font-bold text-muted-foreground">المجموع مع التوصيل:</div>
					<!-- Plain text on purpose. This is the amount the courier collects, and
					     the operator checks it here before saving: it has to be the value in
					     the total field, always, with no animation between it and the truth. -->
					<div class="text-2xl font-black text-foreground tabular-nums">
						{formatPrice(Number(price) || 0)} <span class="text-xs font-bold text-muted-foreground">د.ع</span>
					</div>
				</div>
				<Button
					class="apple-press h-12 shrink-0 rounded-2xl border border-emerald-400/30 bg-emerald-600 px-8 text-base font-bold text-white shadow-[0_4px_16px_rgba(16,185,129,0.35)] ring-1 ring-white/25 ring-inset transition-all hover:bg-emerald-500 active:bg-emerald-700"
					onclick={attemptSubmit}
					disabled={saving || priceInvalid}
				>
					{saving ? '…' : 'حفظ الطلب'}
				</Button>
			</div>
		</div>
	</div>

	<ConfirmDiscard
		bind:open={confirmLeave}
		onDiscard={discardAndLeave}
		title="الخروج بدون حفظ الطلب؟"
		body="الطلب لم يُحفظ بعد وسيتم فقدان ما أدخلته."
	/>
{/if}
