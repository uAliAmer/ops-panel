<script lang="ts">
	/**
	 * تسوية الوسيط — matching one Alwaseet settlement batch against the ERP.
	 *
	 * The manual job this replaces: open the carrier app, copy each order id,
	 * search it in the ERP, compare the total, record the payment. Everything
	 * except the last step happens here; the payment is still recorded in the
	 * ERP itself, which has no payments endpoint (see settlement.js).
	 *
	 * Nothing on this screen is stored by us. The carrier owns the batch's
	 * receipt state and the ERP owns each invoice's paid/due, so both are read
	 * live — this page never becomes a third opinion about money.
	 *
	 * Finance-only: the backend gates every call on a FINANCE_EMAILS allowlist
	 * and the entry point is hidden unless `user.finance` says so. The hiding is
	 * cosmetic; the 403 is the actual gate.
	 */
	import { onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { Toaster } from '$lib/components/ui/sonner';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import {
		ArrowRight,
		RefreshCw,
		Loader2,
		Receipt,
		ExternalLink,
		Copy,
		Check,
		CircleAlert,
		CornerUpLeft,
		Lock,
		FileText,
		PackageSearch,
		Bookmark
	} from '@lucide/svelte';
	import AnimatedNumber from '$lib/components/AnimatedNumber.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import {
		api,
		HttpError,
		type SettlementInvoice,
		type SettlementDetail,
		type SettlementLine,
		type SettlementVerdict
	} from '$lib/api';
	import { formatPrice } from '$lib/utils/format';
	import { haptic } from '$lib/utils/haptic';
	import { orderSlug } from '$lib/utils/orderSlug';

	let invoices = $state<SettlementInvoice[]>([]);
	let listTotals = $state<{ count: number; merchantPrice: number; pendingCount: number; pendingAmount: number } | null>(null);
	let loadingList = $state(true);
	let listError = $state<string | null>(null);

	let selectedId = $state<string | null>(null);
	let detail = $state<SettlementDetail | null>(null);
	let loadingDetail = $state(false);
	let detailError = $state<string | null>(null);

	type Filter = 'all' | 'toRecord' | 'paid' | 'attention' | 'returned';
	let filter = $state<Filter>('all');

	/**
	 * Where the operator got to. Recording a payment happens in the ERP, in
	 * another tab, so the walk through a batch is constantly interrupted — and
	 * coming back to a list of 26 near-identical rows means counting from the
	 * top again.
	 *
	 * Kept in localStorage, per batch: this is a trail through a screen, not a
	 * fact about money, and it must survive a reload without a round trip. The
	 * ERP stays the authority on what is actually paid — a mark here only says
	 * "I opened this one", and it is dropped the moment the ERP confirms the
	 * payment (due 0), so the two can never drift into disagreeing.
	 */
	type Progress = { last?: string; marked: string[] };
	const progressKey = (invoiceId: string) => `settlement:progress:${invoiceId}`;
	let progress = $state<Progress>({ marked: [] });

	function loadProgress(invoiceId: string) {
		try {
			const raw = localStorage.getItem(progressKey(invoiceId));
			const parsed = raw ? JSON.parse(raw) : null;
			progress = {
				last: typeof parsed?.last === 'string' ? parsed.last : undefined,
				marked: Array.isArray(parsed?.marked) ? parsed.marked.filter((x: unknown) => typeof x === 'string') : []
			};
		} catch {
			progress = { marked: [] };
		}
	}

	function saveProgress(invoiceId: string) {
		try {
			localStorage.setItem(progressKey(invoiceId), JSON.stringify(progress));
		} catch {
			/* private window / storage full — the trail is a convenience */
		}
	}

	/** Called when the operator leaves for the ERP to record this line. */
	function markOpened(line: SettlementLine) {
		if (!selectedId) return;
		progress = {
			last: line.orderId,
			marked: progress.marked.includes(line.orderId)
				? progress.marked
				: [...progress.marked, line.orderId]
		};
		saveProgress(selectedId);
	}

	/** Marks the ERP has since confirmed are noise — drop them on every reload. */
	function pruneProgress(d: SettlementDetail, invoiceId: string) {
		const stillOpen = new Set(
			d.lines.filter((l) => PAYABLE.includes(l.verdict)).map((l) => l.orderId)
		);
		const kept = progress.marked.filter((id) => stillOpen.has(id));
		if (kept.length !== progress.marked.length) {
			progress = { ...progress, marked: kept };
			saveProgress(invoiceId);
		}
	}

	const PAYABLE: SettlementVerdict[] = ['MATCH', 'MATCH_ABSORBED', 'DELIVERY_GAP'];

	/** Opened in the ERP but not yet confirmed paid there. */
	const pendingMarks = $derived(
		(detail?.lines ?? []).filter(
			(l) => PAYABLE.includes(l.verdict) && progress.marked.includes(l.orderId)
		)
	);

	/** Payable rows the operator has not opened yet — the actual work left. */
	const untouched = $derived(
		(detail?.lines ?? []).filter(
			(l) => PAYABLE.includes(l.verdict) && !progress.marked.includes(l.orderId)
		)
	);

	let highlighted = $state<string | null>(null);
	let highlightTimer: ReturnType<typeof setTimeout> | null = null;

	function jumpTo(orderId: string, { flash = true }: { flash?: boolean } = {}) {
		const el = document.getElementById(`line-${orderId}`);
		if (!el) return false;
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		if (flash) {
			highlighted = orderId;
			if (highlightTimer) clearTimeout(highlightTimer);
			highlightTimer = setTimeout(() => (highlighted = null), 2400);
		}
		return true;
	}

	/** The next row to work on: first untouched payable, else the first pending. */
	function jumpToNext() {
		haptic(10);
		const target = untouched[0] ?? pendingMarks[0];
		if (!target) return;
		// Filters hide rows; a jump into a hidden one silently does nothing.
		if (!['all', 'toRecord'].includes(filter)) filter = 'toRecord';
		tick().then(() => jumpTo(target.orderId));
	}

	let refreshingQuietly = $state(false);
	let confirmReceive = $state(false);
	let receiving = $state(false);
	let copied = $state<string | null>(null);

	const denied = $derived(auth.user ? auth.user.finance !== true : false);

	/**
	 * Verdict vocabulary. `action` is the sentence an operator reads when they
	 * are deciding what to do with the row, so it says what to DO, not what the
	 * row is.
	 */
	const VERDICTS: Record<SettlementVerdict, { label: string; tone: string; action: string }> = {
		MATCH: {
			label: 'مطابقة — سجّل الدفعة',
			tone: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
			action: 'المبلغ مطابق للـERP والفاتورة غير مدفوعة — افتحها وسجّل التسديد.'
		},
		MATCH_ABSORBED: {
			label: 'مطابقة — التوصيل علينا',
			tone: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
			action: 'فاتورة الـERP تساوي ما دفعه الزبون، وأجرة التوصيل خُصمت من حصتنا — سجّل التسديد.'
		},
		DELIVERY_GAP: {
			label: 'مطابقة — فرق توصيل',
			tone: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
			action: 'الوسيط خصم أجرة توصيل أعلى مما حُسب على الزبون — الفرق علينا. سجّل التسديد.'
		},
		PAID: {
			label: 'مدفوعة',
			tone: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
			action: 'مسجّلة كمدفوعة في الـERP. لا يوجد إجراء.'
		},
		MISMATCH: {
			label: 'فرق بالمبلغ',
			tone: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
			action: 'صافي الوسيط لا يساوي مجموع فاتورة الـERP — راجع قبل التسديد.'
		},
		RETURNED: {
			label: 'راجع',
			tone: 'border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300',
			action: 'طلب راجع: الوسيط يخصم أجرة التوصيل فقط، ولا دفعة في الـERP.'
		},
		NO_ERP: {
			label: 'بلا فاتورة ERP',
			tone: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
			action: 'الطلب لم تُنشأ له فاتورة في الـERP — أنشئها أو سجّلها يدوياً.'
		},
		ERP_LEGACY: {
			label: 'فاتورة قديمة',
			tone: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
			action: 'فاتورة من الطريقة القديمة لا يقرأها الـAPI — افتحها من الرابط أدناه وقارن الصافي بنفسك.'
		},
		ERP_MISSING: {
			label: 'فاتورة غير موجودة',
			tone: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
			action: 'رقم الفاتورة محفوظ عندنا لكن الـERP لا يعرفه.'
		},
		ERP_ERROR: {
			label: 'تعذّرت قراءة الـERP',
			tone: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
			action: 'فشل الاتصال بالـERP لهذه الفاتورة — أعد التحديث.'
		},
		ERP_CANCELLED: {
			label: 'فاتورة ملغاة',
			tone: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
			action: 'الفاتورة ملغاة في الـERP بينما الوسيط يدفع عنها.'
		},
		UNKNOWN_ORDER: {
			label: 'طلب خارج النظام',
			tone: 'border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300',
			action: 'هذا الطلب لم يُرسل من النظام — ابحث عنه في الـERP يدوياً.'
		}
	};

	const ATTENTION: SettlementVerdict[] = [
		'MISMATCH',
		'ERP_MISSING',
		'ERP_ERROR',
		'ERP_CANCELLED',
		'NO_ERP',
		'ERP_LEGACY',
		'UNKNOWN_ORDER'
	];

	const visibleLines = $derived.by(() => {
		const lines = detail?.lines ?? [];
		if (filter === 'toRecord')
			return lines.filter((l) =>
				['MATCH', 'MATCH_ABSORBED', 'DELIVERY_GAP'].includes(l.verdict)
			);
		if (filter === 'paid') return lines.filter((l) => l.verdict === 'PAID');
		if (filter === 'returned') return lines.filter((l) => l.verdict === 'RETURNED');
		if (filter === 'attention') return lines.filter((l) => ATTENTION.includes(l.verdict));
		return lines;
	});

	/** The carrier header is the number to trust; ours is the same sum recomputed. */
	const headerGap = $derived(
		detail ? detail.totals.net - detail.invoice.merchantPrice : 0
	);

	async function loadList() {
		loadingList = true;
		listError = null;
		try {
			const res = await api.settlementInvoices();
			if (res.success && res.data) {
				invoices = res.data.invoices;
				listTotals = res.data.totals;
			} else {
				listError = res.error ?? 'تعذّر جلب الفواتير';
			}
		} catch (e) {
			listError = e instanceof HttpError ? e.message : 'تعذّر الاتصال بالخادم';
		} finally {
			loadingList = false;
		}
	}

	async function openInvoice(id: string) {
		haptic(12);
		selectedId = id;
		detail = null;
		filter = 'all';
		loadProgress(id);
		await loadDetail(id);
	}

	/**
	 * `silent` is the refresh that runs on its own — on coming back to the tab,
	 * and while a row is waiting for the ERP to confirm it. It must not move the
	 * page under the operator: no spinner in place of the list, and no jumping
	 * back to the bookmark they may have just scrolled away from.
	 */
	async function loadDetail(id: string, { silent = false, fresh = false } = {}) {
		if (silent) refreshingQuietly = true;
		else loadingDetail = true;
		if (!silent) detailError = null;
		try {
			const res = await api.settlementInvoice(id, { fresh });
			if (res.success && res.data) {
				const before = pendingMarks.length;
				detail = res.data;
				pruneProgress(res.data, id);
				if (silent) {
					// Say so when the ERP has caught up, since nothing else moved.
					const cleared = before - pendingMarks.length;
					if (cleared > 0) {
						haptic(12);
						toast.success(
							cleared === 1 ? 'تم تأكيد تسديد طلب' : `تم تأكيد تسديد ${cleared} طلبات`
						);
					}
				} else if (progress.last) {
					// Land back where the work stopped rather than at the top of 26 rows.
					const last = progress.last;
					void tick().then(() => jumpTo(last));
				}
			} else if (!silent) {
				detailError = res.error ?? 'تعذّر جلب طلبات الفاتورة';
			}
		} catch (e) {
			if (!silent) detailError = e instanceof HttpError ? e.message : 'تعذّر الاتصال بالخادم';
		} finally {
			loadingDetail = false;
			refreshingQuietly = false;
		}
	}

	function backToList() {
		haptic(10);
		selectedId = null;
		detail = null;
		detailError = null;
	}

	async function doReceive() {
		if (!selectedId) return;
		receiving = true;
		try {
			const res = await api.settlementReceive(selectedId);
			if (res.success) {
				toast.success(res.message || 'تم تأكيد استلام الفاتورة');
				confirmReceive = false;
				await Promise.all([loadDetail(selectedId), loadList()]);
			} else {
				toast.error(res.error ?? 'فشل تأكيد الاستلام');
			}
		} catch (e) {
			toast.error(e instanceof HttpError ? e.message : 'تعذّر الاتصال بالخادم');
		} finally {
			receiving = false;
		}
	}

	async function copy(text: string) {
		haptic(8);
		try {
			await navigator.clipboard.writeText(text);
			copied = text;
			setTimeout(() => (copied = copied === text ? null : copied), 1200);
		} catch {
			toast.error('تعذّر النسخ');
		}
	}

	function orderHref(line: SettlementLine): string | null {
		if (!line.order?.id) return null;
		return `${base}/order/${orderSlug({
			idempotencyKey: line.order.idempotencyKey,
			submissionId: line.order.submissionId,
			id: line.order.id
		} as never)}/`;
	}

	/**
	 * Coming back from the ERP is the moment the answer changed, so that is when
	 * the screen re-reads itself — a returning tab, or a poll while a row is
	 * still waiting for confirmation. The poll stops when nothing is pending and
	 * while the tab is hidden, so an abandoned tab costs the ERP nothing.
	 */
	onMount(() => {
		void loadList();

		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			if (selectedId && !loadingDetail && !refreshingQuietly) {
				void loadDetail(selectedId, { silent: true });
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		window.addEventListener('focus', onVisible);

		const poll = setInterval(() => {
			if (document.visibilityState !== 'visible') return;
			if (!selectedId || loadingDetail || refreshingQuietly) return;
			if (pendingMarks.length === 0) return;
			void loadDetail(selectedId, { silent: true });
		}, 10_000);

		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('focus', onVisible);
			clearInterval(poll);
			if (highlightTimer) clearTimeout(highlightTimer);
		};
	});
</script>

<svelte:head><title>تسوية الوسيط</title></svelte:head>

<Toaster position="top-center" richColors />

<div class="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-24 pt-[max(0.75rem,env(safe-area-inset-top))]">
	<!-- Header: back to orders, title, refresh -->
	<div class="mb-3 flex items-center gap-2">
		<button
			type="button"
			class="apple-press border-border/50 bg-card/70 flex size-10 shrink-0 items-center justify-center rounded-full border backdrop-blur-xl transition active:scale-95"
			aria-label="رجوع"
			onclick={() => (selectedId ? backToList() : goto(`${base}/`))}
		>
			<ArrowRight class="size-5" />
		</button>
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-base font-black tracking-tight">تسوية الوسيط</h1>
			<p class="text-muted-foreground truncate text-[11px] font-semibold">
				{selectedId ? `فاتورة #${selectedId}` : 'مطابقة دفعات الوسيط مع فواتير الـERP'}
			</p>
		</div>
		<button
			type="button"
			class="apple-press border-border/50 bg-card/70 flex size-10 shrink-0 items-center justify-center rounded-full border backdrop-blur-xl transition active:scale-95"
			aria-label="تحديث"
			onclick={() => {
				haptic(12);
				selectedId ? loadDetail(selectedId, { fresh: true }) : loadList();
			}}
		>
			<RefreshCw
				class="size-5 {loadingList || loadingDetail || refreshingQuietly ? 'animate-spin' : ''}"
			/>
		</button>
	</div>

	{#if denied}
		<div class="border-border/50 bg-card/60 mt-10 flex flex-col items-center gap-3 rounded-3xl border p-8 text-center backdrop-blur-xl">
			<Lock class="text-muted-foreground size-8" />
			<p class="text-sm font-bold">هذه الصفحة خاصة بالحساب المالي.</p>
			<Button variant="outline" onclick={() => goto(`${base}/`)}>رجوع للطلبات</Button>
		</div>

	<!-- ============================ Batch list ============================ -->
	{:else if !selectedId}
		{#if listTotals && !loadingList}
			<div class="mb-3 grid grid-cols-2 gap-2">
				<div class="border-border/50 bg-card/60 rounded-2xl border p-3 backdrop-blur-xl">
					<div class="text-muted-foreground text-[11px] font-bold">مجموع الفواتير</div>
					<div class="text-base font-black tabular-nums">
						<AnimatedNumber value={listTotals.merchantPrice} format={formatPrice} /> د.ع
					</div>
				</div>
				<div class="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 backdrop-blur-xl">
					<div class="text-[11px] font-bold text-amber-700 dark:text-amber-300">بانتظار الاستلام</div>
					<div class="text-base font-black tabular-nums text-amber-700 dark:text-amber-300">
						<AnimatedNumber value={listTotals.pendingAmount} format={formatPrice} /> د.ع
						<span class="text-[11px] font-bold">({listTotals.pendingCount})</span>
					</div>
				</div>
			</div>
		{/if}

		{#if loadingList}
			<div class="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm font-semibold">
				<Loader2 class="size-4 animate-spin" /> جاري تحميل فواتير الوسيط…
			</div>
		{:else if listError}
			<div class="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-4 text-sm font-bold text-rose-700 dark:text-rose-300">
				{listError}
			</div>
		{:else if invoices.length === 0}
			<div class="text-muted-foreground py-16 text-center text-sm font-semibold">لا توجد فواتير</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each invoices as inv (inv.id)}
					<button
						type="button"
						class="apple-press border-border/50 bg-card/60 flex items-center gap-3 rounded-2xl border p-3 text-start backdrop-blur-xl transition active:scale-[0.99]"
						onclick={() => openInvoice(inv.id)}
					>
						<Receipt class="text-muted-foreground size-5 shrink-0" />
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-mono text-sm font-black">#{inv.id}</span>
								{#if inv.received}
									<Badge variant="outline" class="border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
										مستلمة
									</Badge>
								{:else}
									<Badge variant="outline" class="border-amber-500/35 bg-amber-500/10 px-1.5 py-0 text-[10px] font-bold text-amber-700 dark:text-amber-300">
										بانتظار الاستلام
									</Badge>
								{/if}
							</div>
							<div class="text-muted-foreground mt-0.5 text-[11px] font-semibold">
								{inv.deliveredCount} طلب مسلّم{inv.replacementCount ? ` • ${inv.replacementCount} راجع` : ''}
								{inv.feesTotal !== null ? ` • أجور ${formatPrice(inv.feesTotal)}` : ''}
								{inv.updatedAt ? ` • ${inv.updatedAt}` : ''}
							</div>
						</div>
						<div class="shrink-0 text-end">
							<div class="text-sm font-black tabular-nums text-emerald-600 dark:text-emerald-400">
								{formatPrice(inv.merchantPrice)}
							</div>
							<div class="text-muted-foreground text-[10px] font-bold">د.ع</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}

	<!-- ========================= One batch, matched ========================= -->
	{:else}
		{#if loadingDetail && !detail}
			<div class="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm font-semibold">
				<Loader2 class="size-4 animate-spin" /> جاري مطابقة الطلبات مع الـERP…
			</div>
		{:else if detailError}
			<div class="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-4 text-sm font-bold text-rose-700 dark:text-rose-300">
				{detailError}
			</div>
		{:else if detail}
			{@const t = detail.totals}
			<div in:fly={{ y: 8, duration: 160 }}>
				<!-- Money summary. The carrier's own figure first: it is the amount
				     actually paid, and our recomputation sits under it. -->
				<div class="border-border/50 bg-card/60 mb-3 rounded-3xl border p-4 backdrop-blur-xl">
					<div class="flex items-baseline justify-between gap-2">
						<span class="text-muted-foreground text-xs font-bold">مبلغ الفاتورة من الوسيط</span>
						<span class="text-xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">
							<AnimatedNumber value={detail.invoice.merchantPrice} format={formatPrice} /> د.ع
						</span>
					</div>
					<!-- Alwaseet's own breakdown of the batch, so the total can be
					     checked line by line instead of taken on trust. -->
					<div class="text-muted-foreground mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-semibold tabular-nums">
						{#if detail.invoice.deliveredPrice !== null}
							<span>{detail.invoice.deliveredCount} طلب مسلّم</span>
							<span class="text-end">{formatPrice(detail.invoice.deliveredPrice)}</span>
						{/if}
						{#if detail.invoice.replacementPrice !== null && detail.invoice.replacementCount > 0}
							<span>{detail.invoice.replacementCount} استبدال / راجع</span>
							<span class="text-end">{formatPrice(detail.invoice.replacementPrice)}</span>
						{/if}
						<span>مجموع مبالغ الطلبات</span><span class="text-end">{formatPrice(t.sumPrice)}</span>
						<span>أجور التوصيل</span><span class="text-end">− {formatPrice(detail.invoice.feesTotal ?? t.sumDelivery)}</span>
						<span class="text-foreground font-bold">الصافي حسب حسابنا</span>
						<span class="text-foreground text-end font-bold">{formatPrice(t.net)}</span>
					</div>
					{#if detail.invoice.windowFrom && detail.invoice.windowTo}
						<div class="text-muted-foreground mt-1.5 text-[10px] font-semibold">
							تغطي الفترة {detail.invoice.windowFrom} ← {detail.invoice.windowTo}
						</div>
					{/if}
					{#if detail.invoice.payoutStatus}
						<div class="text-muted-foreground mt-0.5 text-[10px] font-semibold">
							{detail.invoice.payoutStatus}
						</div>
					{/if}
					{#if detail.previousBatch && detail.previousBatch.toWallet && detail.invoice.toWallet}
						<!-- The number the app shows can cover this batch and the one
						     before it; spelling the sum out stops it reading as a gap. -->
						<button
							type="button"
							class="apple-press mt-2 w-full rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-start text-[11px] font-semibold text-sky-700 dark:text-sky-300"
							onclick={() => openInvoice(detail!.previousBatch!.id)}
						>
							مع الفاتورة السابقة #{detail.previousBatch.id}
							({formatPrice(detail.previousBatch.merchantPrice)} د.ع) يصبح المجموع
							<span class="font-black">
								{formatPrice(detail.invoice.merchantPrice + detail.previousBatch.merchantPrice)}
							</span>
							د.ع — كلاهما حُوّل إلى المحفظة.
						</button>
					{/if}
					{#if headerGap !== 0}
						<div class="mt-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 dark:text-rose-300">
							فرق {formatPrice(Math.abs(headerGap))} د.ع بين حسابنا ومبلغ الوسيط — راجع الأسطر.
						</div>
					{/if}
				</div>

				<!-- The one number the whole screen exists for -->
				{#if t.toRecord > 0}
					<div class="mb-3 rounded-2xl border border-sky-500/35 bg-sky-500/10 p-3">
						<div class="text-[11px] font-bold text-sky-700 dark:text-sky-300">يحتاج تسجيل دفعة في الـERP</div>
						<div class="text-lg font-black tabular-nums text-sky-700 dark:text-sky-300">
							<AnimatedNumber value={t.toRecordAmount} format={formatPrice} /> د.ع
							<span class="text-[11px] font-bold">({t.toRecord} فاتورة)</span>
						</div>
						{#if t.absorbed > 0}
							<div class="mt-1 text-[11px] font-semibold text-sky-700/80 dark:text-sky-300/80">
								الواصل نقداً منها {formatPrice(t.toRecordCash)} د.ع — {t.absorbed}
								{t.absorbed === 1 ? 'طلب' : 'طلبات'} أجرة توصيلها علينا بمقدار
								{formatPrice(t.absorbedAmount)} د.ع.
							</div>
						{/if}
					</div>
				{:else if t.attention === 0}
					<div class="mb-3 flex items-center gap-2 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
						<Check class="size-4" /> كل الطلبات مطابقة ومسجّلة في الـERP.
					</div>
				{/if}

				<!-- The walk through the batch: what the ERP has confirmed, what was
				     opened and not yet confirmed, and what has not been touched. -->
				{#if t.toRecord + t.paid > 0}
					{@const done = t.paid}
					{@const total = t.toRecord + t.paid}
					<div class="border-border/50 bg-card/60 mb-3 rounded-2xl border p-3 backdrop-blur-xl">
						<div class="flex items-center justify-between gap-2 text-[11px] font-bold">
							<span>سُجِّل في الـERP {done} من {total}</span>
							{#if pendingMarks.length > 0}
								<span class="text-amber-700 dark:text-amber-300">
									{pendingMarks.length} بانتظار التأكيد
								</span>
							{/if}
						</div>
						<div class="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full">
							<div
								class="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
								style="width: {total ? (done / total) * 100 : 0}%"
							></div>
						</div>
						{#if untouched.length > 0}
							<button
								type="button"
								class="apple-press mt-2 w-full rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-black text-sky-700 dark:text-sky-300"
								onclick={jumpToNext}
							>
								التالي غير المسجّل ({untouched.length} متبقٍ)
							</button>
						{:else if pendingMarks.length > 0}
							<button
								type="button"
								class="apple-press mt-2 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-black text-amber-700 dark:text-amber-300"
								onclick={jumpToNext}
							>
								راجع الطلبات بانتظار التأكيد ({pendingMarks.length})
							</button>
						{/if}
					</div>
				{/if}

				{#if progress.last && detail.lines.some((l) => l.orderId === progress.last)}
					<button
						type="button"
						class="apple-press border-border/50 bg-card/60 mb-2 flex w-full items-center gap-2 rounded-2xl border px-3 py-2 text-start text-[11px] font-bold backdrop-blur-xl"
						onclick={() => {
							haptic(8);
							if (filter !== 'all') filter = 'all';
							tick().then(() => jumpTo(progress.last!));
						}}
					>
						<Bookmark class="size-3.5 shrink-0" />
						توقفت عند الطلب <span class="font-mono">{progress.last}</span> — اضغط للعودة إليه
					</button>
				{/if}

				{#if !detail.erpConfigured}
					<div class="mb-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs font-bold text-amber-700 dark:text-amber-300">
						مفتاح الـERP غير مهيأ — تُعرض أرقام الوسيط فقط.
					</div>
				{/if}

				<!-- Filters -->
				<div class="mb-2 flex flex-wrap gap-1.5">
					{#each [
						{ key: 'all' as Filter, label: `الكل (${t.orders})` },
						{ key: 'toRecord' as Filter, label: `يحتاج دفعة (${t.toRecord})` },
						{ key: 'paid' as Filter, label: `مدفوعة (${t.paid})` },
						{ key: 'attention' as Filter, label: `تنبيه (${t.attention})` },
						{ key: 'returned' as Filter, label: `راجع (${t.returned})` }
					] as f (f.key)}
						<button
							type="button"
							class="apple-press rounded-full border px-2.5 py-1 text-[11px] font-bold transition {filter === f.key
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border/50 bg-card/60'}"
							onclick={() => {
								haptic(8);
								filter = f.key;
							}}
						>
							{f.label}
						</button>
					{/each}
				</div>

				<!-- Lines -->
				<div class="flex flex-col gap-2">
					{#each visibleLines as line (line.orderId)}
						{@const v = VERDICTS[line.verdict]}
						{@const erpHref = line.erp?.url ?? line.order?.erpInvoiceUrl ?? null}
						<div
							id="line-{line.orderId}"
							class="bg-card/60 rounded-2xl border p-3 backdrop-blur-xl transition-[box-shadow,border-color] duration-300 {highlighted ===
							line.orderId
								? 'border-sky-500 ring-2 ring-sky-500/40'
								: 'border-border/50'}"
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<button
										type="button"
										class="apple-press inline-flex items-center gap-1.5 font-mono text-sm font-black"
										onclick={() => copy(line.orderId)}
										title="نسخ رقم الوسيط"
									>
										{line.orderId}
										{#if copied === line.orderId}
											<Check class="size-3.5 text-emerald-600" />
										{:else}
											<Copy class="text-muted-foreground size-3.5" />
										{/if}
									</button>
									<div class="text-muted-foreground mt-0.5 truncate text-[11px] font-semibold">
										{line.clientName} • {line.cityName}{line.regionName ? ` — ${line.regionName}` : ''}
									</div>
								</div>
								<div class="flex shrink-0 flex-col items-end gap-1">
									<Badge variant="outline" class="px-1.5 py-0 text-[10px] font-bold {v.tone}">
										{v.label}
									</Badge>
									{#if PAYABLE.includes(line.verdict) && progress.marked.includes(line.orderId)}
										<span
											class="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-1.5 py-0 text-[10px] font-bold text-amber-700 dark:text-amber-300"
											title="يتأكد تلقائياً عند رجوعك من الـERP"
										>
											<Loader2 class="size-2.5 animate-spin" /> بانتظار التأكيد
										</span>
									{/if}
								</div>
							</div>

							<!-- Carrier money vs ERP money, side by side, never subtracted -->
							<div class="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold tabular-nums">
								<div class="border-border/40 rounded-xl border p-2">
									<div class="text-muted-foreground mb-1 text-[10px] font-bold">الوسيط</div>
									<div class="flex justify-between"><span>المبلغ</span><span>{formatPrice(line.price)}</span></div>
									<div class="flex justify-between"><span>التوصيل</span><span>− {formatPrice(line.deliveryPrice)}</span></div>
									<div class="text-foreground mt-0.5 flex justify-between border-t border-dashed pt-0.5 font-black">
										<span>الصافي</span><span>{formatPrice(line.net)}</span>
									</div>
								</div>
								<div class="border-border/40 rounded-xl border p-2">
									<div class="text-muted-foreground mb-1 text-[10px] font-bold">
										الـERP{line.erp?.serial ? ` — ${line.erp.serial}` : ''}
									</div>
									{#if line.erp}
										<div class="flex justify-between"><span>المجموع</span><span>{formatPrice(line.erp.total)}</span></div>
										<div class="flex justify-between"><span>مدفوع</span><span>{formatPrice(line.erp.totalPaid)}</span></div>
										<div class="mt-0.5 flex justify-between border-t border-dashed pt-0.5 font-black {line.erp.due > 0 ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300'}">
											<span>المتبقي</span><span>{formatPrice(line.erp.due)}</span>
										</div>
									{:else if line.order?.erpInvoiceUrl}
										<!-- No API reading for this one (pre-Integration-API invoice), but
										     the link written at the time still opens it. -->
										<div class="text-muted-foreground text-[11px] leading-relaxed">
											<div class="text-foreground font-mono font-bold">{line.order.erpInvoiceId}</div>
											<div>المبلغ غير مقروء عبر الـAPI — افتح الفاتورة للتحقق</div>
										</div>
									{:else}
										<div class="text-muted-foreground py-2 text-center text-[11px]">—</div>
									{/if}
								</div>
							</div>

							{#if line.verdict === 'MISMATCH' && line.diff !== null}
								<div class="mt-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 dark:text-rose-300">
									فرق {formatPrice(Math.abs(line.diff))} د.ع — فاتورة الـERP {line.diff > 0 ? 'أكبر من' : 'أصغر من'} صافي الوسيط.
								</div>
							{:else if line.verdict === 'MATCH_ABSORBED' || line.verdict === 'DELIVERY_GAP'}
								{@const eaten = (line.erp?.total ?? 0) - line.net}
								<div class="text-muted-foreground mt-2 flex items-start gap-1.5 text-[11px] font-semibold">
									<CornerUpLeft class="mt-0.5 size-3.5 shrink-0 rotate-180" />
									<span>
										الوسيط خصم {formatPrice(line.deliveryPrice)} د.ع أجرة توصيل، منها
										<span class="text-foreground font-black">{formatPrice(eaten)}</span> د.ع علينا — الواصل نقداً
										{formatPrice(line.net)} د.ع مقابل فاتورة {formatPrice(line.erp?.total ?? 0)} د.ع.
									</span>
								</div>
							{:else if line.verdict !== 'PAID' && line.verdict !== 'MATCH'}
								<div class="text-muted-foreground mt-2 flex items-start gap-1.5 text-[11px] font-semibold">
									{#if line.verdict === 'RETURNED'}
										<CornerUpLeft class="mt-0.5 size-3.5 shrink-0" />
									{:else}
										<CircleAlert class="mt-0.5 size-3.5 shrink-0" />
									{/if}
									<span>{v.action}</span>
								</div>
							{/if}

							{#if line.erpError}
								<div class="text-muted-foreground mt-1 truncate text-[10px]">{line.erpError}</div>
							{/if}

							<!-- Where the operator goes next -->
							<div class="mt-2 flex flex-wrap items-center gap-1.5">
								{#if erpHref}
									<a
										href={erpHref}
										target="_blank"
										rel="noopener noreferrer"
										class="apple-press inline-flex items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold text-sky-700 transition dark:text-sky-300"
										onclick={() => markOpened(line)}
									>
										<ExternalLink class="size-3.5" />
										{#if ['MATCH', 'MATCH_ABSORBED', 'DELIVERY_GAP'].includes(line.verdict)}
											سجّل الدفعة في الـERP
										{:else if line.erp}
											فاتورة الـERP
										{:else}
											افتح الفاتورة {line.order?.erpInvoiceId ?? ''}
										{/if}
									</a>
									{#if !line.erp && erpHref.includes('plus.gini.iq')}
										<span class="text-muted-foreground text-[10px] font-bold">نظام ERP القديم</span>
									{/if}
								{/if}
								{#if line.erp?.publicPrintUrl}
									<a
										href={line.erp.publicPrintUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="apple-press border-border/50 bg-card/60 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition"
									>
										<FileText class="size-3.5" /> طباعة
									</a>
								{/if}
								{#if orderHref(line)}
									<!-- New tab like every other link here: navigating away would
									     drop the place in the batch this screen works to keep. -->
									<a
										href={orderHref(line)}
										target="_blank"
										rel="noopener noreferrer"
										class="apple-press border-border/50 bg-card/60 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition"
									>
										<PackageSearch class="size-3.5" />
										{line.order?.idempotencyKey?.replace(/^ORD-/i, '') ?? 'الطلب'}
									</a>
								{/if}
								{#if line.order?.storeName}
									<span class="text-muted-foreground text-[10px] font-bold">{line.order.storeName}</span>
								{/if}
							</div>
						</div>
					{/each}

					{#if visibleLines.length === 0}
						<div class="text-muted-foreground py-10 text-center text-sm font-semibold">لا توجد أسطر بهذا التصنيف</div>
					{/if}
				</div>

				<!-- Receiving the batch is the carrier's own flag, so it lives at the end -->
				{#if !detail.invoice.received}
					<Button
						class="mt-4 h-12 w-full gap-2 rounded-2xl text-sm font-black"
						onclick={() => {
							haptic(12);
							confirmReceive = true;
						}}
					>
						<Check class="size-4" /> تأكيد استلام الفاتورة من الوسيط
					</Button>
				{:else}
					<div class="text-muted-foreground mt-4 text-center text-[11px] font-bold">
						الفاتورة مستلمة من الوسيط{detail.invoice.updatedAt ? ` • ${detail.invoice.updatedAt}` : ''}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<Dialog bind:open={confirmReceive}>
	<DialogContent class="max-w-sm rounded-3xl">
		<DialogHeader>
			<DialogTitle>تأكيد استلام الفاتورة #{selectedId}</DialogTitle>
			<DialogDescription>
				يُسجَّل لدى الوسيط أن التاجر استلم مبلغ هذه الفاتورة. لا يغيّر شيئاً في الـERP.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter class="gap-2">
			<Button variant="outline" onclick={() => (confirmReceive = false)} disabled={receiving}>إلغاء</Button>
			<Button onclick={doReceive} disabled={receiving} class="gap-2">
				{#if receiving}<Loader2 class="size-4 animate-spin" />{/if}
				تأكيد الاستلام
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
