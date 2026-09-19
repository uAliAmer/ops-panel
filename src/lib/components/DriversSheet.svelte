<script lang="ts">
	import { Dialog, DialogContent } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { X, ArrowRight, Check, Loader2, Bike, Phone, Wallet, Receipt, ExternalLink, BellRing } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api, type LocalDriver, type DriverLedger, type DriverLedgerOrder } from '$lib/api';
	import { haptic } from '$lib/utils/haptic';
	import { whatsappHref } from '$lib/utils/phone';
	import { driverAvatar } from '$lib/utils/driverAvatar';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';

	type Props = { open: boolean; onChanged?: () => void };
	let { open = $bindable(), onChanged }: Props = $props();

	const iqd = (n: number) => (Number(n) || 0).toLocaleString('en-US');
	// "يوم الاثنين" + a short date for when the driver took the order.
	const arDay = (iso: string) => {
		try { return new Intl.DateTimeFormat('ar-IQ', { weekday: 'long' }).format(new Date(iso)); } catch { return ''; }
	};
	const arDate = (iso: string) => {
		try { return new Intl.DateTimeFormat('ar-IQ', { day: '2-digit', month: '2-digit' }).format(new Date(iso)); } catch { return ''; }
	};
	const arTime = (iso: string) => {
		try { return new Intl.DateTimeFormat('ar-IQ', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; }
	};

	// Group the settled orders into settlement batches (orders sharing a settle time).
	const settledBatches = $derived.by(() => {
		const map = new Map<string, { key: string; settledAt: string; orders: DriverLedgerOrder[]; total: number }>();
		for (const o of ledger?.settled ?? []) {
			const k = o.settledAt || 'unknown';
			if (!map.has(k)) map.set(k, { key: k, settledAt: k, orders: [], total: 0 });
			const b = map.get(k)!;
			b.orders.push(o);
			b.total += o.net;
		}
		return [...map.values()];
	});

	let drivers = $state<LocalDriver[]>([]);
	let loading = $state(false);
	// When set, we're viewing one driver's ledger instead of the list.
	let ledger = $state<DriverLedger | null>(null);
	let ledgerLoading = $state(false);
	let settling = $state(false);
	// Which orders this settlement covers. The operator ticks what the driver
	// actually handed cash back for — an order still out for delivery may be
	// ticked too, and settling it marks it delivered (the server does that).
	let selectedIds = $state<string[]>([]);
	const selectedOrders = $derived((ledger?.orders ?? []).filter((o) => selectedIds.includes(o.shipmentId)));
	const selectedTotal = $derived(selectedOrders.reduce((s, o) => s + o.net, 0));
	const selectedUndelivered = $derived(selectedOrders.filter((o) => !o.delivered));
	const toggleSelected = (id: string) => {
		selectedIds = selectedIds.includes(id)
			? selectedIds.filter((x) => x !== id)
			: [...selectedIds, id];
	};
	let pagingId = $state<string | null>(null);

	async function pageDriver(d: LocalDriver) {
		if (pagingId) return;
		pagingId = d.id;
		haptic(12);
		const t = toast.loading('جاري الاستدعاء…');
		try {
			const res = await api.pageDriver(d.id);
			if (res.success) toast.success(res.message || 'تم الاستدعاء', { id: t });
			else toast.error(res.error || 'تعذّر الاستدعاء', { id: t });
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			pagingId = null;
		}
	}
	// Ledger sub-tab: unsettled orders vs the recently-settled history.
	let ledgerTab = $state<'open' | 'settled'>('open');

	// (Re)load the directory whenever the sheet opens.
	$effect(() => {
		if (open) {
			ledger = null;
			void loadDrivers();
		}
	});

	async function loadDrivers() {
		loading = true;
		try {
			const res = await api.listLocalDrivers();
			if (res.success) {
				// Debt first — the drivers who owe money float to the top.
				drivers = (res.data ?? []).slice().sort((a, b) => (b.outstanding ?? 0) - (a.outstanding ?? 0));
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			loading = false;
		}
	}

	async function openLedger(id: string) {
		ledgerLoading = true;
		ledgerTab = 'open';
		ledger = null;
		try {
			const res = await api.driverLedger(id);
			if (res.success && res.data) {
				ledger = res.data;
				// Start on the safe set: what is already delivered. Anything still
				// in the car is an explicit tick, never a default.
				selectedIds = res.data.orders.filter((o) => o.delivered).map((o) => o.shipmentId);
			}
			else toast.error(res.error ?? 'تعذّر تحميل الحساب');
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			ledgerLoading = false;
		}
	}

	async function settle() {
		if (!ledger || selectedIds.length === 0) return;
		settling = true;
		const t = toast.loading('جاري تسوية الحساب…');
		try {
			const res = await api.settleDriver(ledger.driver.id, selectedIds);
			if (res.success) {
				const undoIds = res.data?.shipmentIds ?? [];
					const autoDelivered = res.data?.autoDeliveredIds ?? [];
					const undoDriverId = ledger.driver.id;
					const remaining = res.data?.remaining ?? 0;
					let line = `تمت تسوية ${res.data?.count ?? 0} طلب — ${iqd(res.data?.total ?? 0)} د.ع`;
					if (autoDelivered.length) line += ` · ${autoDelivered.length} عُلِّم مُسلَّماً`;
					toast.success(remaining ? `${line} · باقٍ ${iqd(remaining)} د.ع قيد التوصيل` : line, {
						id: t,
						duration: 8000,
						action: undoIds.length
							? { label: 'تراجع', onClick: () => void undoSettle(undoDriverId, undoIds, autoDelivered) }
							: undefined
					});
				haptic([15, 30]);
					await openLedger(undoDriverId); // refresh the ledger
					ledgerTab = "settled"; // show the batch + ERP invoice links for قبض
				await loadDrivers(); // and the badges
				onChanged?.(); // let the header chip refresh its total
			} else {
				toast.error(res.error ?? 'فشلت التسوية', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			settling = false;
		}
	}

	// Reverse a mis-clicked settlement (reopen those exact orders). Orders the
	// settlement itself marked delivered go back to خرج للتوصيل — reopening only
	// the money would leave the customer's tracking page claiming a delivery.
	async function undoSettle(driverId: string, ids: string[], revertDelivered: string[] = []) {
		try {
			const res = await api.unsettleDriver(driverId, ids, revertDelivered);
			if (res.success) {
				const reverted = res.data?.reverted ?? 0;
				toast.success(
					reverted ? `تم التراجع — وأُعيد ${reverted} طلب إلى «خرج للتوصيل»` : 'تم التراجع عن التسوية'
				);
				haptic(12);
				if (ledger && ledger.driver.id === driverId) await openLedger(driverId);
				await loadDrivers();
				onChanged?.();
			} else {
				toast.error(res.error ?? 'تعذّر التراجع');
			}
		} catch (err) {
			toast.error((err as Error).message);
		}
	}

	// Mark a not-yet-delivered order delivered right here (faster settlement).
	let markingId = $state<string | null>(null);
	async function markDelivered(o: DriverLedgerOrder) {
		if (!o.submissionId) return;
		markingId = o.shipmentId;
		try {
			const res = await api.localStatus(o.submissionId, 'DELIVERED');
			if (res.success) {
				toast.success('تم تعليم الطلب مُسلَّماً');
				haptic(12);
				if (ledger) await openLedger(ledger.driver.id);
				onChanged?.();
			} else {
				toast.error(res.error ?? 'تعذّر التحديث');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			markingId = null;
		}
	}

	// Open the full order (closes the sheet and navigates).
	function openOrder(o: DriverLedgerOrder) {
		const slug = (o.submissionId || '').slice(0, 8);
		if (!slug) return;
		open = false;
		void goto(`${base}/order/${slug}/`);
	}
</script>

<Dialog bind:open>
	<DialogContent
		showCloseButton={false}
		class="inset-0 top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 ring-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90vh] sm:min-h-[34rem] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
	>
		<!-- Header -->
		<div class="bg-card flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3 sm:rounded-t-3xl">
			<div class="flex min-w-0 items-center gap-2">
				{#if ledger}
					<Button variant="ghost" size="icon" class="shrink-0" onclick={() => (ledger = null)} aria-label="رجوع">
						<ArrowRight class="size-5" />
					</Button>
				{/if}
				<div class="min-w-0">
					<h2 class="truncate font-bold lg:text-lg">
						{ledger ? ledger.driver.name : 'حسابات المندوبين'}
					</h2>
					<p class="text-muted-foreground truncate text-xs">
						{ledger ? 'الطلبات غير المُسوّاة' : 'الديون والتسوية'}
					</p>
				</div>
			</div>
			<Button variant="ghost" size="icon" class="shrink-0" onclick={() => (open = false)} aria-label="إغلاق">
				<X class="size-5" />
			</Button>
		</div>

		<div class="flex-1 overflow-y-auto p-4">
			<div class="mx-auto w-full max-w-md sm:max-w-none">
				{#if ledgerLoading}
					<div class="text-muted-foreground flex items-center justify-center gap-2 py-20 text-sm">
						<Loader2 class="size-5 animate-spin" /> جاري التحميل…
					</div>
				{:else if ledger}
					<!-- ================= One driver's ledger ================= -->
					<div class="space-y-4">
						<!-- Driver + totals -->
						<div class="flex items-center gap-3 rounded-2xl border bg-muted/30 p-3">
							<img src={driverAvatar(ledger.driver.name, ledger.driver.id)} alt="" class="bg-muted ring-border size-14 shrink-0 rounded-full ring-2" />
							<div class="min-w-0 flex-1">
								<div class="truncate text-base font-bold">{ledger.driver.name}</div>
								{#if ledger.driver.phone}
									<a href={whatsappHref(ledger.driver.phone)} target="_blank" rel="noreferrer" class="text-muted-foreground flex items-center gap-1 text-xs tabular-nums" dir="ltr">
										<Phone class="size-3" /> {ledger.driver.phone}
									</a>
								{/if}
							</div>
						</div>

						<div class="grid grid-cols-2 gap-2">
							<div class="rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-3 text-center">
								<div class="text-[11px] font-bold text-amber-700 dark:text-amber-400">بذمته الآن</div>
								<div class="mt-1 text-xl font-extrabold tabular-nums text-amber-700 dark:text-amber-400" dir="ltr">{iqd(ledger.outstanding)}</div>
								<div class="text-[9px] text-amber-700/70 dark:text-amber-400/70">د.ع</div>
							</div>
							<div class="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 p-3 text-center">
								<div class="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">قابل للتسوية</div>
								<div class="mt-1 text-xl font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400" dir="ltr">{iqd(ledger.settleable)}</div>
								<div class="text-[9px] text-emerald-700/70 dark:text-emerald-400/70">{ledger.settleableCount} طلب مُسلَّم</div>
							</div>
						</div>

						<!-- Ledger tabs: unsettled vs recently-settled history -->
						<div class="flex gap-1 rounded-xl bg-muted/50 p-1">
							<button
								type="button"
								onclick={() => (ledgerTab = 'open')}
								class={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors ${ledgerTab === 'open' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
							>
								غير مُسوّاة ({ledger.orders.length})
							</button>
							<button
								type="button"
								onclick={() => (ledgerTab = 'settled')}
								class={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors ${ledgerTab === 'settled' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
							>
								مُسوّاة مؤخراً ({ledger.settled.length})
							</button>
						</div>

						<!-- Unsettled orders -->
						{#if ledgerTab === 'open'}
						{#if ledger.orders.length === 0}
							<div class="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
								<Check class="size-10 opacity-30" />
								<p class="text-sm">لا توجد طلبات غير مُسوّاة</p>
							</div>
						{:else}
							<div class="space-y-2">
								{#each ledger.orders as o (o.shipmentId)}
									<div class={`rounded-xl border p-2.5 ${selectedIds.includes(o.shipmentId) ? 'border-emerald-500/60 bg-emerald-500/10' : o.delivered ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'}`}>
										<div class="flex items-center gap-2">
										<!-- Tick what this settlement covers -->
										<button
											type="button"
											onclick={() => { haptic(8); toggleSelected(o.shipmentId); }}
											aria-label={selectedIds.includes(o.shipmentId) ? 'إلغاء تحديد الطلب' : 'تحديد الطلب للتسوية'}
											aria-pressed={selectedIds.includes(o.shipmentId)}
											class={`flex size-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${selectedIds.includes(o.shipmentId) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/30'}`}
										>
											{#if selectedIds.includes(o.shipmentId)}<Check class="size-4" />{/if}
										</button>
										<!-- Tap the row to open the full order -->
										<button type="button" onclick={() => openOrder(o)} class="flex min-w-0 flex-1 items-center gap-3 text-right">
											<div class={`flex size-8 shrink-0 items-center justify-center rounded-full ${o.delivered ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'}`}>
												{#if o.delivered}<Check class="size-4" />{:else}<Bike class="size-4" />{/if}
											</div>
											<div class="min-w-0 flex-1">
												<div class="truncate text-sm font-semibold">{o.customerName || 'عميل'} <span class="text-muted-foreground text-[10px]">#{(o.submissionId || '').slice(0, 8)}</span></div>
												<div class="text-muted-foreground truncate text-[11px]">📍 {o.address || o.cityName || '-'}</div>
												<div class="text-muted-foreground/80 truncate text-[10px]">🗓️ استلمه يوم {arDay(o.receivedAt)} {arDate(o.receivedAt)} · {o.statusName || '-'}</div>
											</div>
											<div class="shrink-0 text-end">
												<div class="text-sm font-bold tabular-nums" dir="ltr">{iqd(o.net)} <span class="text-muted-foreground text-[9px]">د.ع</span></div>
												<div class="text-muted-foreground text-[9px] tabular-nums" dir="ltr">{iqd(o.price)} − {iqd(o.fee)}</div>
											</div>
										</button>
										</div>
										{#if !o.delivered && selectedIds.includes(o.shipmentId)}
											<!-- Ticked while still in the car: the settle will deliver it. Say so
											     before the operator confirms, not after. -->
											<p class="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-center text-[10px] font-bold text-amber-700 dark:text-amber-400">
												سيُعلَّم «تم التسليم للزبون» عند التسوية
											</p>
										{/if}
										<!-- Not delivered yet → mark it delivered here without settling -->
										{#if !o.delivered}
											<button
												type="button"
												onclick={() => void markDelivered(o)}
												disabled={markingId === o.shipmentId}
												class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
											>
												<Check class="size-3.5" /> {markingId === o.shipmentId ? 'جارٍ…' : 'تم التسليم للزبون'}
											</button>
										{/if}
											{#if o.erpInvoiceUrl}
												<a href={o.erpInvoiceUrl} target="_blank" rel="noreferrer" class="text-muted-foreground mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-bold transition-colors hover:bg-muted">
													<Receipt class="size-3.5" /> فاتورة ERP <ExternalLink class="size-3" />
												</a>
											{/if}
									</div>
								{/each}
							</div>
						{/if}
						{:else}
							<!-- Settlement batches. Bookkeeping only — قبض is done in ERP by hand. -->
							<div class="mb-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
								<Receipt class="size-4 shrink-0" />
								<span>هذه التسوية للحساب فقط — لا تُنفّذ أي قبض في ERP. افتح رابط الفاتورة ونفّذ القبض يدوياً.</span>
							</div>
							{#if settledBatches.length === 0}
								<div class="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
									<Check class="size-10 opacity-30" />
									<p class="text-sm">لا توجد تسويات سابقة</p>
								</div>
							{:else}
								<div class="space-y-3">
									{#each settledBatches as b (b.key)}
										<div class="overflow-hidden rounded-2xl border">
											<div class="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
												<div class="text-xs font-bold">🧾 تسوية {arDay(b.settledAt)} {arDate(b.settledAt)} · {arTime(b.settledAt)}</div>
												<div class="text-[11px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400" dir="ltr">{iqd(b.total)} د.ع · {b.orders.length}</div>
											</div>
											<div class="divide-y">
												{#each b.orders as o (o.shipmentId)}
													<div class="flex items-center gap-2 px-2.5 py-2">
														<button type="button" onclick={() => openOrder(o)} class="min-w-0 flex-1 text-right">
															<div class="truncate text-sm font-semibold">{o.customerName || 'عميل'} <span class="text-muted-foreground text-[10px]">#{(o.submissionId || '').slice(0, 8)}</span></div>
															<div class="text-muted-foreground truncate text-[11px]">📍 {o.address || o.cityName || '-'}</div>
														</button>
														<div class="shrink-0 text-end">
															<div class="text-sm font-bold tabular-nums" dir="ltr">{iqd(o.net)} <span class="text-muted-foreground text-[9px]">د.ع</span></div>
														</div>
														{#if o.erpInvoiceUrl}
															<a href={o.erpInvoiceUrl} target="_blank" rel="noreferrer" class="text-primary border-primary/40 bg-primary/10 hover:bg-primary/20 inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition-colors" aria-label="فاتورة ERP">
																<Receipt class="size-3.5" /><ExternalLink class="size-3" />
															</a>
														{:else}
															<span class="text-muted-foreground/50 shrink-0 text-[9px]">بلا فاتورة</span>
														{/if}
													</div>
												{/each}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				{:else if loading}
					<div class="text-muted-foreground flex items-center justify-center gap-2 py-20 text-sm">
						<Loader2 class="size-5 animate-spin" /> جاري التحميل…
					</div>
				{:else if drivers.length === 0}
					<div class="text-muted-foreground flex flex-col items-center gap-2 py-20 text-center">
						<Bike class="size-12 opacity-30" />
						<p class="text-sm">لا يوجد مندوبون</p>
					</div>
				{:else}
					<!-- ================= Driver list ================= -->
					<div class="space-y-2">
						{#each drivers as d (d.id)}
							<div class="border-border bg-card flex items-center gap-2 rounded-xl border-2 p-2.5">
							<button
								type="button"
								onclick={() => openLedger(d.id)}
								class="hover:bg-muted -m-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-right transition-all active:scale-[0.99]"
							>
								<img src={driverAvatar(d.name, d.id)} alt="" class="bg-muted ring-border size-12 shrink-0 rounded-full ring-2" />
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm font-bold">{d.name}</div>
									{#if d.phone}
										<div class="text-muted-foreground truncate text-xs tabular-nums" dir="ltr">{d.phone}</div>
									{/if}
								</div>
								{#if d.outstanding}
									<span class="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-700 tabular-nums dark:text-amber-400">
										{iqd(d.outstanding)} د.ع
									</span>
								{:else}
									<span class="text-muted-foreground shrink-0 text-[11px] font-semibold">صفر</span>
								{/if}
							</button>
							{#if d.phone}
								<!-- Calling a driver in is its own errand, so it lives beside the
								     row rather than inside the ledger. -->
								<button
									type="button"
									class="apple-press flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
									aria-label="استدعاء {d.name}"
									title="استدعاء {d.name} إلى المحل"
									disabled={pagingId === d.id}
									onclick={() => void pageDriver(d)}
								>
									<BellRing class="size-4" />
								</button>
							{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Footer: settle action (ledger view only) -->
		{#if ledger}
			<div class="bg-card shrink-0 border-t p-4 sm:rounded-b-3xl" style="padding-bottom: max(1rem, env(safe-area-inset-bottom));">
				{#if selectedUndelivered.length}
					<p class="mx-auto mb-2 max-w-xl rounded-xl bg-amber-500/10 px-3 py-2 text-center text-[11px] font-bold text-amber-700 dark:text-amber-400">
						{selectedUndelivered.length} من الطلبات المحددة قيد التوصيل — ستُعلَّم «تم التسليم للزبون»
					</p>
				{/if}
				<Button
					class="mx-auto flex h-14 w-full max-w-xl items-center gap-2 bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700"
					disabled={settling || selectedIds.length === 0}
					onclick={() => void settle()}
				>
					<Wallet class="size-5" />
					{settling
						? 'جاري التسوية…'
						: selectedIds.length === 0
							? 'حدّد الطلبات المُستلَم مبلغها'
							: `تسوية ${selectedIds.length} طلب — ${iqd(selectedTotal)} د.ع`}
				</Button>
			</div>
		{/if}
	</DialogContent>
</Dialog>
