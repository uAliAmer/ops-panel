<script lang="ts">
	// Create-a-reminder form. Used standalone from the header (no submissionId —
	// a personal/team note) and from an order's own panel (submissionId set).
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api, type Reminder } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import DueAtPicker from './DueAtPicker.svelte';
	import { BellPlus, X } from '@lucide/svelte';
	import { haptic } from '$lib/utils/haptic';

	let { submissionId, onCreated }: { submissionId?: string; onCreated?: (r: Reminder) => void } =
		$props();

	// Common ops phrases, offered inside the text box itself rather than under
	// it: they are what goes *in* the field, so they sit where the answer goes.
	// They clear themselves out of the way the moment the operator writes
	// something of their own.
	const MESSAGE_SUGGESTIONS = [
		'جهز الطلب رجاءاً',
		'اتصل بالزبون لتأكيد العنوان',
		'تأكد من السعر مع الزبون',
		'تابع حالة التوصيل',
		'أرسل الفاتورة للزبون',
		'راجع المخزون قبل التجهيز'
	];

	let message = $state('');

	// The chips stand in for the placeholder, so they show exactly while the
	// field is empty. The first character typed — or a chip tapped — hands the
	// space back to the text.
	const showSuggestions = $derived(!message);

	function pickSuggestion(sug: string) {
		haptic(8);
		message = sug;
	}

	let dueAt = $state(new Date(Date.now() + 60 * 60_000).toISOString());
	let assignedToId = $state('');
	let users = $state<{ id: string; name: string; role: string }[]>([]);
	let saving = $state(false);

	onMount(async () => {
		try {
			const res = await api.getAssignableUsers();
			if (res.success && res.data) users = res.data;
		} catch {
			/* assignee list is a nice-to-have; the form still works without it */
		}
	});

	async function submit() {
		const text = message.trim();
		if (!text || saving) return;
		saving = true;
		try {
			const res = await api.createReminder({
				message: text,
				dueAt,
				submissionId,
				assignedToId: assignedToId || undefined
			});
			if (res.success && res.data) {
				toast.success('تم ضبط التذكير');
				message = '';
				dueAt = new Date(Date.now() + 60 * 60_000).toISOString();
				assignedToId = '';
				onCreated?.(res.data);
			} else {
				toast.error(res.error || 'تعذّر ضبط التذكير');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-3">
	<!-- The field and its suggestions are one box: the wrapper carries the
	     border and the focus ring the textarea used to draw itself, and the
	     textarea inside is stripped bare so the seam does not show.
	     The chips take the place of the placeholder rather than sitting below
	     it — the empty box offers the six phrases, and writing anything hands
	     the space back to the text. The overlay itself ignores pointer events
	     so a tap in the gaps between chips still lands on the textarea and
	     puts the cursor there. -->
	<div
		class="border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 relative w-full rounded-lg border bg-transparent px-2.5 py-2 transition-colors focus-within:ring-3"
	>
		<Textarea
			bind:value={message}
			aria-label="نص التذكير"
			placeholder=""
			rows={3}
			class="min-h-24 rounded-none border-0 bg-transparent p-0 pe-6 text-sm focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
		/>

		{#if showSuggestions}
			<div
				class="pointer-events-none absolute inset-0 flex flex-wrap content-start gap-1.5 px-2.5 py-2"
			>
				{#each MESSAGE_SUGGESTIONS as sug (sug)}
					<button
						type="button"
						class="apple-press pointer-events-auto h-fit rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-bold transition-colors hover:bg-muted/70"
						onclick={() => pickSuggestion(sug)}
					>
						{sug}
					</button>
				{/each}
			</div>
		{:else}
			<!-- Clearing is the only way back to the chips, so it gets a control
			     rather than a select-all-and-delete. -->
			<button
				type="button"
				class="apple-press text-muted-foreground hover:text-foreground absolute end-1 top-1 flex size-6 items-center justify-center rounded-full hover:bg-muted/70"
				aria-label="مسح النص"
				onclick={() => {
					haptic(8);
					message = '';
				}}
			>
				<X class="size-3.5" />
			</button>
		{/if}
	</div>

	<DueAtPicker bind:value={dueAt} />

	{#if users.length > 0}
		<!-- Options get an explicit opaque background: Chrome paints the dropdown
		     popup from the select's own background-color, so the translucent one
		     came out white while the text stayed near-white — unreadable in dark. -->
		<select
			bind:value={assignedToId}
			aria-label="لمن هذا التذكير"
			class="border-input dark:bg-input/30 text-foreground [&>option]:bg-popover [&>option]:text-popover-foreground h-11 w-full rounded-xl border bg-transparent px-3 text-sm font-bold outline-none"
		>
			<option value="">لنفسي</option>
			{#each users as u (u.id)}
				<option value={u.id}>{u.name}</option>
			{/each}
		</select>
	{/if}

	<Button
		class="h-11 w-full gap-1.5 font-bold"
		disabled={!message.trim() || saving}
		onclick={() => void submit()}
	>
		<BellPlus class="size-4" />
		{saving ? '...' : 'ضبط التذكير'}
	</Button>
</div>
