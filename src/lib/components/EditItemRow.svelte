<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { X, Gift, Package, ChevronDown, Warehouse, Minus, Plus } from '@lucide/svelte';
	import { api, type OrderItem, type Product, type ErpPriceTier } from '$lib/api';
	import { cn, NO_SPINNER } from '$lib/utils';
	import { formatPrice } from '$lib/utils/format';
	import { resolveImage } from '$lib/utils/image';
	import { haptic } from '$lib/utils/haptic';

	type Props = {
		item: OrderItem;
		onChange: (field: keyof OrderItem, value: unknown) => void;
		onRemove: () => void;
	};
	let { item, onChange, onRemove }: Props = $props();

	const imgSrc = $derived(resolveImage(item.imageUrl));

	let results = $state<Product[]>([]);
	let showSuggestions = $state(false);
	let rowEl: HTMLDivElement | undefined = $state();
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let erpTimer: ReturnType<typeof setTimeout> | null = null;

	// ---- what the warehouse says about this SKU ------------------------------
	// One ERP read (~350ms) answers both questions the row asks: how many units
	// exist, and what the sell tiers are — مفرد, جمله, توزيع, اخرى plus any live
	// خصم offer. So it is fetched once per SKU and shared by the stock line and
	// the price picker; opening the picker on a row already stocked-checked
	// costs nothing.
	//
	// It runs when a product is picked from the suggestions menu, when the price
	// picker is opened, and when a hand-typed code settles — typing stopped,
	// Enter, or the field lost focus. Not on every keystroke: that would be an
	// ERP round trip for a code still half-written.
	//
	// The hand-typed case is the one the storefront cannot serve at all: plenty
	// of stock ids are never published to Genelog, so searching "53-23" there
	// returns nothing and the row would stay nameless. The ERP knows it, so its
	// name fills the empty row along with the stock and the tiers.
	let tiers = $state<ErpPriceTier[]>([]);
	let branches = $state<Array<{ name: string; qty: number }>>([]);
	let stockTotal = $state<number | null>(null);
	let erpSku = $state('');
	let erpLoading = $state(false);
	let erpError = $state('');
	let showTiers = $state(false);
	let erpName = $state('');

	const sku = $derived((item.sku ?? '').trim());
	const hasSku = $derived(Boolean(sku));
	// Only ever describe the SKU currently in the row: retyping the code leaves
	// the previous product's numbers on screen otherwise.
	const erpFresh = $derived(erpSku !== '' && erpSku === sku);

	// Stock status of the current SKU, for the row's leading-edge color:
	//   in = the warehouse holds units somewhere · out = zero everywhere ·
	//   unknown = not looked up yet (most rows on a phone).
	const stockState = $derived(
		!erpFresh || stockTotal === null
			? 'unknown'
			: stockTotal > 0 || branches.some((b) => b.qty > 0)
				? 'in'
				: 'out'
	);

	const qty = $derived(Number(item.quantity) || 1);
	function bumpQty(delta: number) {
		onChange('quantity', Math.max(1, qty + delta));
		haptic(8);
	}

	// The last name this row wrote into the name box itself. A name still equal to
	// it is the warehouse's answer for the *previous* code and may be replaced;
	// anything else was typed or chosen by the operator and is left alone.
	let autoName = $state('');

	// Same idea for the picture: one we filled in for an earlier SKU is ours to
	// replace, one that came with a product picked from the menu is not.
	let autoImage = $state('');

	function nameIsOurs() {
		const current = (item.name ?? '').trim();
		return current === '' || current === autoName;
	}

	async function loadErp(target: string) {
		const wanted = target.trim();
		if (!wanted) return;
		// Same SKU, already answered — either with numbers or with a reason.
		if (erpSku === wanted && (stockTotal !== null || erpError)) return;

		erpSku = wanted;
		tiers = [];
		branches = [];
		stockTotal = null;
		erpError = '';
		erpName = '';
		erpLoading = true;
		try {
			const res = await api.erpProduct(wanted);
			// The SKU may have been retyped while the ERP was answering; that
			// request now describes a different product, so drop it.
			if (erpSku !== wanted) return;
			if (res.success && res.found) {
				tiers = res.prices ?? [];
				branches = res.branches ?? [];
				stockTotal = res.total ?? 0;
				erpName = res.erpName ?? '';
				// Default the price to the مفرد (retail) tier so a freshly-entered
				// item isn't left at zero. Only when the row has no price yet — a
				// storefront pick or a hand-set price is never overwritten.
				if (!(Number(item.unitPrice) > 0)) {
					const retail = tiers.find((t) => (t.label ?? '').includes('مفرد')) ?? tiers[0];
					if (retail && retail.price > 0) onChange('unitPrice', retail.price);
				}
				// Warehouse shorthand, but a named row beats an empty one — and it
				// is the only name a stock id outside the storefront has.
				if (erpName && nameIsOurs()) {
					onChange('name', erpName);
					autoName = erpName;
				}
				// The ERP carries no images, so a hand-typed SKU would otherwise
				// save a picture-less line: take the storefront's, which the
				// backend matched on this exact code.
				const current = (item.imageUrl ?? '').trim();
				if (res.imageUrl && (current === '' || current === autoImage)) {
					onChange('imageUrl', res.imageUrl);
					autoImage = res.imageUrl;
				}
			} else {
				erpError = res.error || 'غير موجود في المخزن';
				// The name we put there describes a different product now, and a
				// wrong name is worse than none: it is what prints on the label.
				if (autoName && item.name === autoName) {
					onChange('name', '');
					autoName = '';
				}
				if (autoImage && item.imageUrl === autoImage) {
					onChange('imageUrl', undefined);
					autoImage = '';
				}
			}
		} catch {
			if (erpSku === wanted) erpError = 'تعذر قراءة المخزن';
		} finally {
			if (erpSku === wanted) erpLoading = false;
		}
	}

	function openTiers() {
		// Nothing to ask the ERP about — the row is priced by hand.
		if (!sku) return;
		showSuggestions = false;
		showTiers = true;
		void loadErp(sku);
	}

	function pickTier(tier: ErpPriceTier) {
		onChange('unitPrice', tier.price);
		showTiers = false;
	}

	function onNameInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		showTiers = false;
		// Typed over — the name is the operator's from here on.
		autoName = '';
		onChange('name', value);
		runSearch(value);
	}

	// The SKU is free text: ERP stock ids that aren't published in the storefront
	// never show up in the product search, so whatever is typed is kept as-is.
	// The search still runs on it as a convenience — picking a hit fills the row.
	function onSkuInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		showTiers = false;
		onChange('sku', value);
		runSearch(value);
		scheduleErp(value);
	}

	// Typing stopping is the signal that actually arrives on a phone. Blur was
	// not enough on its own: tapping empty space does not blur an input on a
	// touch keyboard, so the lookup sat waiting for another field to be tapped.
	//
	// Longer than the storefront search's 400ms — a code is a few characters and
	// a pause inside one is common, and the wrong guess here costs an ERP read
	// rather than a local request.
	function scheduleErp(value: string) {
		if (erpTimer) clearTimeout(erpTimer);
		const wanted = value.trim();
		if (wanted.length < 2) return;
		erpTimer = setTimeout(() => void loadErp(wanted), 900);
	}

	// Enter, and leaving the field, both mean the code is finished — no reason to
	// sit out the rest of the timer.
	function onSkuKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		if (erpTimer) clearTimeout(erpTimer);
		void loadErp(sku);
	}

	// The suggestions list is the exception: a tap on a suggestion blurs the
	// input before it lands, and that half-typed code is not the one they meant.
	function onSkuBlur() {
		if (showSuggestions) return;
		if (erpTimer) clearTimeout(erpTimer);
		void loadErp(sku);
	}

	function runSearch(value: string) {
		if (searchTimer) clearTimeout(searchTimer);
		if (!value || value.length < 2) {
			results = [];
			showSuggestions = false;
			return;
		}
		searchTimer = setTimeout(async () => {
			try {
				const res = await api.searchProducts(value);
				if (res.success && res.products?.length) {
					const q = value.toLowerCase().trim();
					results = [...res.products].sort((a, b) => {
						const an = (a.name || '').toLowerCase();
						const as_ = (a.sku || '').toLowerCase();
						const bn = (b.name || '').toLowerCase();
						const bs = (b.sku || '').toLowerCase();
						const aExact = an === q || as_ === q;
						const bExact = bn === q || bs === q;
						if (aExact && !bExact) return -1;
						if (!aExact && bExact) return 1;
						const aPref = an.startsWith(q) || as_.startsWith(q);
						const bPref = bn.startsWith(q) || bs.startsWith(q);
						if (aPref && !bPref) return -1;
						if (!aPref && bPref) return 1;
						return 0;
					});
					showSuggestions = true;
				} else {
					results = [];
					showSuggestions = false;
				}
			} catch {
				results = [];
				showSuggestions = false;
			}
		}, 400);
	}

	function pickProduct(p: Product) {
		// A name chosen from the menu is deliberate; the ERP must not replace it.
		autoName = '';
		onChange('name', p.name);
		onChange('unitPrice', p.price);
		onChange('sku', p.sku || '');
		onChange('imageUrl', p.imageUrl ?? undefined);
		showSuggestions = false;
		// A product chosen from the menu is a settled SKU, so this is the one
		// moment worth spending an ERP round trip on: the operator sees what the
		// warehouse holds before deciding the quantity.
		if (p.sku) void loadErp(p.sku);
	}

	function handleClick(event: MouseEvent) {
		if (rowEl && !rowEl.contains(event.target as Node)) {
			showSuggestions = false;
			showTiers = false;
		}
	}

	// A row deleted mid-typing must not still go and ask the ERP about it.
	$effect(() => () => {
		if (erpTimer) clearTimeout(erpTimer);
		if (searchTimer) clearTimeout(searchTimer);
	});

	$effect(() => {
		if (showSuggestions || showTiers) {
			document.addEventListener('click', handleClick);
			return () => document.removeEventListener('click', handleClick);
		}
	});
</script>

<div
	class={cn(
		'bg-muted/40 relative rounded-lg border border-s-4 p-1.5 transition-colors',
		(showSuggestions || showTiers) ? 'z-50' : 'z-0',
		stockState === 'in' && 'border-s-emerald-500',
		stockState === 'out' && 'border-s-red-500',
		stockState === 'unknown' && 'border-s-border'
	)}
	bind:this={rowEl}
>
	<!-- One line, reading right to left: image, code, name, quantity, price,
	     delete. Everything but the name is fixed-width and trimmed to the
	     narrowest that still shows its content, so the name keeps the remainder. -->
	<div class="flex items-center gap-1.5">
		<div class="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md">
			{#if imgSrc}
				<img src={imgSrc} alt="" class="size-full object-cover" />
			{:else}
				<Package class="text-muted-foreground size-4" />
			{/if}
		</div>
		<!-- data-item-sku, not the placeholder, is what the page focuses after
		     adding a row — the placeholder text is copy and has changed once. -->
		<Input
			data-item-sku=""
			value={item.sku ?? ''}
			oninput={onSkuInput}
			placeholder="الرمز"
			class="bg-background dark:bg-background h-9 w-16 shrink-0 px-1.5 text-center text-sm"
			onfocus={(e) => (e.target as HTMLInputElement).select()}
			onblur={onSkuBlur}
			onkeydown={onSkuKeydown}
		/>
		<Input
			value={item.name ?? ''}
			oninput={onNameInput}
			class="bg-background dark:bg-background h-9 min-w-0 flex-1 px-2 text-sm"
			placeholder="المنتج"
			onfocus={(e) => (e.target as HTMLInputElement).select()}
		/>
		<!-- Qty as a −/+ stepper: taps beat the keyboard on a phone, and the count
		     reads at a glance. -->
		<div class="bg-background dark:bg-background flex h-9 shrink-0 items-center rounded-md border">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground grid h-full w-7 place-items-center active:scale-90 disabled:opacity-40"
				onclick={() => bumpQty(-1)}
				disabled={qty <= 1}
				aria-label="إنقاص"
				tabindex={-1}
			>
				<Minus class="size-3.5" />
			</button>
			<span class="w-5 text-center text-sm font-bold tabular-nums">{qty}</span>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground grid h-full w-7 place-items-center active:scale-90"
				onclick={() => bumpQty(1)}
				aria-label="زيادة"
				tabindex={-1}
			>
				<Plus class="size-3.5" />
			</button>
		</div>
		<!-- Tapping the price opens the ERP's own tier list for this SKU, the way
		     the ERP's price box does. Typing over it still wins: a hand-agreed
		     price is not one of the tiers. The caret is a hint only — it never
		     takes the tap, so the field stays a plain number input. -->
		<div class="relative shrink-0">
			<Input
				type="number"
				inputmode="numeric"
				class={cn(
					'bg-background dark:bg-background h-9 w-16 px-1 text-center text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400',
					NO_SPINNER
				)}
				value={item.unitPrice ?? 0}
				oninput={(e) => onChange('unitPrice', Number((e.target as HTMLInputElement).value) || 0)}
				placeholder="السعر"
				onfocus={(e) => (e.target as HTMLInputElement).select()}
				onclick={() => (showTiers ? (showTiers = false) : openTiers())}
			/>
			{#if hasSku}
				<ChevronDown
					class="text-muted-foreground pointer-events-none absolute bottom-0.5 end-0.5 size-3"
				/>
			{/if}
		</div>
		<Button
			variant="ghost"
			size="icon"
			class="size-8 shrink-0"
			onclick={onRemove}
			aria-label="حذف"
			tabindex={-1}
		>
			<X class="size-4" />
		</Button>
	</div>

	<!-- What the warehouse holds, once the row has a settled SKU. Appears only
	     after the ERP has actually been asked — a row nobody looked up stays a
	     single line, which is most of them on a phone. -->
	{#if erpFresh && (erpLoading || erpError || stockTotal !== null)}
		<div class="flex items-center gap-1.5 px-1 pb-0.5 pt-1 text-[11px]">
			{#if erpLoading}
				<span class="text-muted-foreground">جاري قراءة المخزن…</span>
			{:else if erpError}
				<span class="text-muted-foreground">{erpError}</span>
			{:else if stockState === 'out'}
				<span class="size-2 shrink-0 rounded-full bg-red-500"></span>
				<span class="font-bold text-red-600 dark:text-red-400">نفذ المخزون</span>
			{:else}
				<span class="size-2 shrink-0 rounded-full bg-emerald-500"></span>
				<Warehouse class="text-muted-foreground size-3 shrink-0" />
				<!-- Per branch only, no sum: an order ships from one branch, so where
				     the units are is the answer — the total never was. Empty branches
				     stay on the line in red; "0 in بابلون" is information. -->
				<span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
					{#each branches as branch (branch.name)}
						<span class="whitespace-nowrap">
							<span class="text-muted-foreground">{branch.name}:</span>
							<span
								class={cn(
									'font-semibold tabular-nums',
									branch.qty > 0 ? 'text-emerald-600' : 'text-red-600'
								)}>{branch.qty}</span
							>
						</span>
					{/each}
				</span>
			{/if}
		</div>
	{/if}

	{#if showTiers}
		<div
			class="bg-popover absolute end-0 start-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border/80 p-1 shadow-2xl backdrop-blur-2xl ring-1 ring-black/10 dark:ring-white/15"
		>
			{#if erpLoading}
				<div class="text-muted-foreground px-3 py-2 text-xs">جاري قراءة الأسعار…</div>
			{:else if erpError}
				<div class="text-muted-foreground px-3 py-2 text-xs">{erpError}</div>
			{:else if !tiers.length}
				<div class="text-muted-foreground px-3 py-2 text-xs">لا توجد أسعار في المخزن</div>
			{:else}
				{#if erpName}
					<!-- The warehouse's own name for the SKU: the operator's check that
					     the code they typed found the product they meant. -->
					<div class="text-muted-foreground truncate px-2 py-1 text-[11px]">{erpName}</div>
				{/if}
				{#each tiers as tier (tier.label + tier.price)}
					{@const active = Number(item.unitPrice) === tier.price}
					<button
						type="button"
						class={cn(
							'hover:bg-accent flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-right',
							active && 'bg-accent'
						)}
						onclick={() => pickTier(tier)}
					>
						<span class="truncate text-sm font-medium">{tier.label}</span>
						<span class={cn('shrink-0 text-sm tabular-nums', active && 'text-primary font-bold')}>
							{formatPrice(tier.price)} د.ع
						</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	{#if showSuggestions && results.length > 0}
		<div
			class="bg-popover absolute end-0 start-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border/80 shadow-2xl backdrop-blur-2xl ring-1 ring-black/10 dark:ring-white/15"
		>
			{#each results as p (p.sku || p.name)}
				<button
					type="button"
					class="hover:bg-accent flex w-full items-center justify-between gap-2 px-3 py-2 text-right"
					onclick={() => pickProduct(p)}
				>
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium">{p.name}</div>
						{#if p.sku}
							<div class="text-muted-foreground truncate text-xs">{p.sku}</div>
						{/if}
					</div>
					<div class="shrink-0 text-xs">
						{#if Number(p.price) > 0}
							{formatPrice(p.price)} د.ع
						{:else}
							<span class="inline-flex items-center gap-1 text-emerald-600">
								<Gift class="size-3" /> مجاني
							</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
