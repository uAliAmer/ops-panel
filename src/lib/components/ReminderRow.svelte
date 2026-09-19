<script lang="ts">
	// One reminder in a list: message, Baghdad due time, who it's for, and the
	// three actions every reminder ends in — done, snoozed, or dismissed.
	import { toast } from 'svelte-sonner';
	import { Check, Clock, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { api, type Reminder } from '$lib/api';
	import { haptic } from '$lib/utils/haptic';
	import { formatBaghdadShort } from '$lib/utils/baghdadTime';
	import DueAtPicker from './DueAtPicker.svelte';

	let { reminder, onChanged }: { reminder: Reminder; onChanged?: (r: Reminder | null) => void } =
		$props();

	const overdue = $derived(
		reminder.status === 'PENDING' && new Date(reminder.dueAt).getTime() <= Date.now()
	);

	let busy = $state(false);
	let snoozing = $state(false);
	// "تم" and "تجاهل" both end the reminder and neither can be undone, and the
	// three action buttons sit a thumb's width apart on a phone. Each one now
	// arms an inline confirm bar instead of firing on the first tap.
	let confirming = $state<'complete' | 'dismiss' | null>(null);

	const CONFIRM_COPY = {
		complete: { prompt: 'تأكيد إنجاز التذكير؟', action: 'تم الإنجاز' },
		dismiss: { prompt: 'تأكيد تجاهل التذكير؟', action: 'تجاهل' }
	} as const;

	function arm(which: 'complete' | 'dismiss') {
		haptic(8);
		snoozing = false;
		confirming = confirming === which ? null : which;
	}
	let snoozeAt = $state(new Date(Date.now() + 60 * 60_000).toISOString());

	async function act(action: 'complete' | 'dismiss') {
		if (busy) return;
		haptic(10);
		busy = true;
		try {
			const res = await api.updateReminder(reminder.id, { action });
			if (res.success && res.data) {
				confirming = null;
				onChanged?.(res.data);
			} else {
				toast.error(res.error || 'تعذّر التحديث');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			busy = false;
		}
	}

	async function confirmSnooze() {
		if (busy) return;
		confirming = null;
		busy = true;
		try {
			const res = await api.updateReminder(reminder.id, { action: 'snooze', dueAt: snoozeAt });
			if (res.success && res.data) {
				onChanged?.(res.data);
				snoozing = false;
			} else {
				toast.error(res.error || 'تعذّر التأجيل');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			busy = false;
		}
	}
</script>

<li class="space-y-2 px-4 py-3 {overdue ? 'bg-rose-500/5' : ''}">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<p class="text-sm font-bold break-words">{reminder.message}</p>
			<p
				class="mt-0.5 text-xs font-bold {overdue
					? 'text-rose-600 dark:text-rose-400'
					: 'text-muted-foreground'}"
			>
				{formatBaghdadShort(reminder.dueAt)}
				{#if reminder.assignedTo}
					· {reminder.assignedTo.name}
				{/if}
				{#if reminder.submission}
					· {reminder.submission.customerName || reminder.submission.submissionId}
				{/if}
			</p>
		</div>
		{#if reminder.status === 'PENDING'}
			<div class="flex shrink-0 items-center gap-1">
				<button
					type="button"
					class="apple-press flex size-8 items-center justify-center rounded-full text-emerald-600 dark:text-emerald-400 {confirming ===
					'complete'
						? 'bg-emerald-500/15'
						: 'hover:bg-emerald-500/10'}"
					aria-label="تم"
					aria-pressed={confirming === 'complete'}
					disabled={busy}
					onclick={() => arm('complete')}
				>
					<Check class="size-4.5" />
				</button>
				<button
					type="button"
					class="apple-press flex size-8 items-center justify-center rounded-full {snoozing
						? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
						: 'text-muted-foreground hover:bg-muted/70'}"
					aria-label="تأجيل"
					disabled={busy}
					onclick={() => {
						haptic(8);
						confirming = null;
						snoozing = !snoozing;
					}}
				>
					<Clock class="size-4.5" />
				</button>
				<button
					type="button"
					class="apple-press flex size-8 items-center justify-center rounded-full {confirming ===
					'dismiss'
						? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
						: 'text-muted-foreground hover:text-foreground hover:bg-muted/70'}"
					aria-label="تجاهل"
					aria-pressed={confirming === 'dismiss'}
					disabled={busy}
					onclick={() => arm('dismiss')}
				>
					<X class="size-4.5" />
				</button>
			</div>
		{/if}
	</div>

	{#if confirming}
		<div
			class="flex items-center gap-2 rounded-xl border p-2 {confirming === 'complete'
				? 'border-emerald-500/30 bg-emerald-500/5'
				: 'border-rose-500/30 bg-rose-500/5'}"
		>
			<span class="min-w-0 flex-1 text-xs font-bold">{CONFIRM_COPY[confirming].prompt}</span>
			<Button
				size="sm"
				variant="ghost"
				class="h-8 shrink-0 px-3 text-xs font-bold"
				disabled={busy}
				onclick={() => {
					haptic(8);
					confirming = null;
				}}
			>
				إلغاء
			</Button>
			<Button
				size="sm"
				class="h-8 shrink-0 px-3 text-xs font-bold {confirming === 'complete'
					? 'bg-emerald-600 hover:bg-emerald-600/90'
					: 'bg-rose-600 hover:bg-rose-600/90'} text-white"
				disabled={busy}
				onclick={() => act(confirming!)}
			>
				{busy ? '...' : CONFIRM_COPY[confirming].action}
			</Button>
		</div>
	{/if}

	{#if snoozing}
		<div class="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5">
			<DueAtPicker bind:value={snoozeAt} variant="snooze" />
			<Button
				size="sm"
				class="h-9 w-full font-bold"
				disabled={busy}
				onclick={() => void confirmSnooze()}
			>
				{busy ? '...' : 'تأجيل إلى هذا الوقت'}
			</Button>
		</div>
	{/if}
</li>
