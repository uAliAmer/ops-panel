<script lang="ts">
	// Header chip: the operator's own open reminders (assigned to them, or
	// created by them with nobody else assigned). Same load/poll/socket pattern
	// PickupChip uses — each mounted copy (desktop bar + mobile menu) manages its
	// own timer/subscription independently, which is why this stays self
	// contained rather than a shared store.
	import { onMount, onDestroy } from 'svelte';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Bell, X, Plus, RefreshCw } from '@lucide/svelte';
	import { api, type Reminder } from '$lib/api';
	import { socketStore } from '$lib/stores/socket.svelte';
	import { haptic } from '$lib/utils/haptic';
	import ReminderComposer from './ReminderComposer.svelte';
	import ReminderRow from './ReminderRow.svelte';

	let open = $state(false);
	let composing = $state(false);
	let items = $state<Reminder[]>([]);
	let loading = $state(false);
	let loadedOnce = $state(false);

	const overdueCount = $derived(
		items.filter((r) => new Date(r.dueAt).getTime() <= Date.now()).length
	);

	async function load() {
		loading = true;
		try {
			const res = await api.listReminders({ status: 'PENDING' });
			if (res.success && res.data) {
				items = res.data;
				loadedOnce = true;
			}
		} catch {
			/* header chip is best-effort */
		} finally {
			loading = false;
		}
	}

	function onRowChanged(id: string, updated: Reminder | null) {
		if (updated && updated.status === 'PENDING') {
			items = items.map((r) => (r.id === id ? updated : r));
		} else {
			items = items.filter((r) => r.id !== id);
		}
	}

	const POLL_MS = 60_000;
	let timer: ReturnType<typeof setInterval> | null = null;
	let stopSocket: (() => void) | null = null;

	onMount(() => {
		void load();
		timer = setInterval(() => void load(), POLL_MS);
		// The actual pop-up alert lives in ReminderAlertHost (mounted at the
		// layout level, so it fires no matter which page is open) — this chip
		// just keeps its own badge/list current.
		stopSocket = socketStore.onReminderDue(() => void load());
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
		stopSocket?.();
	});

	$effect(() => {
		if (open) void load();
	});
</script>

<button
	type="button"
	class="apple-press relative inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold shadow-[0_2px_10px_rgba(59,130,246,0.15)] ring-1 ring-inset backdrop-blur-2xl backdrop-saturate-200 transition-all
		{overdueCount > 0
		? 'border-rose-500/40 bg-rose-500/15 text-rose-700 ring-rose-500/20 dark:border-rose-500/45 dark:bg-rose-500/20 dark:text-rose-300'
		: 'border-border/60 bg-muted/40 text-muted-foreground ring-white/10'}"
	aria-label="التذكيرات"
	title="التذكيرات"
	onclick={() => {
		haptic(10);
		open = true;
	}}
>
	<Bell class="size-4 shrink-0" />
	{#if items.length > 0}
		<span class="text-xs font-black tabular-nums">{items.length}</span>
	{/if}
</button>

<Dialog bind:open>
	<DialogContent
		showCloseButton={false}
		class="inset-0 top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
	>
		<div class="bg-card flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4 sm:rounded-t-3xl">
			<div class="flex items-center gap-2.5">
				<Bell class="size-6 text-primary" />
				<h2 class="text-xl font-black">التذكيرات</h2>
			</div>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="apple-press text-muted-foreground hover:text-foreground rounded-full p-2.5"
					aria-label="تحديث"
					onclick={() => {
						haptic(8);
						void load();
					}}
				>
					<RefreshCw class="size-5 {loading ? 'animate-spin' : ''}" />
				</button>
				<button
					type="button"
					class="apple-press text-muted-foreground hover:text-foreground rounded-full p-2.5"
					aria-label="إغلاق"
					onclick={() => (open = false)}
				>
					<X class="size-5" />
				</button>
			</div>
		</div>

		<div class="flex-1 overflow-y-auto">
			{#if composing}
				<div class="border-b p-4">
					<ReminderComposer
						onCreated={() => {
							composing = false;
							void load();
						}}
					/>
				</div>
			{:else}
				<button
					type="button"
					class="apple-press flex w-full items-center justify-center gap-1.5 border-b p-3 text-sm font-bold text-primary"
					onclick={() => {
						haptic(10);
						composing = true;
					}}
				>
					<Plus class="size-4" /> تذكير جديد
				</button>
			{/if}

			{#if !loadedOnce}
				<p class="text-muted-foreground p-6 text-center text-sm">...</p>
			{:else if items.length === 0}
				<p class="text-muted-foreground p-6 text-center text-sm">لا توجد تذكيرات معلّقة.</p>
			{:else}
				<ul class="divide-y">
					{#each items as r (r.id)}
						<ReminderRow reminder={r} onChanged={(u) => onRowChanged(r.id, u)} />
					{/each}
				</ul>
			{/if}
		</div>
	</DialogContent>
</Dialog>
