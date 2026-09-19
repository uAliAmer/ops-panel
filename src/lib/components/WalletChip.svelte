<script lang="ts">
	import { cn } from '$lib/utils';
	// `flat` drops the pill so this can sit as one half of the shared money chip
	// in the header; standalone it keeps its own emerald pill.
	let { flat = false }: { flat?: boolean } = $props();
	// Admin-only header chip: Alwaseet wallet per app account.
	//  - `safe`  = settled / withdrawable balance ("الرصيد القابل للسحب").
	//  - `openGross` = gross of the current open settlement batch
	//    ("المجموع الكلي للطلبات"). The carrier only reveals the fee-adjusted net
	//    after the batch settles, so we show the gross and label it as such.
	import { Button } from '$lib/components/ui/button';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Wallet, RefreshCw } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { formatPrice } from '$lib/utils/format';
	import { haptic } from '$lib/utils/haptic';
	import AnimatedNumber from '$lib/components/AnimatedNumber.svelte';

	type WalletRow = {
		key: string;
		label: string;
		ok: boolean;
		merchantName?: string;
		safe?: number;
		openGross?: number;
		openCount?: number;
		error?: string;
	};

	let open = $state(false);
	let loading = $state(false);
	let wallets = $state<WalletRow[]>([]);
	let loadedOnce = $state(false);

	// Grand total across accounts — every box in the dialog summed: withdrawable
	// («قابل للسحب») plus the open-batch gross («طلبات مفتوحة»).
	const totalSafe = $derived(
		wallets.filter((w) => w.ok).reduce((a, w) => a + (w.safe ?? 0), 0)
	);

	const totalOpenGross = $derived(
		wallets.filter((w) => w.ok).reduce((a, w) => a + (w.openGross ?? 0), 0)
	);

	const grandTotal = $derived(totalSafe + totalOpenGross);

	async function load() {
		loading = true;
		try {
			const res = await api.alwaseetWallets();
			if (res.success && res.data) wallets = res.data;
			loadedOnce = true;
		} finally {
			loading = false;
		}
	}

	function openDialog() {
		haptic(10);
		open = true;
		if (!loadedOnce) load();
	}

	// Fetch once on mount so the balance is visible in the header without opening
	// the dialog first.
	onMount(load);
</script>

<button
	type="button"
	class={flat
		? 'apple-press inline-flex h-[17px] w-full items-center gap-1.5 px-2.5 text-[11px] leading-none font-bold text-emerald-700 transition-colors hover:bg-emerald-500/15 active:bg-emerald-500/25 dark:text-emerald-300'
		: 'apple-press inline-flex h-9 items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-700 shadow-[0_2px_10px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/20 ring-inset backdrop-blur-2xl backdrop-saturate-200 transition-all hover:bg-emerald-500/25 active:bg-emerald-500/35 dark:text-emerald-300 dark:border-emerald-500/40 dark:bg-emerald-500/20'}
	aria-label="محفظة الوسيط"
	onclick={openDialog}
>
	{#if !flat}
		<span class="relative flex size-2 shrink-0">
			<span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
			<span class="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
		</span>
	{/if}
	<Wallet class={cn('shrink-0 text-emerald-600 dark:text-emerald-400', flat ? 'size-3.5' : 'size-4')} />
	{#if loadedOnce}
		<span class={cn('font-black tabular-nums leading-none', flat ? 'text-[11px]' : 'text-xs')}>
			<AnimatedNumber value={grandTotal} format={formatPrice} /> د.ع
		</span>
	{/if}
</button>

<Dialog bind:open>
	<DialogContent class="max-w-md gap-4 rounded-3xl border border-black/[0.08] bg-white/90 p-5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] ring-1 ring-white/80 ring-inset backdrop-blur-3xl backdrop-saturate-200 dark:border-white/15 dark:bg-[#18181c]/90 dark:shadow-[0_24px_70px_-15px_rgba(0,0,0,0.7)] dark:ring-white/10">
		<DialogHeader>
			<DialogTitle class="flex items-center justify-between gap-2 pe-8 text-right font-bold">
				<span class="flex items-center gap-2.5 text-base font-black tracking-tight text-foreground">
					<span class="flex size-8 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400">
						<Wallet class="size-4.5" />
					</span>
					محفظة الوسيط
				</span>
				<Button
					variant="ghost"
					size="icon"
					class="apple-press size-9 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 [&_svg]:size-4"
					aria-label="تحديث"
					disabled={loading}
					onclick={() => {
						haptic(10);
						load();
					}}
				>
					<RefreshCw class="{loading ? 'animate-spin' : ''}" />
				</Button>
			</DialogTitle>
		</DialogHeader>

		{#if loading && !loadedOnce}
			<div class="text-muted-foreground py-12 text-center text-sm font-semibold">جاري التحميل…</div>
		{:else if wallets.length === 0}
			<div class="text-muted-foreground py-12 text-center text-sm font-semibold">لا توجد حسابات مسجلة</div>
		{:else}
			<div class="flex flex-col gap-3">
				<!-- Hero Grand Summary Card -->
				<div class="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/15 to-emerald-500/5 p-4 shadow-sm ring-1 ring-emerald-500/20 ring-inset backdrop-blur-xl">
					<div class="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
						إجمالي الأرصدة (جميع الحسابات)
					</div>
					<div class="text-2xl font-black text-emerald-700 tabular-nums dark:text-emerald-300 sm:text-3xl">
						<AnimatedNumber value={grandTotal} format={formatPrice} /> <span class="text-base font-bold">د.ع</span>
					</div>
					<div class="mt-3 grid grid-cols-2 gap-2 border-t border-emerald-500/20 pt-3">
						<div>
							<span class="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">إجمالي قابل للسحب</span>
							<div class="text-base font-black text-emerald-700 tabular-nums dark:text-emerald-300">
								<AnimatedNumber value={totalSafe} format={formatPrice} />
							</div>
						</div>
						<div>
							<span class="text-muted-foreground text-[11px] font-bold">إجمالي طلبات مفتوحة</span>
							<div class="text-base font-black text-foreground tabular-nums">
								<AnimatedNumber value={totalOpenGross} format={formatPrice} />
							</div>
						</div>
					</div>
				</div>

				<!-- Individual Merchant Accounts -->
				<div class="space-y-2.5 max-h-[50vh] overflow-y-auto pe-1">
					{#each wallets as w (w.key)}
						<div class="rounded-2xl border border-black/[0.08] bg-white/70 p-3.5 shadow-xs ring-1 ring-white/60 ring-inset backdrop-blur-xl dark:border-white/10 dark:bg-card/60 dark:ring-white/10">
							<!-- Which account this money sits in is the first thing to read
							     on the card, so it is set as the heading rather than as a
							     caption over the figures. The merchant name goes underneath
							     as its own line: it was previously squeezed opposite the
							     label in `font-mono`, and a mono stack carries no Arabic, so
							     it fell back to whatever the browser had and looked unstyled
							     next to everything around it. The account key is the only
							     part that is really a code, and it is the only part that
							     stays monospaced. -->
							<div class="mb-3 flex items-start gap-2.5">
								<span
									class="mt-1 h-8 w-1 shrink-0 rounded-full {w.ok
										? 'bg-emerald-500/70'
										: 'bg-rose-500/70'}"
									aria-hidden="true"
								></span>
								<div class="min-w-0 flex-1">
									<div class="truncate text-lg font-black leading-tight text-foreground">
										{w.label}
									</div>
									{#if w.merchantName}
										<div class="text-muted-foreground mt-0.5 truncate text-xs font-semibold">
											{w.merchantName}
										</div>
									{:else}
										<div class="text-muted-foreground mt-0.5 truncate font-mono text-[11px] font-bold uppercase">
											{w.key}
										</div>
									{/if}
								</div>
							</div>
							{#if w.ok}
								<div class="grid grid-cols-2 gap-2">
									<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-center ring-1 ring-emerald-500/15 ring-inset">
										<div class="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
											قابل للسحب
										</div>
										<div class="text-base font-black text-emerald-700 tabular-nums dark:text-emerald-300">
											<AnimatedNumber value={w.safe ?? 0} format={formatPrice} />
										</div>
									</div>
									<div class="rounded-xl border border-border/50 bg-secondary/50 p-2.5 text-center ring-1 ring-white/5 ring-inset">
										<div class="text-muted-foreground text-[11px] font-extrabold">
											طلبات مفتوحة{w.openCount ? ` (${w.openCount})` : ''}
										</div>
										<div class="text-base font-black text-foreground tabular-nums">
											<AnimatedNumber value={w.openGross ?? 0} format={formatPrice} />
										</div>
									</div>
								</div>
							{:else}
								<div class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-center text-xs font-bold text-rose-600 dark:text-rose-400">
									تعذّر القراءة{w.error ? `: ${w.error}` : ''}
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<p class="text-muted-foreground text-[11px] leading-relaxed">
					«قابل للسحب» = الرصيد المُحاسب. «طلبات مفتوحة» = مجموع أسعار الطلبات في الوجبة الحالية قبل خصم أجور التوصيل.
				</p>
			</div>
		{/if}
	</DialogContent>
</Dialog>
