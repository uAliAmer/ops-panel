<script lang="ts">
	/**
	 * The conversation attached to one order — see docs/OPS_CHAT_PLAN.md.
	 *
	 * Order talk used to live in WhatsApp and never came back to the order, so
	 * "why was this rejected" was unanswerable a month later. This resolves the
	 * order's thread and hands it to ChatThread, which the chat sheet also uses:
	 * one implementation, so a message cannot render two different ways.
	 */
	import { api } from '$lib/api';
	import { MessageSquare } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import ChatThread from '$lib/components/ChatThread.svelte';

	type Props = {
		submissionId: string;
		/** Scroller height — a column can afford more than a stacked card. */
		heightClass?: string;
	};
	let { submissionId, heightClass = 'max-h-44' }: Props = $props();

	let conversationId = $state<string | null>(null);

	$effect(() => {
		const sid = submissionId;
		if (!sid) return;
		let alive = true;
		(async () => {
			try {
				const res = await api.chatOrderThread(sid);
				if (alive && res.success && res.data) conversationId = res.data.conversationId;
			} catch {
				if (alive) toast.error('تعذّر فتح المحادثة');
			}
		})();
		return () => {
			alive = false;
		};
	});
</script>

<!-- Deliberately lighter than the detail cards around it: a hairline box, not
     another frosted panel. It sits in the middle of the page and must read as a
     side channel, not compete with the order's own figures. -->
<!-- relative z-20: the mention picker inside this card has to rise above the
     panels around it, and every one of them carries backdrop-blur — which makes
     each its own stacking context, so a z-index inside this card could never win
     against a card that comes later in the document. -->
<div class="relative z-20 mt-4 rounded-xl border border-border/50 bg-card/40 p-3 lg:mt-0">
	<div class="mb-2 flex items-center gap-1.5">
		<MessageSquare class="text-muted-foreground size-3.5 shrink-0" />
		<h3 class="text-xs font-black">المحادثة</h3>
	</div>

	<!-- Short on purpose. Enough to show the last few messages without tapping,
	     and it scrolls for the rest — a thread that grows without limit would
	     push the carrier and ERP sections off the screen as it filled up. -->
	<ChatThread
		{conversationId}
		{heightClass}
		placeholder="اكتب ملاحظة… استخدم @ للإشارة إلى زميل"
		emptyText="لا توجد رسائل بعد — اكتب ملاحظة عن هذا الطلب ليراها بقية الفريق."
	/>
</div>
