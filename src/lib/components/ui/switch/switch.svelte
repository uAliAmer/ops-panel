<script lang="ts">
	import { Switch as SwitchPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		size = "default",
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
		size?: "sm" | "default";
	} = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	data-size={size}
	class={cn(
		"data-checked:bg-primary data-unchecked:bg-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 dark:data-unchecked:bg-input/80 shrink-0 rounded-full border border-transparent focus-visible:ring-3 aria-invalid:ring-3 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] peer group/switch relative inline-flex items-center transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
		className
	)}
	{...restProps}
>
	<!--
		Positioned with `start`, not translated. The stock classes carried both an
		LTR `translate-x-[calc(100%-2px)]` and an `rtl:` counter-translate; both
		matched at once and the LTR one won, so in this RTL app a switch that was
		on drew its thumb 13px outside a 32px track. `inset-inline-start` is
		direction-correct by construction — one rule, no pair to fight — and still
		animates, which `ms-auto` would not.
	-->
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class="bg-background dark:data-unchecked:bg-foreground dark:data-checked:bg-primary-foreground pointer-events-none absolute top-1/2 block -translate-y-1/2 rounded-full ring-0 transition-[inset-inline-start] duration-150 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 start-[2px] group-data-[size=default]/switch:group-data-[state=checked]/switch:start-[14px] group-data-[size=sm]/switch:group-data-[state=checked]/switch:start-[10px]"
	/>
</SwitchPrimitive.Root>
