<script lang="ts">
	/**
	 * "You have unfinished work here" — the guard shown when an operator leaves a
	 * form they have typed into.
	 *
	 * Deliberately not a browser confirm(): on the phones the operators use, the
	 * native dialog is English-labelled and left-to-right, and a back gesture that
	 * summons it reads as the app breaking rather than asking.
	 */
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

	type Props = {
		open: boolean;
		/** Leave, losing what was typed. */
		onDiscard: () => void;
		title?: string;
		body?: string;
		/** Wording of the leave button — "خروج" fits a page, "إغلاق" a panel. */
		discardLabel?: string;
	};
	let {
		open = $bindable(),
		onDiscard,
		title = 'الخروج بدون حفظ؟',
		body = 'البيانات المدخلة لم تُحفظ وسيتم فقدانها.',
		discardLabel = 'خروج بدون حفظ'
	}: Props = $props();
</script>

<Dialog bind:open>
	<DialogContent class="max-w-sm gap-4">
		<DialogHeader>
			<DialogTitle class="text-right font-bold">{title}</DialogTitle>
		</DialogHeader>
		<p class="text-muted-foreground text-xs leading-relaxed">{body}</p>
		<DialogFooter class="grid grid-cols-2 gap-2">
			<!-- Leaving is the destructive one, so staying is what the thumb lands on
			     first and the red button is the one that has to be aimed at. -->
			<Button
				variant="outline"
				class="h-11 border-red-500/40 font-semibold text-red-600 hover:bg-red-500/10"
				onclick={() => {
					open = false;
					onDiscard();
				}}
			>
				{discardLabel}
			</Button>
			<Button class="h-11 font-semibold" onclick={() => (open = false)}>متابعة التعديل</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
