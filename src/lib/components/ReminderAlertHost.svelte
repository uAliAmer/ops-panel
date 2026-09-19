<script lang="ts">
	// Mounted once in the root layout — unlike RemindersChip (which lives only
	// in AppHeader, itself only on the order-list page), this fires no matter
	// which page/order the operator currently has open. That gap was the bug:
	// a reminder due while viewing an order used to update nothing anyone
	// could see until they navigated back to the list.
	//
	// "Mine" here must match routes/reminders.js exactly: assigned to me, or
	// unassigned-and-created-by-me. Unassigned does NOT mean "everyone" —
	// broadcasting a personal reminder to the whole team as an interruptive
	// modal would be worse than the silence this replaces.
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Bell, Check, Clock, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { socketStore, type ReminderDue } from '$lib/stores/socket.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { haptic } from '$lib/utils/haptic';
	import { playReminderAlarm, stopReminderAlarm, blinkTabTitle } from '$lib/utils/notifier';
	import { formatBaghdadShort } from '$lib/utils/baghdadTime';
	import DueAtPicker from './DueAtPicker.svelte';

	let queue = $state<ReminderDue[]>([]);
	const current = $derived(queue[0] ?? null);
	let busy = $state(false);
	let snoozing = $state(false);
	let snoozeAt = $state(new Date(Date.now() + 60 * 60_000).toISOString());

	function isMine(p: ReminderDue) {
		const me = auth.user?.id;
		if (!me) return false;
		return p.assignedToId === me || (p.assignedToId === null && p.createdById === me);
	}

	let stopSocket: (() => void) | null = null;
	onMount(() => {
		stopSocket = socketStore.onReminderDue((payload) => {
			if (!isMine(payload)) return;
			haptic(30);
			playReminderAlarm();
			blinkTabTitle(1, '⏰ تذكير!');
			queue = [...queue, payload];
		});
	});
	onDestroy(() => stopSocket?.());

	function next() {
		stopReminderAlarm();
		queue = queue.slice(1);
		snoozing = false;
		busy = false;
		snoozeAt = new Date(Date.now() + 60 * 60_000).toISOString();
	}

	async function act(action: 'complete' | 'dismiss') {
		if (!current || busy) return;
		busy = true;
		try {
			await api.updateReminder(current.id, { action });
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			next();
		}
	}

	async function confirmSnooze() {
		if (!current || busy) return;
		busy = true;
		try {
			await api.updateReminder(current.id, { action: 'snooze', dueAt: snoozeAt });
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			next();
		}
	}

	function openOrder() {
		if (!current?.submissionId) return;
		const id = current.submissionId;
		next();
		void goto(`${base}/order/${id}/`);
	}
</script>

{#if current}
	<Dialog
		open={true}
		onOpenChange={(v) => {
			if (!v) next();
		}}
	>
		<DialogContent
			showCloseButton={false}
			class="z-[400] max-w-md gap-4 rounded-3xl border border-amber-500/40 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl sm:max-w-lg"
			dir="rtl"
		>
			<DialogHeader>
				<DialogTitle class="flex items-center justify-center gap-2 text-lg font-black">
					<Bell class="size-5 text-amber-500" /> حان وقت التذكير
				</DialogTitle>
			</DialogHeader>

			<div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
				<p class="text-base leading-relaxed font-bold">{current.message}</p>
				<p class="text-muted-foreground mt-1 text-xs font-bold">
					{formatBaghdadShort(current.dueAt)}
				</p>
			</div>

			{#if snoozing}
				<DueAtPicker bind:value={snoozeAt} variant="snooze" />
				<div class="flex gap-2">
					<Button variant="outline" class="h-11 flex-1 font-bold" onclick={() => (snoozing = false)}>
						رجوع
					</Button>
					<Button class="h-11 flex-1 font-bold" disabled={busy} onclick={() => void confirmSnooze()}>
						{busy ? '...' : 'تأجيل لهذا الوقت'}
					</Button>
				</div>
			{:else}
				<DialogFooter class="grid grid-cols-3 gap-2">
					<Button
						variant="outline"
						class="h-12 flex-col gap-0.5 text-xs font-bold"
						disabled={busy}
						onclick={() => {
							haptic(8);
							stopReminderAlarm();
							snoozing = true;
						}}
					>
						<Clock class="size-4" /> تأجيل
					</Button>
					<Button
						variant="outline"
						class="h-12 flex-col gap-0.5 text-xs font-bold text-rose-600 dark:text-rose-400"
						disabled={busy}
						onclick={() => act('dismiss')}
					>
						<X class="size-4" /> تجاهل
					</Button>
					<Button
						class="h-12 flex-col gap-0.5 text-xs font-bold"
						disabled={busy}
						onclick={() => act('complete')}
					>
						<Check class="size-4" /> تم
					</Button>
				</DialogFooter>

				{#if current.submissionId}
					<button
						type="button"
						class="apple-press text-primary text-center text-sm font-bold underline"
						onclick={openOrder}
					>
						فتح الطلب
					</button>
				{/if}
			{/if}
		</DialogContent>
	</Dialog>
{/if}
