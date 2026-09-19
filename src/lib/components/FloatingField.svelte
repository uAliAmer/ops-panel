<script lang="ts" generics="T extends string | number | null | undefined">
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils';
	import { floatLabelClass } from '$lib/utils/floatLabel';

	type Props = {
		id: string;
		label: string;
		value: T;
		/** Shown only while the field has focus — an empty field reads as its label. */
		placeholder?: string;
		type?: string;
		inputmode?: 'text' | 'tel' | 'numeric' | 'decimal' | 'email' | 'url' | 'search' | 'none';
		dir?: 'rtl' | 'ltr';
		disabled?: boolean;
		invalid?: boolean;
		multiline?: boolean;
		rows?: number;
		/** Must match the surface the field sits on, or the label chip shows a seam. */
		bg?: string;
		class?: string;
		inputClass?: string;
	};

	let {
		id,
		label,
		value = $bindable(),
		placeholder = '',
		type = 'text',
		inputmode,
		dir,
		disabled = false,
		invalid = false,
		multiline = false,
		rows = 2,
		bg = 'bg-background',
		class: className,
		inputClass
	}: Props = $props();

	let focused = $state(false);

	// A number input holding 0 is filled, so test for emptiness rather than
	// truthiness — otherwise a 0 total sits behind its own resting label.
	const filled = $derived(value !== null && value !== undefined && String(value) !== '');
	const floated = $derived(focused || filled);

	// Solid field fill so every input on the form reads as one surface (matching
	// the qty stepper). The label chip uses the same `bg` token, so chip and field
	// stay the same colour in both themes.
	const shared = 'peer w-full bg-background dark:bg-background';
</script>

<div class={cn('relative', className)}>
	{#if multiline}
		<Textarea
			{id}
			{rows}
			{disabled}
			bind:value={value as string}
			placeholder={focused ? placeholder : ''}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			class={cn(shared, 'pt-4', inputClass)}
		/>
	{:else}
		<Input
			{id}
			{type}
			{inputmode}
			{dir}
			{disabled}
			bind:value
			placeholder={focused ? placeholder : ''}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			class={cn(
				shared,
				'h-11 text-base',
				invalid && 'border-red-500 focus-visible:ring-red-500',
				inputClass
			)}
		/>
	{/if}
	<label for={id} class={floatLabelClass({ floated, focused, invalid, multiline, bg })}>
		{label}
	</label>
</div>
