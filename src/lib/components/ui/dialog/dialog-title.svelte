<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.TitleProps = $props();
</script>

<!-- pe-8 keeps a title that wraps clear of the close button in the corner. -->
<DialogPrimitive.Title
	bind:ref
	data-slot="dialog-title"
	class={cn("text-base leading-none font-medium pe-8", className)}
	{...restProps}
/>
