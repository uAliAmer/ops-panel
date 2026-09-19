<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { Check, X, CircleX, Loader2, Bike } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api, type Order } from '$lib/api';
	import { haptic } from '$lib/utils/haptic';
	import { cn } from '$lib/utils';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';

	type Props = {
		order: Order;
		/** movedTo names the tab the order ends up in after the action. */
		onDone: (movedTo?: 'approved' | 'history') => void;
		/** Jump the list to a tab (used by the toast's "عرض" action). */
		onGoTo?: (tab: 'approved' | 'history') => void;
	};
	let { order, onDone, onGoTo }: Props = $props();

	let submitting = $state(false);

	// Quick approve requires double-tap confirmation to prevent mis-taps
	let approveArmed = $state(false);
	let armTimer: ReturnType<typeof setTimeout> | null = null;

	// An own-driver order sitting at "assigned" has exactly one next move, and it
	// is made at the counter as the driver walks out — worth the same one-tap
	// treatment the review actions get, from the list, without opening the order.
	const ASSIGNED = 'تم الاستلام من قبل المندوب';
	const isLocalAssigned = $derived(
		order.shipment?.carrierMethod === 'LOCAL' &&
			order.status === 'SENT_TO_CARRIER' &&
			order.shipment?.alwaseetStatusName === ASSIGNED
	);
	let outArmed = $state(false);
	let outTimer: ReturnType<typeof setTimeout> | null = null;

	async function quickOut(e: MouseEvent) {
		e.stopPropagation();
		if (!outArmed) {
			outArmed = true;
			haptic(15);
			if (outTimer) clearTimeout(outTimer);
			outTimer = setTimeout(() => (outArmed = false), 3000);
			return;
		}
		if (outTimer) clearTimeout(outTimer);
		outArmed = false;
		haptic([30, 50, 30]);
		submitting = true;
		const t = toast.loading('جاري التحديث…');
		try {
			const res = await api.localStatus(order.id, 'OUT');
			if (res.success) {
				toast.success(res.message || 'خرج للتوصيل', { id: t });
				onDone();
			} else {
				toast.error(res.error ?? 'تعذّر التحديث', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			submitting = false;
		}
	}

	// Reject dialog state
	let rejectModalOpen = $state(false);
	let rejectReason = $state('');
	let rejectInputEl = $state<HTMLTextAreaElement | null>(null);

	function armApprove() {
		approveArmed = true;
		haptic(15);
		if (armTimer) clearTimeout(armTimer);
		armTimer = setTimeout(() => {
			approveArmed = false;
		}, 3000);
	}

	function disarm() {
		if (armTimer) clearTimeout(armTimer);
		approveArmed = false;
	}

	onDestroy(() => {
		if (armTimer) clearTimeout(armTimer);
		if (outTimer) clearTimeout(outTimer);
	});

	async function quickApprove(e: MouseEvent) {
		e.stopPropagation();
		if (!approveArmed) {
			armApprove();
			return;
		}
		disarm();
		haptic([30, 50, 30]);
		submitting = true;
		const t = toast.loading('جاري الموافقة…');
		try {
			await api.approve(order.id);
			toast.success('تمت الموافقة', {
				id: t,
				action: { label: 'عرض', onClick: () => onGoTo?.('approved') }
			});
			onDone('approved');
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			submitting = false;
		}
	}

	function openRejectDialog(e: MouseEvent) {
		e.stopPropagation();
		disarm();
		haptic(12);
		rejectReason = '';
		rejectModalOpen = true;
		tick().then(() => {
			rejectInputEl?.focus();
		});
	}

	async function confirmReject() {
		const reason = rejectReason.trim();
		if (!reason) {
			toast.error('يرجى كتابة سبب الرفض (إجباري)');
			rejectInputEl?.focus();
			return;
		}
		haptic([30, 50, 30]);
		submitting = true;
		const t = toast.loading('جاري الرفض…');
		try {
			await api.reject(order.id, reason);
			toast.success('تم الرفض — انتقل الطلب إلى «سابقة»', {
				id: t,
				action: { label: 'عرض', onClick: () => onGoTo?.('history') }
			});
			rejectModalOpen = false;
			onDone('history');
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			submitting = false;
		}
	}
</script>

<!-- Quick action buttons on the card -->
<div
	class="flex items-center gap-1.5"
	role="group"
	aria-label="إجراءات سريعة"
	onclick={(e) => e.stopPropagation()}
	onkeydown={() => {}}
>
	{#if isLocalAssigned}
		<button
			type="button"
			aria-label={outArmed ? 'تأكيد الخروج للتوصيل' : 'خرج للتوصيل'}
			class={cn(
				'apple-press inline-flex h-10 items-center justify-center gap-1 rounded-full px-3 text-xs font-bold transition-all duration-150',
				outArmed
					? 'bg-sky-600 text-white shadow-sm'
					: 'bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 active:bg-sky-500/35 dark:text-sky-300',
				submitting && 'opacity-50'
			)}
			onclick={quickOut}
			disabled={submitting}
		>
			<Bike class="size-4" />
			{outArmed ? 'تأكيد؟' : 'خرج للتوصيل'}
		</button>
	{:else}
	<button
		type="button"
		aria-label={approveArmed ? 'تأكيد الموافقة' : 'موافقة سريعة'}
		class={cn(
			'apple-press inline-flex h-10 items-center justify-center rounded-full transition-all duration-150',
			approveArmed
				? 'gap-1 bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm'
				: 'w-10 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 active:bg-emerald-500/35',
			submitting && 'opacity-50'
		)}
		onclick={quickApprove}
		disabled={submitting}
	>
		<Check class="size-5" />
		{#if approveArmed}تأكيد؟{/if}
	</button>
	<button
		type="button"
		aria-label="رفض الطلب"
		class={cn(
			'apple-press inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 transition-all duration-150 hover:bg-rose-500/25 active:bg-rose-500/35',
			submitting && 'opacity-50'
		)}
		onclick={openRejectDialog}
		disabled={submitting}
	>
		<X class="size-5" />
	</button>
	{/if}
</div>

<!-- Card Reject Modal -->
<Dialog bind:open={rejectModalOpen}>
	<DialogContent
		class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl"
		onclick={(e) => e.stopPropagation()}
	>
		<DialogHeader>
			<DialogTitle class="text-center text-lg font-bold text-rose-600 dark:text-rose-400">
				رفض الطلب
			</DialogTitle>
		</DialogHeader>

		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<span class="text-xs font-bold text-foreground">سبب الرفض <span class="text-rose-500">* (إجباري)</span></span>
				<span class="text-[11px] text-muted-foreground">اختر سبباً أو اكتب</span>
			</div>

			<!-- Quick reason tags -->
			<div class="flex flex-wrap gap-1.5">
				{#each ['طلب إلغاء من الزبون', 'مكرر', 'الرقم مغلق / لا يرد', 'تغيير بالطلب', 'نفذ المخزون', 'خارج التغطية'] as r}
					<button
						type="button"
						class="apple-press rounded-full border border-rose-500/30 bg-muted/60 px-2.5 py-1 text-[11px] font-bold text-rose-700 shadow-xs hover:bg-rose-500/20 active:scale-95 transition-all dark:text-rose-300"
						onclick={() => {
							rejectReason = r;
							rejectInputEl?.focus();
						}}
					>
						{r}
					</button>
				{/each}
			</div>

			<Textarea
				bind:ref={rejectInputEl}
				bind:value={rejectReason}
				placeholder="اكتب سبب الرفض هنا…"
				rows={3}
				class="rounded-xl border-rose-500/30 bg-background/90 text-sm focus:border-rose-500 focus:ring-rose-500/30"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						void confirmReject();
					}
				}}
			/>
		</div>

		<DialogFooter class="grid grid-cols-2 gap-2">
			<Button
				type="button"
				variant="outline"
				class="h-11 rounded-xl text-sm font-bold"
				onclick={() => (rejectModalOpen = false)}
				disabled={submitting}
			>
				إلغاء
			</Button>
			<Button
				type="button"
				class="apple-press h-11 rounded-xl border border-rose-400/30 bg-rose-600 text-sm font-bold text-white shadow-[0_4px_16px_rgba(225,29,72,0.35)] ring-1 ring-white/25 ring-inset hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50"
				onclick={confirmReject}
				disabled={submitting || !rejectReason.trim()}
			>
				{#if submitting}
					<Loader2 class="size-4 animate-spin" /> جاري الرفض…
				{:else}
					<CircleX class="size-4" /> تأكيد الرفض
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
